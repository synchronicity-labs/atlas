import { DataSourceKind, QueryLanguage } from "@crm/db";
import type { CatalogCandidate } from "./metric-catalog.parser";

export type CatalogQuestionSpec = {
	sourceKey: string;
	connector: DataSourceKind;
	databaseExternalId: string | null;
	queryLanguage: QueryLanguage;
	queryText: string;
	display: string;
	visualization: Record<string, unknown>;
	provisionalDefinition: string;
};

const PAID_LOGO_RETENTION = `with
paid_subscription_ids as (
  select distinct "subscriptionId" as subscription_id
  from sync_prod.sync_stripe_invoices_paid
  where "subscriptionId" is not null
    and "subscriptionId" != ''
    and "amountPaid" > 0
),
subscription_states as (
  select
    subscriptions.id as subscription_id,
    argMax(
      subscriptions."organizationId",
      tuple(subscriptions."createdAt", subscriptions."currentPeriodStart", subscriptions."currentPeriodEnd")
    ) as organization_id,
    min(subscriptions."createdAt") as created_at,
    max(subscriptions."canceledAt") as canceled_at,
    argMax(
      lower(coalesce(subscriptions."orgPlan", 'unknown')),
      tuple(subscriptions."createdAt", subscriptions."currentPeriodStart", subscriptions."currentPeriodEnd")
    ) as tier
  from sync_prod.sync_stripe_subscriptions subscriptions
  inner join paid_subscription_ids paid
    on paid.subscription_id = subscriptions.id
  where subscriptions."organizationId" is not null
    and subscriptions."organizationId" != ''
  group by subscriptions.id
),
months as (
  select
    addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -number) as period_start,
    addMonths(period_start, 1) as period_end
  from numbers(8)
),
organization_months as (
  select
    months.period_start,
    months.period_end,
    subscriptions.organization_id,
    argMaxIf(
      subscriptions.tier,
      subscriptions.created_at,
      subscriptions.created_at < months.period_start
        and (isNull(subscriptions.canceled_at) or subscriptions.canceled_at >= months.period_start)
    ) as tier,
    countIf(
      subscriptions.created_at < months.period_start
        and (isNull(subscriptions.canceled_at) or subscriptions.canceled_at >= months.period_start)
    ) > 0 as active_at_start,
    countIf(
      subscriptions.created_at < months.period_end
        and (isNull(subscriptions.canceled_at) or subscriptions.canceled_at >= months.period_end)
    ) > 0 as active_at_end,
    countIf(
      subscriptions.canceled_at >= months.period_start
        and subscriptions.canceled_at < months.period_end
    ) > 0 as canceled_in_month
  from months
  cross join subscription_states subscriptions
  group by months.period_start, months.period_end, subscriptions.organization_id
)
select
  period_start,
  if(tier = '', 'unknown', tier) as tier,
  countIf(active_at_start) as starting_paid_organizations,
  countIf(active_at_start and canceled_in_month and not active_at_end) as churned_paid_organizations,
  starting_paid_organizations - churned_paid_organizations as retained_paid_organizations,
  round(100.0 * churned_paid_organizations / nullIf(starting_paid_organizations, 0), 2) as logo_churn_pct,
  round(100.0 * retained_paid_organizations / nullIf(starting_paid_organizations, 0), 2) as gross_logo_retention_pct,
  period_end <= toStartOfMonth(toTimeZone(now(), 'UTC')) as is_complete_month
from organization_months
where active_at_start
  and tier in ('hobbyist', 'creator', 'growth', 'scale')
group by period_start, period_end, tier
order by period_start, tier`;

const REVENUE_CONCENTRATION = `with monthly_org_usage as (
  select
    toStartOfMonth(toTimeZone("generationEndedAt", 'UTC')) as month,
    "organizationId" as organization_id,
    sum("generationCostMillicents") / 100000.0 as accrued_usage_usd
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -6)
    and "generationEndedAt" < toTimeZone(now(), 'UTC')
    and "organizationId" != ''
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
  group by month, organization_id
), ranked as (
  select
    month,
    organization_id,
    accrued_usage_usd,
    row_number() over (partition by month order by accrued_usage_usd desc) as revenue_rank,
    sum(accrued_usage_usd) over (partition by month) as month_total_accrued_usage_usd
  from monthly_org_usage
)
select
  month,
  round(100.0 * sumIf(accrued_usage_usd, revenue_rank = 1) / nullIf(max(month_total_accrued_usage_usd), 0), 2) as top_1_org_pct,
  round(100.0 * sumIf(accrued_usage_usd, revenue_rank <= 5) / nullIf(max(month_total_accrued_usage_usd), 0), 2) as top_5_orgs_pct,
  count() as paying_organizations,
  max(month_total_accrued_usage_usd) as total_accrued_usage_usd
from ranked
group by month
order by month`;

