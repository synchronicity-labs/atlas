import { VerificationStatus } from "@crm/db";
import type {
	MetabaseClient,
	MetabaseResult,
} from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";
import type { MarketingQuery } from "./marketing.contracts";

type ApiAdoptionQuery = Extract<MarketingQuery, { source: "api_adoption" }>;
type Row = Record<string, unknown>;
type Activity = {
	week: string;
	userId: string;
	apiKeyId: string;
	organizationId: string;
	requests: number;
	successfulJobs: number;
	failedJobs: number;
	usageAmount: number;
	accruedUsageUsd: number;
};
type Principal = {
	ownerUserId: string;
	organizationId: string;
	eligible: boolean;
};
type Endpoint = {
	requests: number;
	successfulJobs: number;
	failedJobs: number;
	usageAmount: number;
	accruedUsageUsd: number;
	organizations: Set<string>;
	apiKeys: Set<string>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ENDPOINTS = [
	"public_api_tts",
	"api_asset_upload",
	"api_asset_generation",
];

export async function apiAdoptionWeeklyReport(input: {
	query: ApiAdoptionQuery;
	metabase: MetabaseClient;
	now?: Date;
}): Promise<MetabaseResult> {
	const end = completeWeekBoundary(input.now ?? new Date());
	const start = new Date(end.getTime() - 14 * DAY_MS);
	const [tts, assets, generationUsage, generationStatus] = await Promise.all([
		queryActivities(input.metabase, "166", ttsSql(start, end)),
		queryActivities(input.metabase, "34", assetsSql(start, end)),
		queryActivities(input.metabase, "166", generationUsageSql(start, end)),
		queryActivities(input.metabase, "34", generationStatusSql(start, end)),
	]);
	const activities = [
		...tts,
		...assets,
		...generationUsage,
		...generationStatus,
	];
	const principals = await loadPrincipals(input.metabase, activities);
	let resolvedActivityRows = 0;
	let excludedActivityRows = 0;
	let missingPrincipals = 0;
	let identityConflicts = 0;
	const eligible = new Set<Activity>();
	for (const activity of activities) {
		const key = activity.apiKeyId
			? `api:${activity.apiKeyId}`
			: activity.userId
				? `user:${activity.userId}`
				: "";
		const principal = key ? principals.get(key) : undefined;
		if (!principal) {
			missingPrincipals += 1;
			continue;
		}
		resolvedActivityRows += 1;
		if (
			(activity.userId && principal.ownerUserId !== activity.userId) ||
			(activity.apiKeyId &&
				principal.organizationId &&
				principal.organizationId !== activity.organizationId)
		) {
			identityConflicts += 1;
			continue;
		}
		if (!principal.eligible) {
			excludedActivityRows += 1;
			continue;
		}
		if (!activity.organizationId) {
			missingPrincipals += 1;
			continue;
		}
		eligible.add(activity);
	}
	if (missingPrincipals > 0 || identityConflicts > 0) {
		throw new Error(
			`API adoption identity join is incomplete: ${missingPrincipals} missing principals and ${identityConflicts} conflicts.`,
		);
	}
	const periods = [start, new Date(start.getTime() + 7 * DAY_MS)].map((value) =>
		value.toISOString(),
	);
	const values = new Map<string, Endpoint>();
	for (const period of periods) {
		for (const endpoint of ENDPOINTS) {
			values.set(`${period}:${endpoint}`, emptyEndpoint());
		}
	}
	add(
		values,
		"public_api_tts",
		tts.filter((row) => eligible.has(row)),
	);
	add(
		values,
		"api_asset_upload",
		assets.filter((row) => eligible.has(row)),
	);
	add(
		values,
		"api_asset_generation",
		generationUsage.filter((row) => eligible.has(row)),
	);
	add(
		values,
		"api_asset_generation",
		generationStatus.filter((row) => eligible.has(row)),
	);
	const sourceActivityRows = activities.length;
	const principalCoveragePct = pct(resolvedActivityRows, sourceActivityRows);
	const rows = periods.flatMap((period) =>
		ENDPOINTS.map((endpoint) => {
			const value = values.get(`${period}:${endpoint}`) ?? emptyEndpoint();
			return [
				period,
				endpoint,
				value.requests,
				value.successfulJobs,
				value.failedJobs,
				value.organizations.size,
				value.apiKeys.size,
				value.usageAmount,
				round(value.accruedUsageUsd, 4),
				sourceActivityRows,
				resolvedActivityRows,
				excludedActivityRows,
				principalCoveragePct,
				missingPrincipals,
				identityConflicts,
				end.toISOString(),
				end.toISOString(),
			];
		}),
	);
	return {
		columns: [
			dateColumn("week_start"),
			textColumn("endpoint"),
			decimalColumn("requests"),
			decimalColumn("successful_jobs"),
			decimalColumn("failed_jobs"),
			decimalColumn("active_organizations"),
			decimalColumn("active_api_keys"),
			decimalColumn("usage_amount"),
			decimalColumn("accrued_usage_usd"),
			decimalColumn("source_activity_rows"),
			decimalColumn("resolved_activity_rows"),
			decimalColumn("excluded_activity_rows"),
			decimalColumn("principal_coverage_pct"),
			decimalColumn("missing_principals"),
			decimalColumn("identity_conflicts"),
			dateColumn("window_end"),
			dateColumn("data_through"),
		],
		rows,
	};
}

export function apiAdoptionVerificationChecks(
	result: MetabaseResult,
	query: ApiAdoptionQuery,
): PublishVerificationCheck[] {
	const rows = records(result);
	const registry = rows.map(
		(row) => `${String(row.week_start)}:${String(row.endpoint)}`,
	);
	const weeks = [...new Set(rows.map((row) => String(row.week_start)))].sort();
	const expected = weeks.flatMap((week) =>
		ENDPOINTS.map((endpoint) => `${week}:${endpoint}`),
	);
	const registryExact =
		query.report === "weekly-adoption" &&
		query.version === 1 &&
		JSON.stringify(registry.sort()) === JSON.stringify(expected.sort());
	const first = rows[0] ?? {};
	const sourceRows = number(first.source_activity_rows);
	const resolvedRows = number(first.resolved_activity_rows);
	const excludedRows = number(first.excluded_activity_rows);
	const identityComplete =
		sourceRows > 0 &&
		number(first.missing_principals) === 0 &&
		number(first.identity_conflicts) === 0 &&
		resolvedRows === sourceRows &&
		rateMatches(first.principal_coverage_pct, resolvedRows, sourceRows) &&
		rows.every(
			(row) =>
				number(row.source_activity_rows) === sourceRows &&
				number(row.resolved_activity_rows) === resolvedRows &&
				number(row.excluded_activity_rows) === excludedRows,
		);
	const valuesValid = rows.every(
		(row) =>
			[
				"requests",
				"successful_jobs",
				"failed_jobs",
				"active_organizations",
				"active_api_keys",
				"usage_amount",
				"accrued_usage_usd",
			].every((field) => number(row[field]) >= 0) &&
			number(row.requests) ===
				number(row.successful_jobs) + number(row.failed_jobs),
	);
	const generationUsageParity = rows
		.filter((row) => row.endpoint === "api_asset_generation")
		.every(
			(row) =>
				Math.abs(number(row.usage_amount) - number(row.successful_jobs)) <=
				Math.max(1, number(row.successful_jobs) * 0.005),
		);
	const forbidden = result.columns
		.map((column) => column.name.toLowerCase())
		.filter((name) =>
			["email", "user_id", "api_key_id", "organization_id"].includes(name),
		);
	const oneWatermark =
		weeks.length === 2 &&
		rows.every(
			(row) =>
				row.window_end === row.data_through &&
				Date.parse(String(row.window_end)) -
					Date.parse(String(row.week_start)) >=
					7 * DAY_MS &&
				Date.parse(String(row.window_end)) -
					Date.parse(String(row.week_start)) <=
					14 * DAY_MS,
		);
	return [
		check(
			"endpoint_registry_review",
			registryExact,
			"Both complete weeks must contain each approved public API adoption surface exactly once.",
			{ weeks, endpoints: ENDPOINTS },
		),
		check(
			"api_key_owner_join",
			identityComplete,
			"Every source activity row must resolve to one API-key owner or direct product user without an identity conflict.",
			{ sourceRows, resolvedRows },
		),
		check(
			"clean_organization_population",
			identityComplete,
			"Internal, anonymous, and banned-never-subscribed principals must be excluded before organization aggregation.",
			{ excludedRows },
		),
		check(
			"usage_revenue_basis",
			valuesValid &&
				!result.columns.some((column) => column.name === "cash_usd"),
			"Revenue must be TinyBird accrued usage value, never Stripe cash or inferred subscription value.",
			{ basis: "usage_accrual" },
		),
		check(
			"source_count_reconciliation",
			valuesValid && generationUsageParity,
			"Requests must reconcile to successful and failed jobs, and TinyBird asset-backed usage must match product successes within 0.5% or one generation.",
			{
				rows: rows.length,
				generationUsageDeltas: rows
					.filter((row) => row.endpoint === "api_asset_generation")
					.map((row) => number(row.usage_amount) - number(row.successful_jobs)),
			},
		),
		check(
			"sensitive_detail_boundary",
			forbidden.length === 0,
			"The governed result must exclude user, API-key, organization, and email identifiers.",
			{ forbidden },
		),
		check(
			"oldest_complete_watermark",
			oneWatermark,
			"The report must publish the two preceding complete Monday-Sunday UTC weeks under one data-through boundary.",
			{ weeks, dataThrough: first.data_through },
		),
	];
}

async function queryActivities(
	metabase: MetabaseClient,
	databaseExternalId: string,
	queryText: string,
): Promise<Activity[]> {
	const result = await metabase.preview({
		language: "SQL",
		databaseExternalId,
		queryText,
	});
	if (result.rows.length > 10000)
		throw new Error("API adoption activity result exceeded its safe limit.");
	return records(result).map((row) => ({
		week: week(String(row.week_start)),
		userId: text(row.user_id),
		apiKeyId: text(row.api_key_id),
		organizationId: text(row.organization_id),
		requests: number(row.requests),
		successfulJobs: number(row.successful_jobs),
		failedJobs: number(row.failed_jobs),
		usageAmount: number(row.usage_amount),
		accruedUsageUsd: number(row.accrued_usage_usd),
	}));
}

async function loadPrincipals(
	metabase: MetabaseClient,
	activities: Activity[],
): Promise<Map<string, Principal>> {
	const users = [
		...new Set(
			activities
				.filter((row) => !row.apiKeyId)
				.map((row) => row.userId)
				.filter(Boolean),
		),
	];
	const apiKeys = [
		...new Set(activities.map((row) => row.apiKeyId).filter(Boolean)),
	];
	const principals = new Map<string, Principal>();
	for (const values of chunks(users, 400)) {
		const result = await metabase.preview({
			language: "SQL",
			databaseExternalId: "34",
			queryText: principalSql("user", values),
		});
		addPrincipals(principals, result);
	}
	for (const values of chunks(apiKeys, 400)) {
		const result = await metabase.preview({
			language: "SQL",
			databaseExternalId: "34",
			queryText: principalSql("api", values),
		});
		addPrincipals(principals, result);
	}
	return principals;
}

function addPrincipals(
	principals: Map<string, Principal>,
	result: MetabaseResult,
) {
	for (const row of records(result)) {
		principals.set(`${text(row.principal_type)}:${text(row.principal_id)}`, {
			ownerUserId: text(row.owner_user_id),
			organizationId: text(row.organization_id),
			eligible: bool(row.eligible),
		});
	}
}

function add(
	values: Map<string, Endpoint>,
	endpoint: string,
	rows: Activity[],
) {
	for (const row of rows) {
		const value = values.get(`${row.week}:${endpoint}`);
		if (!value) throw new Error(`Unexpected API adoption week ${row.week}.`);
		value.requests += row.requests;
		value.successfulJobs += row.successfulJobs;
		value.failedJobs += row.failedJobs;
		value.usageAmount += row.usageAmount;
		value.accruedUsageUsd += row.accruedUsageUsd;
		value.organizations.add(row.organizationId);
		if (row.apiKeyId) value.apiKeys.add(row.apiKeyId);
	}
}

function emptyEndpoint(): Endpoint {
	return {
		requests: 0,
		successfulJobs: 0,
		failedJobs: 0,
		usageAmount: 0,
		accruedUsageUsd: 0,
		organizations: new Set(),
		apiKeys: new Set(),
	};
}

function ttsSql(start: Date, end: Date) {
	return `select
  toStartOfWeek(createdAt, 1) as week_start,
  ifNull(userId, '') as user_id,
  ifNull(apiKeyId, '') as api_key_id,
  ifNull(organizationId, '') as organization_id,
  count() as requests,
  count() as successful_jobs,
  0 as failed_jobs,
  sum(usageAmount) as usage_amount,
  sum(usageCostMillicents) / 100000.0 as accrued_usage_usd
from sync_prod.sync_usage_integration_tts
where createdAt >= toDateTime('${clickhouseDate(start)}', 'UTC')
  and createdAt < toDateTime('${clickhouseDate(end)}', 'UTC')
  and apiKeyId is not null
  and apiKeyId != ''
group by 1, 2, 3, 4
order by 1, 4, 3, 2
limit 10001`;
}

function generationUsageSql(start: Date, end: Date) {
	return `select
  toStartOfWeek(generationEndedAt, 1) as week_start,
  ifNull(userId, '') as user_id,
  ifNull(apiKeyId, '') as api_key_id,
  ifNull(organizationId, '') as organization_id,
  0 as requests,
  0 as successful_jobs,
  0 as failed_jobs,
  countDistinct(generationId) as usage_amount,
  sum(generationCostMillicents) / 100000.0 as accrued_usage_usd
from sync_prod.sync_usage3
where generationEndedAt >= toDateTime('${clickhouseDate(start)}', 'UTC')
  and generationEndedAt < toDateTime('${clickhouseDate(end)}', 'UTC')
  and generationRecord like '%usedApiUploadedAsset%true%'
group by week_start, user_id, api_key_id, organization_id
order by week_start, organization_id, api_key_id, user_id
limit 10001`;
}

function assetsSql(start: Date, end: Date) {
	return `select
  date_trunc('week', created_at at time zone 'UTC')::date as week_start,
  coalesce(user_id::text, '') as user_id,
  coalesce(api_key_id::text, '') as api_key_id,
  coalesce(organization_id::text, '') as organization_id,
  count(*)::int as requests,
  count(*)::int as successful_jobs,
  0::int as failed_jobs,
  count(*)::numeric as usage_amount,
  0::numeric as accrued_usage_usd
from public.assets
where created_at >= '${start.toISOString()}'::timestamptz
  and created_at < '${end.toISOString()}'::timestamptz
  and api_key_id is not null
  and deleted_at is null
group by 1, 2, 3, 4
order by 1, 4, 3, 2
limit 10001`;
}

function generationStatusSql(start: Date, end: Date) {
	return `select
  date_trunc('week', coalesce(g.finished_at, g.created_at) at time zone 'UTC')::date as week_start,
  case
    when video.api_key_id is not null and audio.api_key_id is not null and video.api_key_id::text <> audio.api_key_id::text then '__IDENTITY_CONFLICT__'
    when video.api_key_id is not null then coalesce(video.user_id::text, g.user_id::text, '')
    when audio.api_key_id is not null then coalesce(audio.user_id::text, g.user_id::text, '')
    else coalesce(g.user_id::text, '')
  end as user_id,
  case
    when video.api_key_id is not null and audio.api_key_id is not null and video.api_key_id::text <> audio.api_key_id::text then '__IDENTITY_CONFLICT__'
    else coalesce(video.api_key_id::text, audio.api_key_id::text, g.api_key_id::text, '')
  end as api_key_id,
  case
    when video.api_key_id is not null and audio.api_key_id is not null and video.api_key_id::text <> audio.api_key_id::text then '__IDENTITY_CONFLICT__'
    when video.api_key_id is not null then coalesce(video.organization_id::text, g.organization_id::text, '')
    when audio.api_key_id is not null then coalesce(audio.organization_id::text, g.organization_id::text, '')
    else coalesce(g.organization_id::text, '')
  end as organization_id,
  count(distinct g.id)::int as requests,
  count(distinct g.id) filter (where g.status = 'COMPLETED')::int as successful_jobs,
  count(distinct g.id) filter (where g.status = 'FAILED')::int as failed_jobs,
  0::numeric as usage_amount,
  0::numeric as accrued_usage_usd
from public.generations g
left join public.assets video on video.id = g.video_asset_id
left join public.assets audio on audio.id = g.audio_asset_id
where coalesce(g.finished_at, g.created_at) >= '${start.toISOString()}'::timestamptz
  and coalesce(g.finished_at, g.created_at) < '${end.toISOString()}'::timestamptz
  and g.status in ('COMPLETED', 'FAILED')
  and (
    video.api_key_id is not null
    or audio.api_key_id is not null
    or g.metadata #>> '{provenance,usedApiUploadedAsset}' = 'true'
    or g.metadata ->> 'usedApiUploadedAsset' = 'true'
  )
group by 1, 2, 3, 4
order by 1, 4, 3, 2
limit 10001`;
}

function principalSql(type: "user" | "api", ids: string[]) {
	const values = ids.map(sqlString).join(", ");
	const source =
		type === "api"
			? `from public.api_keys k
join auth.users u on u.id = k.user_id
where k.id::text in (${values})`
			: `from auth.users u
where u.id::text in (${values})`;
	return `select
  '${type}' as principal_type,
  ${type === "api" ? "k.id::text" : "u.id::text"} as principal_id,
  u.id::text as owner_user_id,
  ${type === "api" ? "coalesce(k.organization_id::text, '')" : "''"} as organization_id,
  (
    coalesce(u.is_anonymous, false) = false
    and lower(coalesce(u.email, '')) not like '%@sync.so'
    and lower(coalesce(u.email, '')) not like '%@sync.labs'
    and (
      coalesce(u.banned, false) = false
      or exists (
        select 1
        from public.user_organizations membership
        join public.organizations organization on organization.id = membership.organization_id
        where membership.user_id = u.id
          and organization.first_subscribed_at is not null
      )
    )
  ) as eligible
${source}
order by principal_id`;
}

function completeWeekBoundary(now: Date) {
	const value = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
	return value;
}

function week(value: string) {
	const parsed = new Date(value);
	if (!Number.isFinite(parsed.getTime()))
		throw new Error("API adoption source returned an invalid week.");
	return parsed.toISOString();
}

function records(result: MetabaseResult): Row[] {
	return result.rows.map((row) =>
		Object.fromEntries(
			result.columns.map((column, index) => [column.name, row[index] ?? null]),
		),
	);
}

function chunks<T>(values: T[], size: number) {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size)
		result.push(values.slice(index, index + size));
	return result;
}

function sqlString(value: string) {
	return `'${value.replaceAll("'", "''")}'`;
}

function clickhouseDate(value: Date) {
	return value.toISOString().replace("T", " ").slice(0, 19);
}

function text(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown) {
	return value === true || value === 1 || value === "1" || value === "true";
}

function number(value: unknown) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, digits: number) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function pct(numerator: number, denominator: number) {
	return denominator > 0 ? round((numerator / denominator) * 100, 2) : 100;
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
