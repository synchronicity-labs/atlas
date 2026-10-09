import { productCollectionQueries } from "./product-collection";

export const qbrPlgMetricIds = [
	"plg_teams",
	"plg_teams_period_end",
	"plg_eligible_accounts",
	"plg_active_accounts",
	"plg_active_rate",
	"plg_teams_adds",
	"plg_teams_losses",
	"plg_teams_net",
	"product_m3_requalification",
	"product_m3_ndr",
	"product_reactivation",
];

export function isQbrPlgQuestion(externalId: string | null) {
	return qbrPlgMetricIds.some((id) => externalId === `qbr:${id}`);
}

export function isQbrPaidAccountQuestion(externalId: string | null) {
	return [
		"plg_eligible_accounts",
		"plg_active_accounts",
		"plg_active_rate",
	].some((id) => externalId === `qbr:${id}`);
}

export function isQbrEnterpriseUsageRetentionQuestion(
	externalId: string | null,
) {
	return externalId === "qbr:enterprise_usage_retention";
}

export function qbrQuarterValue(
	metricId: string,
	monthlyValues: {
		period: string;
		value: number;
		numerator: number | null;
		denominator: number | null;
		quarterValue?: number | null;
		quarterNumerator?: number | null;
		quarterDenominator?: number | null;
	}[],
	now = new Date(),
) {
	if (now.getTime() < Date.UTC(2026, 9, 1)) return null;
	if (metricId === "product_return_lift") {
		if (now.getTime() < Date.UTC(2026, 9, 15)) return null;
		const quarterValues = monthlyValues
			.map((item) => item.quarterValue)
			.filter((value): value is number => value != null);
		const quarterValue = quarterValues[0];
		if (
			quarterValue === undefined ||
			quarterValues.some((value) => !Number.isFinite(value)) ||
			new Set(quarterValues).size !== 1
		)
			return null;
		return {
			period: "2026-Q3" as const,
			value: quarterValue,
			numerator: null,
			denominator: null,
		};
	}
	const endpointMovements = [
		"plg_teams_adds",
		"plg_teams_losses",
		"plg_teams_net",
		"enterprise_usage_retention",
		"plg_eligible_accounts",
		"plg_active_accounts",
		"plg_active_rate",
	];
	if (
		![
			"plg_teams",
			"plg_teams_period_end",
			"platform_completion",
			"product_feedback_coverage",
			"product_attribution",
			...endpointMovements,
		].includes(metricId)
	)
		return null;
	const quarterMonths = ["2026-07", "2026-08", "2026-09"];
	if (
		[
			"plg_eligible_accounts",
			"plg_active_accounts",
			"plg_active_rate",
		].includes(metricId)
	) {
		const september = monthlyValues.find((item) => item.period === "2026-09");
		return september
			? {
					period: "2026-Q3" as const,
					value: september.value,
					numerator: september.numerator,
					denominator: september.denominator,
				}
			: null;
	}
	const values = monthlyValues.filter((item) =>
		quarterMonths.includes(item.period),
	);
	if (
		values.length !== quarterMonths.length ||
		quarterMonths.some(
			(month) => values.filter((item) => item.period === month).length !== 1,
		)
	)
		return null;
	if (endpointMovements.includes(metricId)) {
		const september = values.find((item) => item.period === "2026-09");
		if (
			september?.quarterValue == null ||
			!Number.isFinite(september.quarterValue)
		)
			return null;
		return {
			period: "2026-Q3" as const,
			value: september.quarterValue,
			numerator:
				metricId === "enterprise_usage_retention"
					? (september.quarterNumerator ?? null)
					: september.numerator,
			denominator:
				metricId === "enterprise_usage_retention"
					? (september.quarterDenominator ?? null)
					: september.denominator,
		};
	}
	if (metricId === "plg_teams")
		return {
			period: "2026-Q3" as const,
			value: values.reduce((sum, item) => sum + item.value, 0) / 3,
			numerator: null,
			denominator: null,
		};
	if (metricId === "plg_teams_period_end") {
		const september = values.find((item) => item.period === "2026-09");
		return september
			? {
					period: "2026-Q3" as const,
					value: september.value,
					numerator: september.numerator,
					denominator: september.denominator,
				}
			: null;
	}
	if (
		values.some(
			(item) =>
				item.numerator === null ||
				item.denominator === null ||
				!Number.isFinite(item.numerator) ||
				!Number.isFinite(item.denominator),
		)
	)
		return null;
	const numerator = values.reduce(
		(sum, item) => sum + (item.numerator ?? 0),
		0,
	);
	const denominator = values.reduce(
		(sum, item) => sum + (item.denominator ?? 0),
		0,
	);
	if (denominator <= 0 || numerator < 0) return null;
	return {
		period: "2026-Q3" as const,
		value: Math.round((10000 * numerator) / denominator) / 100,
		numerator,
		denominator,
	};
}