const ACTIVE_RATE = `with professional_orgs as (
  select
    toStartOfMonth(toTimeZone("generationCreatedAt", 'UTC')) as month,
    "organizationId" as organization_id
  from sync_prod.sync_usage3
  where "generationCreatedAt" >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -6)
    and "generationCreatedAt" < toTimeZone(now(), 'UTC')
    and "organizationId" != ''
    and "organizationPlanType" in ('hobbyist', 'creator', 'growth', 'scale')
  group by month, organization_id
  having countDistinct("generationId") >= 3
    and countDistinct(toDate(toTimeZone("generationCreatedAt", 'UTC'))) >= 2
    and sum("generationCostMillicents") / 100000.0 >= 100
), paid_orgs as (
  select
    toStartOfMonth(toTimeZone("createdAt", 'UTC')) as month,
    "organizationId" as organization_id
  from sync_prod.sync_stripe_invoices_paid
  where "createdAt" >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -6)
    and "createdAt" < toTimeZone(now(), 'UTC')
    and "organizationId" != ''
    and "amountPaid" > 0
  group by month, organization_id
), months as (
  select month from professional_orgs
  union distinct
  select month from paid_orgs
)
select
  months.month,
  countDistinct(professional_orgs.organization_id) as professional_organizations,
  countDistinct(paid_orgs.organization_id) as paid_organizations,
  round(100.0 * professional_organizations / nullIf(paid_organizations, 0), 2) as active_rate_pct
from months
left join professional_orgs on professional_orgs.month = months.month
left join paid_orgs on paid_orgs.month = months.month
group by months.month
order by months.month`;

const INFERENCE_MARGIN = JSON.stringify({
	months: 7,
	report: "margin-pct",
	source: "atlas_economics",
	warehouseSql: `select
  toStartOfMonth("generationEndedAt") as month,
  ifNull(nullIf(model, ''), 'unknown') as model,
  sumIf("frameCount", "organizationPlanType" is null or "organizationPlanType" = '') as free_frames,
  sumIf("frameCount", "organizationPlanType" is not null and "organizationPlanType" <> '') as paid_frames,
  sumIf("generationCostMillicents", "organizationPlanType" is not null and "organizationPlanType" <> '') / 100000.0 as usage_revenue_usd
from sync_prod.sync_usage3
where "generationEndedAt" >= addMonths(toStartOfMonth(today()), -6)
  and "generationEndedAt" < now()
group by month, model
order by month, model`,
	definitionVersion: "inference-economics-v1",
});

function key(candidate: CatalogCandidate): string {
	return candidate.title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function catalogQuestionSpec(
	candidate: CatalogCandidate,
): CatalogQuestionSpec | null {
	switch (key(candidate)) {
		case "gross logo retention":
			return {
				sourceKey: "atlas:revenue",
				connector: DataSourceKind.METABASE,
				databaseExternalId: "166",
				queryLanguage: QueryLanguage.SQL,
				queryText: PAID_LOGO_RETENTION,
				display: "line",
				visualization: {},
				provisionalDefinition:
					"Approved: the share of organizations with a paid Stripe subscription active at the start of a UTC month that did not fully cancel during that month. A cancellation counts only when the last paid subscription has a Stripe cancellation timestamp in the month and no paid subscription remains active at month end. Canceling and resubscribing in the same month does not count as churn.",
			};
		case "sows/ msa's signed":
			return {
				sourceKey: "hubspot:crm",
				connector: DataSourceKind.HUBSPOT,
				databaseExternalId: null,
				queryLanguage: QueryLanguage.API,
				queryText: JSON.stringify({
					source: "hubspot",
					report: "closed-won",
					months: 13,
					pipelines: [],
				}),
				display: "bar",
				visualization: {},
				provisionalDefinition:
					"Provisional: HubSpot closed-won deals by close month. HubSpot does not expose a signed-contract timestamp in the current Atlas scope.",
			};
		case "gross margin":
			return {
				sourceKey: "atlas:economics",
				connector: DataSourceKind.ATLAS,
				databaseExternalId: "166",
				queryLanguage: QueryLanguage.API,
				queryText: INFERENCE_MARGIN,
				display: "line",
				visualization: {},
				provisionalDefinition:
					"Provisional: product usage revenue less measured inference cost. This is contribution margin, not company gross margin, until the full COGS policy is approved.",
			};
		case "revenue concentration":
			return {
				sourceKey: "atlas:revenue",
				connector: DataSourceKind.METABASE,
				databaseExternalId: "166",
				queryLanguage: QueryLanguage.SQL,
				queryText: REVENUE_CONCENTRATION,
				display: "line",
				visualization: {},
				provisionalDefinition:
					"Provisional: top-one and top-five organization share of monthly accrued paid usage. Subscription and services revenue are not included yet.",
			};
		case "active rate (north star ÷ paid teams)":
			return {
				sourceKey: "atlas:revenue",
				connector: DataSourceKind.METABASE,
				databaseExternalId: "166",
				queryLanguage: QueryLanguage.SQL,
				queryText: ACTIVE_RATE,
				display: "line",
				visualization: {},
				provisionalDefinition:
					"Provisional: V2 professional organizations divided by organizations with paid invoices in the same UTC month.",
			};
		default:
			return null;
	}
}
