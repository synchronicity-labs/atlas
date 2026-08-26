import { VerificationStatus } from "@crm/db";
import type {
	MetabaseClient,
	MetabaseResult,
} from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";
import type { MarketingClient } from "./marketing.client";
import type { MarketingQuery } from "./marketing.contracts";

type ProductPagesQuery = Extract<MarketingQuery, { source: "product_pages" }>;
type Row = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
const PRODUCT_PAGES = [
	"auto-dubbing",
	"video-translator",
	"free-video-translator",
	"ai-dubbing",
	"web-dubbing",
	"video-dubbing",
	"voice-cloning",
	"translate-video-to-english",
	"translate-hindi-video",
	"translate-french-video",
] as const;

export async function productPagesWeeklyReport(input: {
	query: ProductPagesQuery;
	marketing: MarketingClient;
	metabase: MetabaseClient;
	now?: Date;
}): Promise<MetabaseResult> {
	const end = completeWeekBoundary(input.now ?? new Date());
	const start = new Date(end.getTime() - 7 * DAY_MS);
	const [attribution, traffic] = await Promise.all([
		input.metabase.preview({
			language: "SQL",
			databaseExternalId: "34",
			queryText: attributionSql(start, end),
		}),
		Promise.all(
			PRODUCT_PAGES.map(async (slug) => ({
				slug,
				result: await input.marketing.ga4Range(
					{
						source: "ga4",
						properties: ["blog"],
						dateRange: "30_days",
						dimensions: [],
						metrics: ["totalUsers", "sessions", "engagementRate"],
						merge: "rows",
						limit: 1,
						dimensionFilter: {
							fieldName: "pagePath",
							values: [`/product/${slug}`, `/product/${slug}/`],
							caseSensitive: true,
						},
					},
					start,
					end,
				),
			})),
		),
	]);

	const attributionRows = records(attribution);
	const organizationsBySlug = new Map<string, string[]>();
	const signupsBySlug = new Map<string, number>();
	let allCleanSignups = 0;
	let claimedSignups = 0;
	let recognizedSignups = 0;
	for (const row of attributionRows) {
		const slug = String(row.slug);
		if (!PRODUCT_PAGES.includes(slug as (typeof PRODUCT_PAGES)[number])) {
			throw new Error(`Unexpected product-page slug ${slug}.`);
		}
		signupsBySlug.set(slug, number(row.signups));
		organizationsBySlug.set(
			slug,
			Array.isArray(row.organization_ids)
				? row.organization_ids.map(String)
				: [],
		);
		allCleanSignups = number(row.all_clean_signups);
		claimedSignups = number(row.claimed_product_page_signups);
		recognizedSignups = number(row.recognized_product_page_signups);
	}
	const organizationToSlug = new Map<string, string>();
	for (const [slug, organizations] of organizationsBySlug) {
		for (const organization of organizations) {
			if (organizationToSlug.has(organization)) {
				throw new Error("Product-page first-touch attribution is not unique.");
			}
			organizationToSlug.set(organization, slug);
		}
	}
	const subscriptions = await subscriptionRows(
		input.metabase,
		organizationToSlug,
		start,
		end,
	);
	const paidOrganizationsBySlug = new Map<string, number>();
	const subscriptionsBySlug = new Map<string, number>();
	for (const row of subscriptions) {
		const organization = String(row.organization_id);
		const slug = organizationToSlug.get(organization);
		if (!slug)
			throw new Error(
				"Subscription attribution returned an unknown organization.",
			);
		const count = number(row.subscriptions);
		if (count > 0) {
			paidOrganizationsBySlug.set(
				slug,
				(paidOrganizationsBySlug.get(slug) ?? 0) + 1,
			);
			subscriptionsBySlug.set(
				slug,
				(subscriptionsBySlug.get(slug) ?? 0) + count,
			);
		}
	}
	const trafficBySlug = new Map(
		traffic.map(({ slug, result }) => {
			const row = record(result, 0);
			return [
				slug,
				{
					users: number(row.totalUsers),
					sessions: number(row.sessions),
					engagementRate: number(row.engagementRate),
				},
			] as const;
		}),
	);
	const attributionCoverage = pct(recognizedSignups, claimedSignups);
	const rows = PRODUCT_PAGES.map((slug) => {
		const pageTraffic = trafficBySlug.get(slug) ?? {
			users: 0,
			sessions: 0,
			engagementRate: 0,
		};
		const attributedOrganizations = organizationsBySlug.get(slug)?.length ?? 0;
		const paidOrganizations = paidOrganizationsBySlug.get(slug) ?? 0;
		return [
			start.toISOString(),
			`/product/${slug}`,
			pageTraffic.users,
			pageTraffic.sessions,
			pageTraffic.engagementRate,
			signupsBySlug.get(slug) ?? 0,
			attributedOrganizations,
			paidOrganizations,
			subscriptionsBySlug.get(slug) ?? 0,
			pct(paidOrganizations, attributedOrganizations),
			allCleanSignups,
			claimedSignups,
			recognizedSignups,
			attributionCoverage,
			0,
			end.toISOString(),
			end.toISOString(),
		];
	});
	return {
		columns: [
			dateColumn("period_start"),
			textColumn("page"),
			decimalColumn("users"),
			decimalColumn("sessions"),
			decimalColumn("engagement_rate_pct"),
			decimalColumn("signups"),
			decimalColumn("attributed_organizations"),
			decimalColumn("paid_organizations"),
			decimalColumn("subscriptions"),
			decimalColumn("paid_conversion_pct"),
			decimalColumn("all_clean_signups"),
			decimalColumn("claimed_product_page_signups"),
			decimalColumn("recognized_product_page_signups"),
			decimalColumn("attribution_coverage_pct"),
			decimalColumn("attribution_identity_conflicts"),
			dateColumn("window_end"),
			dateColumn("data_through"),
		],
		rows,
	};
}