function monthlyProfessionalSource(through: string) {
	return `select toStartOfMonth(toTimeZone(generationEndedAt, 'UTC')) as month, organizationId,
  uniqExact(generationId) as billable_generations,
  uniqExact(toDate(generationEndedAt, 'UTC')) as active_days,
  sum(generationCostMillicents) / 100000.0 as accrued_value
from sync_prod.sync_usage3
where generationEndedAt >= toDateTime('2026-05-01 00:00:00', 'UTC')
  and generationEndedAt < toDateTime('${through} 00:00:00', 'UTC')
  and organizationId != ''
  and organizationPlanType in ('hobbyist','creator','growth','scale','starter','pro','team')
group by month, organizationId`;
}

export function qbrQuarterMovementQuery(monthlyOrgs: string) {
	return `with monthly_orgs as (${monthlyOrgs}), professional as (
  select month, organizationId from monthly_orgs
  where billable_generations >= 3 and active_days >= 2 and accrued_value >= 100
), quarter_membership as (
  select organizationId,
    maxIf(1, month = toDate('2026-06-01')) as starting,
    maxIf(1, month >= toDate('2026-07-01') and month < addMonths(toDate('2026-07-01'), 3)) as during,
    maxIf(1, month = toDate('2026-09-01')) as ending,
    maxIf(1, month < toDate('2026-07-01')) as had_history
  from professional
  group by organizationId
)
select
  countIf(starting = 1) as starting_teams,
  countIf(ending = 1) as ending_teams,
  countIf(starting = 0 and during = 1 and had_history = 0) as new_teams,
  countIf(starting = 0 and during = 1 and had_history = 1) as reactivated_teams,
  countIf(starting = 0 and during = 1) as gross_adds,
  countIf((starting = 1 or during = 1) and ending = 0) as gross_losses,
  countIf(ending = 1) - countIf(starting = 1) as net_change
from quarter_membership`;
}

