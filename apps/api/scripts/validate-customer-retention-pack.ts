import { MetabaseClient } from "../src/metabase/metabase.client";
import { metabaseConfig } from "../src/metabase/metabase.config";

const config = metabaseConfig();
if (!config) throw new Error("Metabase is not configured.");

const client = new MetabaseClient(config);

export const customerRetentionQueries = {
	countryCoverageDebug: `select
  count() as rows,
  countIf(JSONExtractString(payload, 'customer_address', 'country') != '') as address_country_rows,
  countIf(JSONExtractString(payload, 'customer_shipping', 'address', 'country') != '') as shipping_country_rows,
  countIf(JSONExtractString(payload, 'account_country') != '') as account_country_rows,
  countIf(JSONExtractString(payload, 'customer_country') != '') as customer_country_rows
from sync_prod.sync_stripe_invoices
where "createdAt" >= toStartOfYear(toTimeZone(now(), 'UTC'))`,
	countryMapDebug: `select
  customerId as customer_id,
  upper(argMax(coalesce(
    nullIf(JSONExtractString(payload, 'customer_address', 'country'), ''),
    'Unknown'
  ), "createdAt")) as country_code
from sync_prod.sync_stripe_invoices
where "createdAt" >= toStartOfYear(toTimeZone(now(), 'UTC'))
  and customerId != ''
group by customer_id
order by customer_id
limit 20`,
	logoChurnByTier: `with
customer_months as (
  select
    toDate(concat(month, '-01')) as month_start,
    customer_id,
    argMax(lower(plan), revenue_usd) as customer_tier
  from sync_prod.paid_customer_monthly_revenue
  where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by month_start, customer_id
),
pairs as (
  select
    addMonths(prior.month_start, 1) as period_start,
    prior.customer_tier as tier,
    prior.customer_id,
    current.customer_id as retained_customer_id
  from customer_months prior
  left join customer_months current
    on current.customer_id = prior.customer_id
   and current.month_start = addMonths(prior.month_start, 1)
  where period_start >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -7)
    and period_start <= toStartOfMonth(toTimeZone(now(), 'UTC'))
)
select
  period_start,
  tier,
  countDistinct(customer_id) as starting_paid_customers,
  countDistinctIf(customer_id, retained_customer_id != '') as retained_paid_customers,
  starting_paid_customers - retained_paid_customers as churned_paid_customers,
  round(100.0 * churned_paid_customers / nullIf(starting_paid_customers, 0), 2) as logo_churn_pct,
  period_start < toStartOfMonth(toTimeZone(now(), 'UTC')) as is_complete_month
from pairs
group by period_start, tier
order by period_start, tier`,
	revenueRetentionByTier: `with
customer_months as (
  select
    toDate(concat(month, '-01')) as month_start,
    customer_id,
    argMax(lower(plan), revenue_usd) as customer_tier,
    sum(revenue_usd) as customer_revenue_usd
  from sync_prod.paid_customer_monthly_revenue
  where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by month_start, customer_id
),
pairs as (
  select
    addMonths(prior.month_start, 1) as period_start,
    prior.customer_tier as tier,
    prior.customer_id,
    prior.customer_revenue_usd as prior_revenue_usd,
    coalesce(current.customer_revenue_usd, 0) as current_revenue_usd
  from customer_months prior
  left join customer_months current
    on current.customer_id = prior.customer_id
   and current.month_start = addMonths(prior.month_start, 1)
  where period_start >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -7)
    and period_start <= toStartOfMonth(toTimeZone(now(), 'UTC'))
)
select
  period_start,
  tier,
  countDistinct(customer_id) as starting_paid_customers,
  round(sum(prior_revenue_usd), 2) as starting_revenue_usd,
  round(sum(current_revenue_usd), 2) as retained_revenue_usd,
  round(sum(least(current_revenue_usd, prior_revenue_usd)), 2) as retained_revenue_capped_usd,
  round(100.0 * retained_revenue_usd / nullIf(starting_revenue_usd, 0), 2) as ndr_pct,
  round(100.0 * retained_revenue_capped_usd / nullIf(starting_revenue_usd, 0), 2) as grr_pct,
  period_start < toStartOfMonth(toTimeZone(now(), 'UTC')) as is_complete_month
from pairs
group by period_start, tier
order by period_start, tier`,
	cohortRevenueRetention: `with
customer_months as (
  select
    toDate(concat(month, '-01')) as month_start,
    customer_id,
    sum(revenue_usd) as customer_revenue_usd
  from sync_prod.paid_customer_monthly_revenue
  where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by month_start, customer_id
),
cohorts as (
  select customer_id, min(month_start) as cohort_month
  from customer_months
  group by customer_id
),
cohort_customers as (
  select
    cohorts.customer_id,
    cohorts.cohort_month,
    month_zero.customer_revenue_usd as month_0_revenue_usd
  from cohorts
  inner join customer_months month_zero
    on month_zero.customer_id = cohorts.customer_id
   and month_zero.month_start = cohorts.cohort_month
),
cohort_sizes as (
  select
    cohort_month,
    countDistinct(customer_id) as cohort_customers,
    sum(month_0_revenue_usd) as month_0_revenue_usd
  from cohort_customers
  group by cohort_month
),
retention as (
  select
    cohort_customers.cohort_month,
    dateDiff('month', cohort_customers.cohort_month, customer_months.month_start) as month_number,
    sum(customer_months.customer_revenue_usd) as retained_revenue_usd
  from cohort_customers
  inner join customer_months on customer_months.customer_id = cohort_customers.customer_id
  where month_number in (1, 3, 6, 12)
  group by cohort_customers.cohort_month, month_number
)
select
  sizes.cohort_month,
  sizes.cohort_customers,
  round(sizes.month_0_revenue_usd, 2) as month_0_revenue_usd,
  retention.month_number,
  round(retention.retained_revenue_usd, 2) as retained_revenue_usd,
  round(100.0 * retention.retained_revenue_usd / nullIf(sizes.month_0_revenue_usd, 0), 2) as revenue_retention_pct
from cohort_sizes sizes
inner join retention on retention.cohort_month = sizes.cohort_month
where sizes.cohort_month >= toDate('2025-01-01')
  and sizes.cohort_month < toStartOfMonth(toTimeZone(now(), 'UTC'))
order by sizes.cohort_month, retention.month_number`,
	usageActiveByTier: `with
month_bounds as (
  select
    addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -1) as month_start,
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_end
),
paid_customers as (
  select
    customer_id,
    argMax(lower(plan), revenue_usd) as tier
  from sync_prod.paid_customer_monthly_revenue
  cross join month_bounds
  where month = formatDateTime(month_start, '%Y-%m')
    and lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by customer_id
),
used_customers as (
  select distinct "stripeCustomerId" as customer_id
  from sync_prod.sync_usage3
  cross join month_bounds
  where "generationEndedAt" >= month_start
    and "generationEndedAt" < month_end
    and "frameCount" > 0
    and "stripeCustomerId" is not null
    and "stripeCustomerId" != ''
)
select
  month_bounds.month_start as period_start,
  paid.tier,
  countDistinct(paid.customer_id) as paid_customers,
  countDistinctIf(paid.customer_id, used.customer_id != '') as usage_active_customers,
  round(100.0 * usage_active_customers / nullIf(paid_customers, 0), 2) as usage_active_pct
from paid_customers paid
cross join month_bounds
left join used_customers used on used.customer_id = paid.customer_id
group by period_start, tier
order by tier`,
	realizedLtvByTier: `with
customer_months as (
  select
    toDate(concat(month, '-01')) as month_start,
    customer_id,
    argMax(lower(plan), revenue_usd) as customer_tier,
    sum(revenue_usd) as customer_revenue_usd
  from sync_prod.paid_customer_monthly_revenue
  where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by month_start, customer_id
),
cohorts as (
  select
    customer_id,
    argMin(customer_tier, month_start) as starting_tier,
    min(month_start) as cohort_month
  from customer_months
  group by customer_id
),
customer_lifetime_revenue as (
  select
    cohorts.customer_id,
    cohorts.starting_tier,
    cohorts.cohort_month,
    sum(customer_months.customer_revenue_usd) as lifetime_revenue_usd
  from cohorts
  inner join customer_months on customer_months.customer_id = cohorts.customer_id
  group by cohorts.customer_id, cohorts.starting_tier, cohorts.cohort_month
)
select
  starting_tier as tier,
  countDistinct(customer_id) as cohort_customers,
  round(sum(lifetime_revenue_usd) / nullIf(cohort_customers, 0), 2) as realized_ltv_usd,
  round(realized_ltv_usd * 0.65, 2) as gross_margin_adjusted_ltv_usd,
  round(gross_margin_adjusted_ltv_usd / 3.0, 2) as cac_target_usd
from customer_lifetime_revenue
where cohort_month >= toDate('2025-01-01')
  and cohort_month < toDate('2025-07-01')
group by starting_tier
order by realized_ltv_usd desc`,
	winbacks: `with
monthly as (
  select
    customer_id,
    toDate(concat(month, '-01')) as month_start,
    argMax(lower(plan), revenue_usd) as customer_tier,
    sum(revenue_usd) as customer_revenue_usd
  from sync_prod.paid_customer_monthly_revenue
  where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by customer_id, month_start
),
history as (
  select
    current.customer_id,
    current.month_start,
    current.customer_tier,
    current.customer_revenue_usd,
    countIf(prior.month_start < addMonths(current.month_start, -1)) as earlier_paid_months,
    countIf(prior.month_start = addMonths(current.month_start, -1)) as prior_month_paid
  from monthly current
  left join monthly prior on prior.customer_id = current.customer_id
  group by current.customer_id, current.month_start, current.customer_tier, current.customer_revenue_usd
)
select
  month_start as period_start,
  customer_tier as tier,
  countDistinctIf(customer_id, earlier_paid_months > 0 and prior_month_paid = 0) as won_back_customers,
  round(sumIf(customer_revenue_usd, earlier_paid_months > 0 and prior_month_paid = 0), 2) as won_back_revenue_usd
from history
where month_start >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -8)
group by period_start, tier
order by period_start, tier`,
	countryEconomics: `with
customer_months as (
  select
    toDate(concat(month, '-01')) as month_start,
    customer_id,
    sum(revenue_usd) as customer_revenue_usd
  from sync_prod.paid_customer_monthly_revenue
  where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by month_start, customer_id
),
customer_country as (
  select
    customerId as customer_id,
    upper(argMax(coalesce(
      nullIf(JSONExtractString(payload, 'customer_address', 'country'), ''),
      'Unknown'
    ), "createdAt")) as country_code
  from sync_prod.sync_stripe_invoices
  where "createdAt" >= toStartOfYear(toTimeZone(now(), 'UTC'))
    and customerId in (select customer_id from customer_months)
  group by customer_id
),
located_months as (
  select
    customer_months.month_start,
    customer_months.customer_id,
    customer_months.customer_revenue_usd,
    coalesce(customer_country.country_code, 'UNKNOWN') as country_code
  from customer_months
  left join customer_country on customer_country.customer_id = customer_months.customer_id
),
customer_totals as (
  select
    customer_id,
    any(country_code) as country_code,
    sum(customer_revenue_usd) as lifetime_revenue_usd,
    sumIf(customer_revenue_usd, toYear(month_start) = toYear(toTimeZone(now(), 'UTC'))) as ytd_revenue_usd,
    max(month_start = addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -1)) as active_latest_complete_month,
    groupUniqArray(month_start) as paid_months
  from located_months
  group by customer_id
),
customer_month_transitions as (
  select
    customer_id,
    country_code,
    paid_months,
    arrayJoin(arrayMap(month_value -> addMonths(month_value, 1), paid_months)) as period_start
  from customer_totals
),
monthly_churn as (
  select
    period_start,
    country_code,
    count() as starting_customers,
    countIf(not has(paid_months, period_start)) as churned_customers
  from customer_month_transitions
  where period_start >= toStartOfYear(toTimeZone(now(), 'UTC'))
    and period_start < toStartOfMonth(toTimeZone(now(), 'UTC'))
  group by period_start, country_code
),
country_customer_stats as (
  select
    customer_totals.country_code,
    sum(customer_totals.ytd_revenue_usd) as country_ytd_revenue_usd,
    countIf(customer_totals.active_latest_complete_month = 1) as latest_complete_month_active,
    sum(customer_totals.lifetime_revenue_usd) / nullIf(count(), 0) as country_realized_ltv_usd,
    count() as country_cohort_customers
  from customer_totals
  group by customer_totals.country_code
),
country_churn as (
  select
    country_code,
    sum(churned_customers) / nullIf(sum(starting_customers), 0) as average_monthly_churn_rate
  from monthly_churn
  group by country_code
),
country_totals as (
  select
    country_customer_stats.*,
    coalesce(country_churn.average_monthly_churn_rate, 0) as average_monthly_churn_rate
  from country_customer_stats
  left join country_churn using (country_code)
),
ranked as (
  select *, row_number() over (order by country_ytd_revenue_usd desc) as revenue_rank
  from country_totals
),
rolled as (
  select
    if(revenue_rank <= 12, country_code, 'OTHER') as country_group,
    sum(country_ytd_revenue_usd) as ytd_revenue_usd,
    sum(latest_complete_month_active) as latest_complete_month_active,
    sum(country_realized_ltv_usd * country_cohort_customers) / nullIf(sum(country_cohort_customers), 0) as realized_ltv_usd,
    sum(country_cohort_customers) as total_cohort_customers,
    sum(average_monthly_churn_rate * country_cohort_customers) / nullIf(sum(country_cohort_customers), 0) as average_monthly_churn_rate
  from ranked
  group by country_group
)
select
  country_group as country,
  round(ytd_revenue_usd, 2) as ytd_revenue_usd,
  round(100.0 * ytd_revenue_usd / nullIf(sum(ytd_revenue_usd) over (), 0), 2) as revenue_share_pct,
  latest_complete_month_active,
  round(100.0 * average_monthly_churn_rate, 2) as average_monthly_churn_pct,
  round(realized_ltv_usd, 2) as realized_ltv_usd,
  total_cohort_customers as cohort_customers
from rolled
order by if(country = 'OTHER', 2, 1), ytd_revenue_usd desc`,
} as const;

const selected = process.argv[2];
const queries = selected
	? ([[selected, customerRetentionQueries[selected as keyof typeof customerRetentionQueries]]] as const)
	: Object.entries(customerRetentionQueries);

for (const [name, queryText] of queries) {
	if (!queryText) throw new Error(`Unknown query: ${name}`);
	const startedAt = Date.now();
	const result = await client.preview({
		language: "SQL",
		queryText,
		databaseExternalId: "166",
	});
	console.log(
		JSON.stringify(
			{
				name,
				elapsedMs: Date.now() - startedAt,
				columns: result.columns.map((column) => column.name),
				rows: result.rows.slice(-20),
				rowCount: result.rows.length,
			},
			null,
			2,
		),
	);
}
