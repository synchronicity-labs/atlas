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

const PAID_LOGO_RETENTION = `with paid_org_months as (
  select
    toStartOfMonth(toTimeZone("createdAt", 'UTC')) as month,
    "organizationId" as organization_id
  from sync_prod.sync_stripe_invoices_paid
  where "createdAt" >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -7)
    and "createdAt" < toStartOfMonth(toTimeZone(now(), 'UTC'))
    and "organizationId" != ''
    and "amountPaid" > 0
  group by month, organization_id
), retention as (
  select
    current.month as starting_month,
    count() as starting_paid_organizations,
    countIf(next.organization_id != '') as retained_paid_organizations
  from paid_org_months current
  left join paid_org_months next
    on next.organization_id = current.organization_id
    and next.month = addMonths(current.month, 1)
  where current.month < (select max(month) from paid_org_months)
  group by current.month
)
select
  starting_month,
  starting_paid_organizations,
  retained_paid_organizations,
  round(100.0 * retained_paid_organizations / nullIf(starting_paid_organizations, 0), 2) as gross_logo_retention_pct
from retention
order by starting_month`;

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
					"Provisional: the share of organizations with paid invoices in one complete UTC month that also have paid invoices in the next month.",
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