function enterpriseUsageRetentionSource(through: string) {
	return `with organization_usage as (
  select toStartOfMonth(toTimeZone(generationEndedAt, 'UTC')) as month_start,
    organizationId as organization_id,
    stripeCustomerId as stripe_customer_id,
    sumIf(generationCostMillicents / 100000.0,
      frameCount > 0 and costPerFrameMillicents > 0 and generationCostMillicents > 0) as usage_value_usd
  from sync_prod.sync_usage3
  where generationEndedAt >= toDateTime('2026-04-01 00:00:00', 'UTC')
    and generationEndedAt < toDateTime('${through} 00:00:00', 'UTC')
  group by month_start, organization_id, stripe_customer_id
), customer_usage as (
  select month_start, stripe_customer_id, sum(usage_value_usd) as usage_value_usd
  from organization_usage
  where stripe_customer_id is not null and stripe_customer_id != ''
  group by month_start, stripe_customer_id
), monthly_periods as (
  select toDate('2026-07-01') as period_start, toDate('2026-06-01') as cohort_month
  union all select toDate('2026-08-01'), toDate('2026-07-01')
  union all select toDate('2026-09-01'), toDate('2026-08-01')
), monthly_metrics as (
  select periods.period_start, periods.cohort_month,
    sum(ifNull(current.usage_value_usd, 0)) as numerator,
    sum(base.usage_value_usd) as denominator
  from monthly_periods periods
  inner join customer_usage base
    on base.month_start = periods.cohort_month and base.usage_value_usd > 0
  left join customer_usage current
    on current.month_start = periods.period_start
      and current.stripe_customer_id = base.stripe_customer_id
  where periods.period_start < toDate('${through}')
  group by periods.period_start, periods.cohort_month
), monthly_unmapped as (
  select periods.period_start,
    countIf(usage.usage_value_usd > 0) as unmapped_base_customers
  from monthly_periods periods
  left join organization_usage usage
    on usage.month_start = periods.cohort_month
      and (usage.stripe_customer_id is null or usage.stripe_customer_id = '')
  where periods.period_start < toDate('${through}')
  group by periods.period_start
), q2_unmapped as (
  select uniqExactIf(organization_id, usage_value_usd > 0) as unmapped_base_customers
  from organization_usage
  where month_start >= toDate('2026-04-01') and month_start < toDate('2026-07-01')
    and (stripe_customer_id is null or stripe_customer_id = '')
), q2_base as (
  select stripe_customer_id, sum(usage_value_usd) as usage_value_usd
  from customer_usage
  where month_start >= toDate('2026-04-01') and month_start < toDate('2026-07-01')
  group by stripe_customer_id
  having usage_value_usd > 0
), q3_usage as (
  select stripe_customer_id, sum(usage_value_usd) as usage_value_usd
  from customer_usage
  where month_start >= toDate('2026-07-01') and month_start < toDate('${through}')
  group by stripe_customer_id
), q2_to_q3 as (
  select
    if(q2_unmapped.unmapped_base_customers = 0,
      sum(ifNull(q3.usage_value_usd, 0)), null) as numerator,
    if(q2_unmapped.unmapped_base_customers = 0,
      sum(q2.usage_value_usd), null) as denominator,
    q2_unmapped.unmapped_base_customers
  from q2_base q2
  left join q3_usage q3 using (stripe_customer_id)
  cross join q2_unmapped
  group by q2_unmapped.unmapped_base_customers
)
select monthly.period_start as period_start, monthly.cohort_month as cohort_month,
  if(monthly_unmapped.unmapped_base_customers = 0, monthly.numerator, null) as numerator,
  if(monthly_unmapped.unmapped_base_customers = 0, monthly.denominator, null) as denominator,
  if(monthly_unmapped.unmapped_base_customers = 0,
    round(100.0 * monthly.numerator / nullIf(monthly.denominator, 0), 2), null) as value,
  if(monthly.period_start = toDate('2026-09-01'), q2_to_q3.numerator, null) as quarter_numerator,
  if(monthly.period_start = toDate('2026-09-01'), q2_to_q3.denominator, null) as quarter_denominator,
  if(monthly.period_start = toDate('2026-09-01') and q2_to_q3.unmapped_base_customers = 0,
    round(100.0 * q2_to_q3.numerator / nullIf(q2_to_q3.denominator, 0), 2), null) as quarter_value,
  monthly_unmapped.unmapped_base_customers,
  q2_to_q3.unmapped_base_customers as quarter_unmapped_base_customers
from monthly_metrics monthly
inner join monthly_unmapped using (period_start)
cross join q2_to_q3
order by monthly.period_start`;
}

