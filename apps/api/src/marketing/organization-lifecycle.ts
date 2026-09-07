import type { z } from "zod";
import type {
	MetabaseClient,
	MetabaseResult,
} from "../metabase/metabase.client";
import type {
	TinybirdEligibilityService,
	TinybirdEligibilitySnapshot,
} from "../metabase/tinybird-eligibility.service";
import type { productAnalyticsQuery } from "./marketing.contracts";

const MAX_ROWS = 100000;

type ProductAnalyticsQuery = z.infer<typeof productAnalyticsQuery>;

export type LifecycleOrganization = {
	id: string;
	signupCohort: string;
	billingVersion: string;
	plan: string;
	segment: string;
};

export type LifecycleSubscription = {
	id: string;
	organizationId: string;
	createdAt: number;
	currentPeriodEnd: number | null;
	cancelAt: number | null;
	canceledAt: number | null;
	plan: string;
};

type LifecycleValues = {
	periodStart: string;
	lifecycleSeries: string;
	organizationSegment: string;
	billingVersion: string;
	signupCohort: string;
	plan: string;
	horizon: string;
	startingOrganizations: number | null;
	retainedOrganizations: number | null;
	retentionPct: number | null;
	churnedOrganizations: number | null;
	churnPct: number | null;
	returnedOrganizations: number | null;
	returnPct: number | null;
	requalifiedOrganizations: number | null;
	requalificationPct: number | null;
	resubscriptionEligibleOrganizations: number | null;
	resubscribedOrganizations: number | null;
	resubscriptionPct: number | null;
	newOrganizations: number | null;
	wentDarkOrganizations: number | null;
	belowGateOrganizations: number | null;
	convertedOrganizations: number | null;
	closingAccruedValueUsd: number | null;
	closingPaidValueUsd: number | null;
	dataThrough: string;
};