export function productPagesVerificationChecks(
	result: MetabaseResult,
	query: ProductPagesQuery,
): PublishVerificationCheck[] {
	const rows = records(result);
	const expectedPages = PRODUCT_PAGES.map((slug) => `/product/${slug}`).sort();
	const actualPages = rows.map((row) => String(row.page)).sort();
	const registryExact =
		JSON.stringify(expectedPages) === JSON.stringify(actualPages);
	const valuesValid = rows.every(
		(row) =>
			[
				"users",
				"sessions",
				"signups",
				"attributed_organizations",
				"paid_organizations",
				"subscriptions",
			].every((field) => number(row[field]) >= 0) &&
			number(row.engagement_rate_pct) >= 0 &&
			number(row.engagement_rate_pct) <= 100,
	);
	const conversionsReconcile = rows.every(
		(row) =>
			number(row.paid_organizations) <= number(row.attributed_organizations) &&
			number(row.subscriptions) >= number(row.paid_organizations) &&
			rateMatches(
				row.paid_conversion_pct,
				row.paid_organizations,
				row.attributed_organizations,
			),
	);
	const first = rows[0] ?? {};
	const allClean = number(first.all_clean_signups);
	const claimed = number(first.claimed_product_page_signups);
	const recognized = number(first.recognized_product_page_signups);
	const coverageReconciles =
		allClean >= claimed &&
		claimed >= recognized &&
		rows.reduce((sum, row) => sum + number(row.signups), 0) === recognized &&
		rows.every(
			(row) =>
				number(row.all_clean_signups) === allClean &&
				number(row.claimed_product_page_signups) === claimed &&
				number(row.recognized_product_page_signups) === recognized &&
				rateMatches(row.attribution_coverage_pct, recognized, claimed),
		);
	const identityUnique = rows.every(
		(row) => number(row.attribution_identity_conflicts) === 0,
	);
	const forbidden = result.columns
		.map((column) => column.name.toLowerCase())
		.filter((name) =>
			["email", "organization_id", "person_id", "user_id"].includes(name),
		);
	const watermarks = rows.map((row) => String(row.data_through));
	const oneWatermark =
		watermarks.length > 0 &&
		new Set(watermarks).size === 1 &&
		rows.every(
			(row) =>
				row.window_end === row.data_through &&
				Date.parse(String(row.data_through)) -
					Date.parse(String(row.period_start)) ===
					7 * DAY_MS,
		);
	return [
		check(
			"page_registry_review",
			query.report === "weekly-funnel" && query.version === 1 && registryExact,
			"The result must use the approved product-page registry and adapter version.",
			{ expectedPages, actualPages },
		),
		check(
			"page_population",
			valuesValid,
			"Each registered page must have valid non-negative traffic and conversion values.",
			{ rows: rows.length },
		),
		check(
			"first_touch_coverage",
			coverageReconciles,
			"Recognized product-page claims must reconcile to all product-page claims and clean signups.",
			{ allClean, claimed, recognized },
		),
		check(
			"subscription_parity",
			conversionsReconcile,
			"Paid organizations, subscriptions, and paid conversion rates must reconcile.",
			{ rows: rows.length },
		),
		check(
			"first_touch_identity",
			identityUnique,
			"Each organization must be assigned to at most one first-touch product page.",
			{ identityUnique },
		),
		check(
			"sensitive_detail_boundary",
			forbidden.length === 0,
			"The governed result must exclude person and organization identifiers.",
			{ forbidden },
		),
		check(
			"oldest_complete_watermark",
			oneWatermark,
			"All rows must use one complete UTC week and data-through boundary.",
			{ dataThrough: [...new Set(watermarks)] },
		),
	];
}