function paidAccountSource() {
	return `with cutoff as (
  select toDateTime('2026-09-30 23:59:59', 'UTC') as cutoff
), lifecycle as (
  select
    s.id as subscription_id,
    argMax(s.organizationId, tuple(s.currentPeriodStart, s.currentPeriodEnd, s.eventType)) as organization_id,
    argMax(s.customerId, tuple(s.currentPeriodStart, s.currentPeriodEnd, s.eventType)) as customer_id,
    argMax(s.status, tuple(s.currentPeriodStart, s.currentPeriodEnd, s.eventType)) as status,
    argMax(s.plan, tuple(s.currentPeriodStart, s.currentPeriodEnd, s.eventType)) as plan,
    argMax(s.currentPeriodStart, tuple(s.currentPeriodStart, s.currentPeriodEnd, s.eventType)) as period_start,
    argMax(s.currentPeriodEnd, tuple(s.currentPeriodStart, s.currentPeriodEnd, s.eventType)) as period_end,
    argMax(s.canceledAt, tuple(s.currentPeriodStart, s.currentPeriodEnd, s.eventType)) as canceled_at
  from sync_prod.sync_stripe_subscriptions_with_plan s
  cross join cutoff
  where s.createdAt <= cutoff.cutoff
  group by s.id
), subscriptions as (
  select *
  from lifecycle
  where plan in ('hobbyist', 'creator', 'growth', 'scale', 'starter', 'pro', 'team')
    and status in ('active', 'past_due')
    and period_start <= (select cutoff from cutoff)
    and period_end > (select cutoff from cutoff)
    and organization_id != ''
    and customer_id != ''
), accounts as (
  select
    organization_id,
    any(customer_id) as customer_id,
    groupUniqArray(subscription_id) as subscription_ids,
    count() as subscription_count,
    any(status) as status
  from subscriptions
  group by organization_id
), professional as (
  select
    organizationId as organization_id,
    uniqExact(generationId) as generations,
    uniqExact(toDate(generationEndedAt, 'UTC')) as active_days,
    sum(generationCostMillicents) / 100000.0 as accrued_value_usd
  from sync_prod.sync_usage3
  where generationEndedAt >= toDateTime('2026-09-01 00:00:00', 'UTC')
    and generationEndedAt < toDateTime('2026-09-30 23:59:59', 'UTC') + INTERVAL 1 SECOND
    and organizationId != ''
    and organizationPlanType in ('hobbyist', 'creator', 'growth', 'scale', 'starter', 'pro', 'team')
  group by organizationId
  having generations >= 3 and active_days >= 2 and accrued_value_usd >= 100
), joined as (
  select
    count() as eligible_accounts,
    countIf(professional.organization_id != '') as professional_accounts,
    countIf(accounts.status = 'active') as active_accounts,
    countIf(accounts.status = 'past_due') as past_due_accounts,
    countIf(accounts.subscription_count > 1) as multi_subscription_accounts
  from accounts
  left join professional using (organization_id)
), quality as (
  select countIf(subscription_count > 1) as lifecycle_ids_with_multiple_rows
  from (
    select id, count() as subscription_count
    from sync_prod.sync_stripe_subscriptions_with_plan
    where createdAt <= toDateTime('2026-09-30 23:59:59', 'UTC')
    group by id
  )
)
select
  toDate('2026-09-01') as period_start,
  eligible_accounts,
  professional_accounts,
  round(100.0 * professional_accounts / nullIf(eligible_accounts, 0), 2) as professional_rate,
  active_accounts,
  past_due_accounts,
  multi_subscription_accounts,
  quality.lifecycle_ids_with_multiple_rows
from joined cross join quality`;
}