const PRODUCT_LIFECYCLE_SQL = `WITH bounds AS (
  SELECT
    date_trunc('month', current_date) - interval '6 months' AS period_start,
    date_trunc('month', current_date) AS period_end
),
periods AS (
  SELECT generate_series(period_start, period_end - interval '1 month', interval '1 month')::date AS month
  FROM bounds
),
activity AS (
  SELECT
    date_trunc('month', g.created_at)::date AS month,
    g.organization_id,
    date_trunc('month', o.created_at)::date AS signup_cohort,
    coalesce(nullif(o.billing_version, ''), 'v2') AS billing_version,
    coalesce(nullif(o.plan, ''), 'free') AS plan,
    CASE
      WHEN bool_and(g.api_key_id IS NOT NULL OR lower(coalesce(g.source, '')) = 'api') THEN 'api'
      WHEN bool_and(g.api_key_id IS NULL AND lower(coalesce(g.source, '')) <> 'api') THEN 'app'
      ELSE 'mixed'
    END AS organization_segment,
    o.first_generation_created_at
  FROM public.generations g
  JOIN public.organizations o ON o.id = g.organization_id
  CROSS JOIN bounds b
  WHERE g.organization_id IS NOT NULL
    AND g.deleted_at IS NULL
    AND g.status = 'COMPLETED'
    AND g.created_at >= b.period_start - interval '1 month'
    AND g.created_at < b.period_end
  GROUP BY 1, 2, 3, 4, 5, o.first_generation_created_at
),
product_spine AS (
  SELECT DISTINCT p.month, a.organization_id
  FROM periods p
  JOIN activity a ON a.month IN (p.month, p.month - interval '1 month')
),
product_classified AS (
  SELECT
    s.month,
    coalesce(current_activity.organization_segment, previous_activity.organization_segment) AS organization_segment,
    coalesce(current_activity.billing_version, previous_activity.billing_version) AS billing_version,
    coalesce(current_activity.signup_cohort, previous_activity.signup_cohort) AS signup_cohort,
    coalesce(current_activity.plan, previous_activity.plan) AS plan,
    previous_activity.organization_id IS NOT NULL AS was_active,
    current_activity.organization_id IS NOT NULL AS is_active,
    current_activity.organization_id IS NOT NULL
      AND previous_activity.organization_id IS NULL
      AND current_activity.first_generation_created_at < s.month AS returned,
    current_activity.organization_id IS NOT NULL
      AND date_trunc('month', current_activity.first_generation_created_at) = s.month AS is_new
  FROM product_spine s
  LEFT JOIN activity current_activity
    ON current_activity.organization_id = s.organization_id
    AND current_activity.month = s.month
  LEFT JOIN activity previous_activity
    ON previous_activity.organization_id = s.organization_id
    AND previous_activity.month = s.month - interval '1 month'
),
product_rollup AS (
  SELECT
    month AS period_start,
    'product_usage'::text AS lifecycle_series,
    organization_segment,
    billing_version,
    signup_cohort,
    plan,
    'M1'::text AS horizon,
    count(*) FILTER (WHERE was_active)::bigint AS starting_organizations,
    count(*) FILTER (WHERE was_active AND is_active)::bigint AS retained_organizations,
    round(100.0 * count(*) FILTER (WHERE was_active AND is_active) / nullif(count(*) FILTER (WHERE was_active), 0), 2) AS retention_pct,
    count(*) FILTER (WHERE was_active AND NOT is_active)::bigint AS churned_organizations,
    round(100.0 * count(*) FILTER (WHERE was_active AND NOT is_active) / nullif(count(*) FILTER (WHERE was_active), 0), 2) AS churn_pct,
    count(*) FILTER (WHERE returned)::bigint AS returned_organizations,
    NULL::numeric AS return_pct,
    NULL::bigint AS requalified_organizations,
    NULL::numeric AS requalification_pct,
    NULL::bigint AS resubscription_eligible_organizations,
    NULL::bigint AS resubscribed_organizations,
    NULL::numeric AS resubscription_pct,
    count(*) FILTER (WHERE is_new)::bigint AS new_organizations,
    NULL::bigint AS went_dark_organizations,
    NULL::bigint AS below_gate_organizations,
    NULL::bigint AS converted_organizations,
    NULL::numeric AS closing_accrued_value_usd,
    NULL::numeric AS closing_paid_value_usd
  FROM product_classified
  GROUP BY 1, 2, 3, 4, 5, 6, 7
),
movement AS (
  SELECT
    m.month,
    m.organization_id,
    m.state,
    m.churn_type,
    date_trunc('month', o.created_at)::date AS signup_cohort,
    coalesce(nullif(m.billing_version, ''), 'v2') AS billing_version,
    coalesce(nullif(o.plan, ''), 'free') AS plan,
    CASE
      WHEN m.state = 'churn' AND previous.billable_generations > 0 THEN
        CASE
          WHEN previous.api_generations = 0 THEN 'app'
          WHEN previous.api_generations >= previous.billable_generations THEN 'api'
          ELSE 'mixed'
        END
      WHEN m.api_generations = 0 THEN 'app'
      WHEN m.api_generations >= m.billable_generations THEN 'api'
      ELSE 'mixed'
    END AS organization_segment,
    m.accrued_usd,
    m.paid_usd
  FROM public.org_movement_months m
  JOIN public.organizations o ON o.id = m.organization_id
  CROSS JOIN bounds b
  LEFT JOIN public.org_movement_months previous
    ON previous.organization_id = m.organization_id
    AND previous.month = m.month - interval '1 month'
  WHERE m.month >= b.period_start
    AND m.month < b.period_end
    AND m.is_clean
    AND NOT m.is_partial
),
professional_rollup AS (
  SELECT
    month AS period_start,
    'professional_qualification'::text AS lifecycle_series,
    organization_segment,
    billing_version,
    signup_cohort,
    plan,
    'M1'::text AS horizon,
    count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction', 'churn'))::bigint AS starting_organizations,
    count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction'))::bigint AS retained_organizations,
    round(100.0 * count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction')) / nullif(count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction', 'churn')), 0), 2) AS retention_pct,
    count(*) FILTER (WHERE state = 'churn')::bigint AS churned_organizations,
    round(100.0 * count(*) FILTER (WHERE state = 'churn') / nullif(count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction', 'churn')), 0), 2) AS churn_pct,
    count(*) FILTER (WHERE state = 'reactivation')::bigint AS returned_organizations,
    NULL::numeric AS return_pct,
    count(*) FILTER (WHERE state = 'reactivation')::bigint AS requalified_organizations,
    NULL::numeric AS requalification_pct,
    NULL::bigint AS resubscription_eligible_organizations,
    NULL::bigint AS resubscribed_organizations,
    NULL::numeric AS resubscription_pct,
    count(*) FILTER (WHERE state = 'new')::bigint AS new_organizations,
    count(*) FILTER (WHERE churn_type = 'went_dark')::bigint AS went_dark_organizations,
    count(*) FILTER (WHERE churn_type = 'below_gate')::bigint AS below_gate_organizations,
    count(*) FILTER (WHERE churn_type = 'converted')::bigint AS converted_organizations,
    sum(accrued_usd) FILTER (WHERE state <> 'churn') AS closing_accrued_value_usd,
    sum(paid_usd) FILTER (WHERE state <> 'churn') AS closing_paid_value_usd
  FROM movement
  GROUP BY 1, 2, 3, 4, 5, 6, 7
)
SELECT *, date_trunc('month', current_date)::date AS data_through
FROM product_rollup
UNION ALL
SELECT *, date_trunc('month', current_date)::date AS data_through
FROM professional_rollup
ORDER BY period_start, lifecycle_series, organization_segment, billing_version, signup_cohort, plan`;