async function subscriptionRows(
	metabase: MetabaseClient,
	organizationToSlug: Map<string, string>,
	start: Date,
	end: Date,
) {
	if (organizationToSlug.size === 0) return [];
	const organizations = sqlList([...organizationToSlug.keys()]);
	const result = await metabase.preview({
		language: "SQL",
		databaseExternalId: "166",
		queryText: `select
  organizationId as organization_id,
  countDistinct(subscriptionId) as subscriptions
from sync_prod.sync_stripe_subscription_creation_invoices
where createdAt >= toDateTime('${clickhouseDate(start)}', 'UTC')
  and createdAt < toDateTime('${clickhouseDate(end)}', 'UTC')
  and organizationId in (${organizations})
  and amountPaid > 0
group by organizationId
order by organizationId
limit 10000`,
	});
	return records(result);
}

function attributionSql(start: Date, end: Date) {
	const registry = PRODUCT_PAGES.map((slug) => `('${slug}')`).join(",");
	return `with registry(slug) as (
  values ${registry}
), candidates as (
  select
    id,
    organization_id::text as organization_id,
    created_at,
    coalesce(
      nullif(utm_campaign, ''),
      substring(attribution_landing_page from 'source_product_page=([^&]+)'),
      substring(attribution_landing_page from 'utm_campaign=([^&]+)')
    ) as slug,
    (
      (utm_source = 'blog' and utm_medium = 'product_page')
      or attribution_landing_page like '%utm_medium=product_page%'
      or attribution_landing_page like '%source_product_page=%'
    ) as product_page_claim
  from auth.users
  where created_at >= '${start.toISOString()}'::timestamptz
    and created_at < '${end.toISOString()}'::timestamptz
    and coalesce(banned, false) = false
    and coalesce(disabled, false) = false
    and coalesce(is_anonymous, false) = false
    and lower(email::text) not like '%@sync.so'
    and lower(email::text) not like '%@sync.labs'
), claimed as (
  select * from candidates where product_page_claim
), recognized as (
  select claimed.*
  from claimed
  join registry using (slug)
), first_organization_touch as (
  select distinct on (organization_id)
    organization_id,
    slug
  from recognized
  where organization_id is not null
  order by organization_id, created_at, id
), signup_counts as (
  select slug, count(*)::int as signups
  from recognized
  group by slug
), organization_counts as (
  select
    slug,
    count(*)::int as attributed_organizations,
    array_agg(organization_id order by organization_id) as organization_ids
  from first_organization_touch
  group by slug
), totals as (
  select
    (select count(*)::int from candidates) as all_clean_signups,
    (select count(*)::int from claimed) as claimed_product_page_signups,
    (select count(*)::int from recognized) as recognized_product_page_signups
)
select
  registry.slug,
  coalesce(signup_counts.signups, 0)::int as signups,
  coalesce(organization_counts.attributed_organizations, 0)::int as attributed_organizations,
  coalesce(organization_counts.organization_ids, array[]::text[]) as organization_ids,
  totals.all_clean_signups,
  totals.claimed_product_page_signups,
  totals.recognized_product_page_signups
from registry
cross join totals
left join signup_counts using (slug)
left join organization_counts using (slug)
order by registry.slug`;
}

function completeWeekBoundary(now: Date) {
	const value = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
	return value;
}

function record(result: MetabaseResult, index: number): Row {
	const row = result.rows[index] ?? [];
	return Object.fromEntries(
		result.columns.map((column, columnIndex) => [
			column.name,
			row[columnIndex] ?? null,
		]),
	);
}

function records(result: MetabaseResult): Row[] {
	return result.rows.map((_, index) => record(result, index));
}

function sqlList(values: string[]) {
	return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");
}

function clickhouseDate(value: Date) {
	return value.toISOString().replace("T", " ").slice(0, 19);
}

function number(value: unknown) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator: number, denominator: number) {
	return denominator > 0
		? Math.round((numerator / denominator) * 10_000) / 100
		: 0;
}

function rateMatches(rate: unknown, numerator: unknown, denominator: unknown) {
	return (
		Math.abs(number(rate) - pct(number(numerator), number(denominator))) <= 0.01
	);
}

function check(
	name: string,
	passed: boolean,
	reason: string,
	actualValue: unknown,
): PublishVerificationCheck {
	return {
		name,
		status: passed ? VerificationStatus.PASSED : VerificationStatus.FAILED,
		reason,
		referenceValue: { required: true },
		actualValue,
	};
}

function textColumn(name: string) {
	return { name, displayName: name, baseType: "type/Text" };
}

function dateColumn(name: string) {
	return { name, displayName: name, baseType: "type/DateTime" };
}

function decimalColumn(name: string) {
	return { name, displayName: name, baseType: "type/Decimal" };
}