export function qbrQueries(now = new Date()) {
	const through = new Date(
		Math.min(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
			Date.UTC(2026, 9, 1),
		),
	)
		.toISOString()
		.slice(0, 10);
	if (through <= "2026-07-01")
		throw new Error("No complete Q3 month is available.");
	const monthlyOrgs = monthlyProfessionalSource(through);
	const movement = `with monthly_orgs as (${monthlyOrgs}), professional as (
  select month, organizationId, 1 as qualified from monthly_orgs
  where billable_generations >= 3 and active_days >= 2 and accrued_value >= 100
), spine as (
  select month, organizationId from professional
  union distinct
  select addMonths(month, 1) as month, organizationId from professional
)
select s.month as period_start,
  countIf(c.qualified = 1) as professional_teams,
  countIf(c.qualified = 1 and coalesce(p.qualified, 0) != 1) as gross_adds,
  countIf(p.qualified = 1 and coalesce(c.qualified, 0) != 1) as gross_losses,
  countIf(c.qualified = 1) - countIf(p.qualified = 1) as net_change
from spine s
left join professional c on c.month = s.month and c.organizationId = s.organizationId
left join professional p on p.month = addMonths(s.month, -1) and p.organizationId = s.organizationId
where s.month >= toDate('2026-06-01') and s.month < toDate('${through}')
group by s.month`;
	const quarterMovement = qbrQuarterMovementQuery(monthlyOrgs);
	const cohorts = `with monthly_orgs as (${monthlyOrgs}), starting as (
  select * from monthly_orgs where billable_generations >= 3 and active_days >= 2 and accrued_value >= 100
)
select addMonths(p.month, 2) as period_start, p.month as cohort_month,
  count() as starting_teams,
  countIf(c.billable_generations >= 3 and c.active_days >= 2 and c.accrued_value >= 100) as requalified_teams,
  sum(p.accrued_value) as starting_accrued_usd,
  sum(coalesce(c.accrued_value,0)) as retained_accrued_usd,
  countIf(coalesce(m2.billable_generations,0) < 3 or coalesce(m2.active_days,0) < 2 or coalesce(m2.accrued_value,0) < 100) as dropped_m2_teams,
  countIf((coalesce(m2.billable_generations,0) < 3 or coalesce(m2.active_days,0) < 2 or coalesce(m2.accrued_value,0) < 100) and c.billable_generations >= 3 and c.active_days >= 2 and c.accrued_value >= 100) as reactivated_m3_teams
from starting p
left join monthly_orgs c on c.organizationId = p.organizationId and c.month = addMonths(p.month, 2)
left join monthly_orgs m2 on m2.organizationId = p.organizationId and m2.month = addMonths(p.month, 1)
where p.month >= toDate('2026-05-01') and addMonths(p.month, 2) < toDate('${through}')
group by p.month`;
	const queries: Record<
		string,
		{ queryText: string; databaseExternalId: string }
	> = {};
	for (const [id, column] of Object.entries({
		plg_teams: "professional_teams",
		plg_teams_period_end: "professional_teams",
		plg_teams_adds: "gross_adds",
		plg_teams_losses: "gross_losses",
		plg_teams_net: "net_change",
	})) {
		const quarterColumn =
			id === "plg_teams_adds"
				? "gross_adds"
				: id === "plg_teams_losses"
					? "gross_losses"
					: id === "plg_teams_net"
						? "net_change"
						: null;
		queries[id] = {
			databaseExternalId: "166",
			queryText: quarterColumn
				? `with monthly as (${movement}), quarter as (${quarterMovement})
select period_start, ${column} as value,
  if(period_start = toDate('2026-09-01'), quarter.${quarterColumn}, null) as quarter_value
from monthly cross join quarter order by period_start`
				: `select period_start, ${column} as value from (${movement}) order by period_start`,
		};
	}
	for (const [id, [numerator, denominator]] of Object.entries({
		product_m3_requalification: ["requalified_teams", "starting_teams"],
		product_m3_ndr: ["retained_accrued_usd", "starting_accrued_usd"],
		product_reactivation: ["reactivated_m3_teams", "dropped_m2_teams"],
	})) {
		queries[id] = {
			databaseExternalId: "166",
			queryText: `select period_start, cohort_month, ${numerator} as numerator, ${denominator} as denominator,
  round(100.0 * ${numerator} / nullIf(${denominator}, 0), 2) as value
from (${cohorts}) order by period_start`,
		};
	}
	queries.enterprise_usage_retention = {
		databaseExternalId: "166",
		queryText: enterpriseUsageRetentionSource(through),
	};
	for (const [id, valueColumn] of Object.entries({
		plg_eligible_accounts: "eligible_accounts",
		plg_active_accounts: "professional_accounts",
		plg_active_rate: "professional_rate",
	})) {
		queries[id] = {
			databaseExternalId: "166",
			queryText: `select period_start,
  ${valueColumn} as value,
  ${id === "plg_active_rate" ? "professional_accounts as numerator, eligible_accounts as denominator" : "null as numerator, null as denominator"}
from (${paidAccountSource()})`,
		};
	}
	queries.platform_completion = {
		databaseExternalId: "34",
		queryText: `select date_trunc('month', g.created_at at time zone 'UTC') as period_start,
  count(*) filter (where g.status::text = 'COMPLETED')::int as numerator,
  count(*) filter (where g.status::text in ('COMPLETED','FAILED','REJECTED','CANCELED','CANCELLED'))::int as denominator,
  round(100.0 * count(*) filter (where g.status::text = 'COMPLETED') / nullif(count(*) filter (where g.status::text in ('COMPLETED','FAILED','REJECTED','CANCELED','CANCELLED')), 0), 2)::float as value,
  count(*) filter (where g.status::text not in ('COMPLETED','FAILED','REJECTED','CANCELED','CANCELLED','PENDING','PROCESSING'))::int as unknown_status_count
from public.generations g
where g.created_at >= timestamptz '2026-07-01 00:00:00+00'
  and g.created_at < timestamptz '${through} 00:00:00+00'
  and g.deleted_at is null
group by 1 order by 1`,
	};
	return { ...queries, ...productCollectionQueries(through, now) };
}