const ORGANIZATIONS_SQL = `SELECT
  o.id::text AS organization_id,
  date_trunc('month', o.created_at)::date AS signup_cohort,
  coalesce(nullif(o.billing_version, ''), 'v2') AS billing_version,
  coalesce(nullif(o.plan, ''), 'free') AS plan,
  CASE
    WHEN coalesce(m.billable_generations, 0) > 0 AND coalesce(m.api_generations, 0) >= m.billable_generations THEN 'api'
    WHEN coalesce(m.billable_generations, 0) > 0 AND coalesce(m.api_generations, 0) = 0 THEN 'app'
    WHEN coalesce(m.api_generations, 0) > 0 THEN 'mixed'
    ELSE 'no_professional_activity'
  END AS organization_segment
FROM public.organizations o
LEFT JOIN (
  SELECT
    organization_id,
    sum(api_generations) AS api_generations,
    sum(billable_generations) AS billable_generations
  FROM public.org_movement_months
  WHERE is_clean
    AND month >= date_trunc('month', current_date) - interval '6 months'
    AND month < date_trunc('month', current_date)
  GROUP BY organization_id
) m ON m.organization_id = o.id
WHERE o.first_subscribed_at IS NOT NULL
ORDER BY o.id`;

const SUBSCRIPTIONS_SQL = `SELECT
  id,
  "organizationId" AS organization_id,
  status,
  "createdAt" AS created_at,
  "currentPeriodEnd" AS current_period_end,
  "cancelAt" AS cancel_at,
  "canceledAt" AS canceled_at,
  coalesce(nullIf(plan, ''), 'unknown') AS plan
FROM sync_prod.sync_stripe_subscriptions_with_plan
WHERE status IN ('active', 'past_due', 'canceled')
  AND "createdAt" < toStartOfMonth(today())
  AND greatest(
    coalesce("currentPeriodEnd", toDateTime(0)),
    coalesce("cancelAt", toDateTime(0)),
    coalesce("canceledAt", toDateTime(0))
  ) >= addMonths(toStartOfMonth(today()), -7)
ORDER BY "createdAt", id`;

function timestamp(value: unknown): number | null {
	if (!value) return null;
	const parsed = Date.parse(String(value));
	return Number.isFinite(parsed) ? parsed : null;
}

function monthStart(value: Date): Date {
	return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function addMonths(value: Date, months: number): Date {
	return new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1),
	);
}

function date(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function percent(numerator: number, denominator: number): number | null {
	return denominator > 0
		? Math.round((numerator / denominator) * 10_000) / 100
		: null;
}

function activeAt(
	subscription: LifecycleSubscription,
	periodEndExclusive: number,
): boolean {
	const effectiveEnd = Math.max(
		subscription.currentPeriodEnd ?? 0,
		subscription.cancelAt ?? 0,
		subscription.canceledAt ?? 0,
	);
	return (
		subscription.createdAt < periodEndExclusive &&
		effectiveEnd >= periodEndExclusive
	);
}

function row(values: LifecycleValues): unknown[] {
	return [
		values.periodStart,
		values.lifecycleSeries,
		values.organizationSegment,
		values.billingVersion,
		values.signupCohort,
		values.plan,
		values.horizon,
		values.startingOrganizations,
		values.retainedOrganizations,
		values.retentionPct,
		values.churnedOrganizations,
		values.churnPct,
		values.returnedOrganizations,
		values.returnPct,
		values.requalifiedOrganizations,
		values.requalificationPct,
		values.resubscriptionEligibleOrganizations,
		values.resubscribedOrganizations,
		values.resubscriptionPct,
		values.newOrganizations,
		values.wentDarkOrganizations,
		values.belowGateOrganizations,
		values.convertedOrganizations,
		values.closingAccruedValueUsd,
		values.closingPaidValueUsd,
		values.dataThrough,
	];
}

function columns(): MetabaseResult["columns"] {
	const definitions: Array<[string, string, string]> = [
		["period_start", "Period start", "type/Date"],
		["lifecycle_series", "Lifecycle series", "type/Text"],
		["organization_segment", "Organization segment", "type/Text"],
		["billing_version", "Billing version", "type/Text"],
		["signup_cohort", "Signup cohort", "type/Date"],
		["plan", "Plan", "type/Text"],
		["horizon", "Horizon", "type/Text"],
		["starting_organizations", "Starting organizations", "type/Integer"],
		["retained_organizations", "Retained organizations", "type/Integer"],
		["retention_pct", "Retention (%)", "type/Decimal"],
		["churned_organizations", "Churned organizations", "type/Integer"],
		["churn_pct", "Churn (%)", "type/Decimal"],
		["returned_organizations", "Returned organizations", "type/Integer"],
		["return_pct", "Return (%)", "type/Decimal"],
		["requalified_organizations", "Requalified organizations", "type/Integer"],
		["requalification_pct", "Requalification (%)", "type/Decimal"],
		[
			"resubscription_eligible_organizations",
			"Resubscription eligible",
			"type/Integer",
		],
		[
			"resubscribed_organizations",
			"Resubscribed organizations",
			"type/Integer",
		],
		["resubscription_pct", "Resubscription (%)", "type/Decimal"],
		["new_organizations", "New organizations", "type/Integer"],
		["went_dark_organizations", "Went dark organizations", "type/Integer"],
		["below_gate_organizations", "Below gate organizations", "type/Integer"],
		["converted_organizations", "Converted organizations", "type/Integer"],
		["closing_accrued_value_usd", "Closing accrued value", "type/Decimal"],
		["closing_paid_value_usd", "Closing paid value", "type/Decimal"],
		["data_through", "Data through", "type/DateTime"],
	];
	return definitions.map(([name, displayName, baseType]) => ({
		name,
		displayName,
		baseType,
	}));
}

export function buildSubscriptionLifecycle(input: {
	asOf: Date;
	organizations: LifecycleOrganization[];
	subscriptions: LifecycleSubscription[];
}): MetabaseResult {
	const end = monthStart(input.asOf);
	const start = addMonths(end, -6);
	const dataThrough = end.toISOString();
	const organizationById = new Map(
		input.organizations.map((organization) => [organization.id, organization]),
	);
	const subscriptionsByOrganization = new Map<
		string,
		LifecycleSubscription[]
	>();
	for (const subscription of input.subscriptions) {
		const values =
			subscriptionsByOrganization.get(subscription.organizationId) ?? [];
		values.push(subscription);
		subscriptionsByOrganization.set(subscription.organizationId, values);
	}
	const output: unknown[][] = [];
	for (let offset = 0; offset < 6; offset += 1) {
		const period = addMonths(start, offset);
		const next = addMonths(period, 1);
		const groups = new Map<
			string,
			{
				organization: LifecycleOrganization;
				plan: string;
				starting: number;
				retained: number;
				churned: number;
				resubscriptionEligible: number;
				resubscribed: number;
				newOrganizations: number;
			}
		>();
		for (const [organizationId, subscriptions] of subscriptionsByOrganization) {
			const organization = organizationById.get(organizationId);
			if (!organization) continue;
			const previousActive = subscriptions.filter((subscription) =>
				activeAt(subscription, period.getTime()),
			);
			const currentActive = subscriptions.filter((subscription) =>
				activeAt(subscription, next.getTime()),
			);
			const firstCreatedAt = Math.min(
				...subscriptions.map((subscription) => subscription.createdAt),
			);
			const startedThisMonth = subscriptions.some(
				(subscription) =>
					subscription.createdAt >= period.getTime() &&
					subscription.createdAt < next.getTime(),
			);
			const resubscriptionEligible =
				previousActive.length === 0 && firstCreatedAt < period.getTime();
			if (
				previousActive.length === 0 &&
				currentActive.length === 0 &&
				!resubscriptionEligible
			) {
				continue;
			}
			const activePlan = [...currentActive, ...previousActive].sort(
				(a, b) => b.createdAt - a.createdAt,
			)[0]?.plan;
			const plan = activePlan ?? organization.plan;
			const key = [
				organization.segment,
				organization.billingVersion,
				organization.signupCohort,
				plan,
			].join("\u0000");
			const group = groups.get(key) ?? {
				organization,
				plan,
				starting: 0,
				retained: 0,
				churned: 0,
				resubscriptionEligible: 0,
				resubscribed: 0,
				newOrganizations: 0,
			};
			if (previousActive.length > 0) group.starting += 1;
			if (previousActive.length > 0 && currentActive.length > 0) {
				group.retained += 1;
			}
			if (previousActive.length > 0 && currentActive.length === 0) {
				group.churned += 1;
			}
			if (resubscriptionEligible) group.resubscriptionEligible += 1;
			if (
				resubscriptionEligible &&
				currentActive.length > 0 &&
				startedThisMonth
			) {
				group.resubscribed += 1;
			}
			if (
				currentActive.length > 0 &&
				firstCreatedAt >= period.getTime() &&
				firstCreatedAt < next.getTime()
			) {
				group.newOrganizations += 1;
			}
			groups.set(key, group);
		}
		for (const group of groups.values()) {
			output.push(
				row({
					periodStart: date(period),
					lifecycleSeries: "subscription",
					organizationSegment: group.organization.segment,
					billingVersion: group.organization.billingVersion,
					signupCohort: group.organization.signupCohort,
					plan: group.plan,
					horizon: "M1",
					startingOrganizations: group.starting,
					retainedOrganizations: group.retained,
					retentionPct: percent(group.retained, group.starting),
					churnedOrganizations: group.churned,
					churnPct: percent(group.churned, group.starting),
					returnedOrganizations: null,
					returnPct: null,
					requalifiedOrganizations: null,
					requalificationPct: null,
					resubscriptionEligibleOrganizations: group.resubscriptionEligible,
					resubscribedOrganizations: group.resubscribed,
					resubscriptionPct: percent(
						group.resubscribed,
						group.resubscriptionEligible,
					),
					newOrganizations: group.newOrganizations,
					wentDarkOrganizations: null,
					belowGateOrganizations: null,
					convertedOrganizations: null,
					closingAccruedValueUsd: null,
					closingPaidValueUsd: null,
					dataThrough,
				}),
			);
		}
	}
	return { columns: columns(), rows: output };
}

async function queryAll(
	client: MetabaseClient,
	databaseExternalId: string,
	query: string,
	eligibility: TinybirdEligibilitySnapshot,
	service: TinybirdEligibilityService,
): Promise<Array<Record<string, unknown>>> {
	const governed = service.govern(
		`${query}\nlimit ${MAX_ROWS}`,
		databaseExternalId,
		eligibility,
	);
	const result = await client.preview({
		language: "SQL",
		queryText: governed.queryText,
		databaseExternalId,
	});
	if (result.rows.length >= MAX_ROWS) {
		throw new Error(`Product analytics query reached ${MAX_ROWS} rows.`);
	}
	return result.rows.map((values) =>
		Object.fromEntries(
			result.columns.map((column, index) => [
				column.name,
				values[index] ?? null,
			]),
		),
	);
}

export async function organizationLifecycleReport(input: {
	query: ProductAnalyticsQuery;
	metabase: MetabaseClient;
	eligibility: TinybirdEligibilitySnapshot;
	tinybirdEligibility: TinybirdEligibilityService;
}): Promise<MetabaseResult> {
	const [productResult, organizationRows, subscriptionRows] = await Promise.all(
		[
			input.metabase.preview({
				language: "SQL",
				queryText: input.tinybirdEligibility.govern(
					PRODUCT_LIFECYCLE_SQL,
					"34",
					input.eligibility,
				).queryText,
				databaseExternalId: "34",
			}),
			queryAll(
				input.metabase,
				"34",
				ORGANIZATIONS_SQL,
				input.eligibility,
				input.tinybirdEligibility,
			),
			queryAll(
				input.metabase,
				"166",
				SUBSCRIPTIONS_SQL,
				input.eligibility,
				input.tinybirdEligibility,
			),
		],
	);
	const organizations = organizationRows.map(
		(value): LifecycleOrganization => ({
			id: String(value.organization_id),
			signupCohort: String(value.signup_cohort).slice(0, 10),
			billingVersion: String(value.billing_version),
			plan: String(value.plan),
			segment: String(value.organization_segment),
		}),
	);
	const subscriptions = subscriptionRows.flatMap(
		(value): LifecycleSubscription[] => {
			const createdAt = timestamp(value.created_at);
			if (createdAt === null) return [];
			return [
				{
					id: String(value.id),
					organizationId: String(value.organization_id),
					createdAt,
					currentPeriodEnd: timestamp(value.current_period_end),
					cancelAt: timestamp(value.cancel_at),
					canceledAt: timestamp(value.canceled_at),
					plan: String(value.plan),
				},
			];
		},
	);
	const subscriptionResult = buildSubscriptionLifecycle({
		asOf: new Date(),
		organizations,
		subscriptions,
	});
	const dataThrough = monthStart(new Date()).toISOString();
	const productRows = productResult.rows.map((values) =>
		productResult.columns.map((column, index) => {
			if (column.name === "data_through") {
				return dataThrough;
			}
			return values[index] ?? null;
		}),
	);
	const subscriptionRowsWithWatermark = subscriptionResult.rows.map((values) =>
		values.map((value, index) =>
			index === subscriptionResult.columns.length - 1 ? dataThrough : value,
		),
	);
	return {
		columns: columns(),
		rows: [...productRows, ...subscriptionRowsWithWatermark].sort(
			(left, right) =>
				[left[0], left[1], left[2], left[3], left[4], left[5]]
					.map(String)
					.join("\u0000")
					.localeCompare(
						[right[0], right[1], right[2], right[3], right[4], right[5]]
							.map(String)
							.join("\u0000"),
					),
		),
	};
}
