SELECT setval(
  '"public"."question_publicNumber_seq"',
  (SELECT max("publicNumber") FROM "question"),
  true
);

UPDATE "question"
SET
  "name" = 'Gross logo retention by plan',
  "description" = 'The share of paid self-serve organizations that remain subscribed at month end. An organization is lost only when its Stripe subscription is canceled during the month and it has no paid subscription active at month end. A cancellation followed by a new subscription in the same month is not churn.',
  "connector" = 'METABASE',
  "sourceId" = 'atlas-revenue-source',
  "sourceExternalId" = 'customer-economics:gross-logo-retention',
  "sourceDashboardExternalId" = 'atlas:customer-lifecycle:economics',
  "databaseExternalId" = '166',
  "status" = 'ACTIVE',
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 6027;

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-customer-economics-paid-invoice-revenue', 7400,
    'Paid invoice revenue by invoice month',
    'Paid Stripe invoice value assigned to the UTC month when the invoice was created. This is the governed revenue basis for the customer economics pack. It is not usage accrued, invoices still due, or cash received in a later month.',
    'METABASE', 'atlas-revenue-source', 'customer-economics:paid-invoice-revenue',
    'atlas:customer-lifecycle:economics', '166', 'ACTIVE', 'CERTIFIED',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-revenue-retention', 7401,
    'Paid invoice revenue retention by plan',
    'Net Dollar Retention and Gross Revenue Retention for the same paid customers from one UTC month to the next. Net Dollar Retention includes expansion. Gross Revenue Retention caps each customer at the prior-month amount, so expansion cannot hide contraction.',
    'METABASE', 'atlas-revenue-source', 'customer-economics:revenue-retention',
    'atlas:customer-lifecycle:economics', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-cohort-retention', 7402,
    'Paid invoice cohort revenue retention',
    'Revenue retained in months 1, 3, 6, and 12 after a customer first pays. Month zero is the earlier of the first positive paid-invoice month and the first successful Stripe payment month. Retained revenue uses paid invoices.',
    'METABASE', 'atlas-revenue-source', 'customer-economics:cohort-retention',
    'atlas:customer-lifecycle:economics', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-usage-active', 7403,
    'Usage-active subscribers by plan',
    'The share of organizations with a paid subscription active at the end of the latest complete UTC month that produced at least one frame during that month. This shows paid accounts that are active in the product and accounts that may be dormant before they cancel.',
    'METABASE', 'atlas-revenue-source', 'customer-economics:usage-active',
    'atlas:customer-lifecycle:economics', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-ltv', 7404,
    'Realized lifetime value and customer acquisition cost target',
    'Average paid-invoice revenue observed for 2025 first-pay cohorts. Gross-margin-adjusted lifetime value uses Matt''s current July serving-cost assumptions by plan. The acquisition-cost target divides that value by three. These are working assumptions, not board-approved policy.',
    'METABASE', 'atlas-revenue-source', 'customer-economics:realized-ltv',
    'atlas:customer-lifecycle:economics', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-winbacks', 7405,
    'Paid customer win-backs by plan',
    'Customers who paid in an earlier month, had no paid invoice in the previous month, and paid again in the selected month. Revenue is the paid-invoice value in the return month.',
    'METABASE', 'atlas-revenue-source', 'customer-economics:winbacks',
    'atlas:customer-lifecycle:economics', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "connector" = EXCLUDED."connector",
  "sourceId" = EXCLUDED."sourceId",
  "sourceExternalId" = EXCLUDED."sourceExternalId",
  "sourceDashboardExternalId" = EXCLUDED."sourceDashboardExternalId",
  "databaseExternalId" = EXCLUDED."databaseExternalId",
  "status" = EXCLUDED."status",
  "purpose" = EXCLUDED."purpose",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-customer-economics-gross-logo-retention-v8',
    (SELECT "id" FROM "question" WHERE "number" = 6027),
    8, 'SQL',
    $query$with paid_subscription_ids as (
  select distinct "subscriptionId" as subscription_id
  from sync_prod.sync_stripe_invoices_paid
  where "subscriptionId" is not null
    and "subscriptionId" != ''
    and "amountPaid" > 0
), subscription_states as (
  select
    subscriptions.id as subscription_id,
    argMax(subscriptions."organizationId", tuple(subscriptions."createdAt", subscriptions."currentPeriodStart", subscriptions."currentPeriodEnd")) as organization_id,
    min(subscriptions."createdAt") as created_at,
    max(subscriptions."canceledAt") as canceled_at,
    argMax(lower(coalesce(subscriptions."orgPlan", 'unknown')), tuple(subscriptions."createdAt", subscriptions."currentPeriodStart", subscriptions."currentPeriodEnd")) as tier
  from sync_prod.sync_stripe_subscriptions subscriptions
  inner join paid_subscription_ids paid on paid.subscription_id = subscriptions.id
  where subscriptions."organizationId" is not null
    and subscriptions."organizationId" != ''
  group by subscriptions.id
), months as (
  select
    addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -number) as period_start,
    addMonths(period_start, 1) as period_end
  from numbers(8)
), organization_months as (
  select
    months.period_start,
    months.period_end,
    subscriptions.organization_id,
    argMaxIf(subscriptions.tier, tuple(subscriptions.created_at, subscriptions.subscription_id), subscriptions.created_at < months.period_start and (isNull(subscriptions.canceled_at) or subscriptions.canceled_at >= months.period_start)) as tier,
    countIf(subscriptions.created_at < months.period_start and (isNull(subscriptions.canceled_at) or subscriptions.canceled_at >= months.period_start)) > 0 as active_at_start,
    countIf(subscriptions.created_at < months.period_end and (isNull(subscriptions.canceled_at) or subscriptions.canceled_at >= months.period_end)) > 0 as active_at_end,
    countIf(subscriptions.canceled_at >= months.period_start and subscriptions.canceled_at < months.period_end) > 0 as canceled_in_month
  from months
  cross join subscription_states subscriptions
  group by months.period_start, months.period_end, subscriptions.organization_id
)
select
  period_start,
  tier,
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
order by period_start, tier$query$,
    'line', '{"x":"period_start","series":["gross_logo_retention_pct","logo_churn_pct"],"groupBy":"tier","percentColumns":["gross_logo_retention_pct","logo_churn_pct"]}'::jsonb,
    NULL, 'atlas-customer-economics-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-paid-invoice-revenue-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7400),
    1, 'SQL',
    $query$select
  toStartOfMonth(toTimeZone("createdAt", 'UTC')) as period_start,
  round(sum("amountPaid") / 100.0, 2) as paid_invoice_revenue_usd,
  countDistinct(id) as paid_invoices,
  addMonths(period_start, 1) as period_end
from sync_prod.sync_stripe_invoices_paid
where "createdAt" >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -12)
  and "createdAt" < toStartOfMonth(toTimeZone(now(), 'UTC'))
  and "amountPaid" > 0
group by period_start
order by period_start$query$,
    'bar', '{"x":"period_start","series":["paid_invoice_revenue_usd"],"currencyColumns":["paid_invoice_revenue_usd"]}'::jsonb,
    NULL, 'atlas-customer-economics-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-revenue-retention-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7401),
    1, 'SQL',
    $query$with customer_months as (
  select
    toDate(concat(month, '-01')) as month_start,
    customer_id,
    argMax(lower(plan), revenue_usd) as customer_tier,
    sum(revenue_usd) as customer_revenue_usd
  from sync_prod.paid_customer_monthly_revenue
  where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by month_start, customer_id
), pairs as (
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
  round(100.0 * retained_revenue_usd / nullIf(starting_revenue_usd, 0), 2) as net_dollar_retention_pct,
  round(100.0 * retained_revenue_capped_usd / nullIf(starting_revenue_usd, 0), 2) as gross_revenue_retention_pct,
  period_start < toStartOfMonth(toTimeZone(now(), 'UTC')) as is_complete_month
from pairs
group by period_start, tier
order by period_start, tier$query$,
    'line', '{"x":"period_start","series":["net_dollar_retention_pct","gross_revenue_retention_pct"],"groupBy":"tier","percentColumns":["net_dollar_retention_pct","gross_revenue_retention_pct"]}'::jsonb,
    NULL, 'atlas-customer-economics-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-cohort-retention-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7402),
    1, 'SQL',
    $query$with customer_months as (
  select
    toDate(concat(month, '-01')) as month_start,
    customer_id,
    sum(revenue_usd) as customer_revenue_usd
  from sync_prod.paid_customer_monthly_revenue
  where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by month_start, customer_id
), cohort_events as (
  select customer_id, month_start
  from customer_months
  where customer_revenue_usd > 0
  union all
  select customerId, toStartOfMonth(toTimeZone("createdAt", 'UTC'))
  from sync_prod.sync_stripe_payments
  where lower(status) = 'succeeded' and customerId != ''
), cohorts as (
  select customer_id, min(month_start) as cohort_month
  from cohort_events
  group by customer_id
), cohort_customers as (
  select cohorts.customer_id, cohorts.cohort_month, coalesce(month_zero.customer_revenue_usd, 0) as month_0_revenue_usd
  from cohorts
  left join customer_months month_zero on month_zero.customer_id = cohorts.customer_id and month_zero.month_start = cohorts.cohort_month
), cohort_sizes as (
  select cohort_month, countDistinct(customer_id) as cohort_customers, sum(month_0_revenue_usd) as month_0_revenue_usd
  from cohort_customers
  group by cohort_month
), retention as (
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
  and sizes.month_0_revenue_usd > 0
order by sizes.cohort_month, retention.month_number$query$,
    'line', '{"x":"cohort_month","series":["revenue_retention_pct"],"groupBy":"month_number","percentColumns":["revenue_retention_pct"]}'::jsonb,
    NULL, 'atlas-customer-economics-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-usage-active-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7403),
    1, 'SQL',
    $query$with month_bounds as (
  select addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -1) as month_start, toStartOfMonth(toTimeZone(now(), 'UTC')) as month_end
), paid_subscription_ids as (
  select distinct "subscriptionId" as subscription_id
  from sync_prod.sync_stripe_invoices_paid
  where "subscriptionId" is not null and "subscriptionId" != '' and "amountPaid" > 0
), subscription_states as (
  select
    subscriptions.id as subscription_id,
    argMax(subscriptions."organizationId", tuple(subscriptions."createdAt", subscriptions.eventType)) as organization_id,
    argMax(lower(coalesce(subscriptions."orgPlan", 'unknown')), tuple(subscriptions."createdAt", subscriptions.eventType)) as tier,
    min(subscriptions."createdAt") as created_at,
    max(subscriptions."canceledAt") as canceled_at
  from sync_prod.sync_stripe_subscriptions subscriptions
  inner join paid_subscription_ids paid on paid.subscription_id = subscriptions.id
  group by subscriptions.id
), active_organizations as (
  select organization_id, argMax(tier, tuple(created_at, subscription_id)) as tier
  from subscription_states
  cross join month_bounds
  where organization_id != '' and created_at < month_end and (isNull(canceled_at) or canceled_at >= month_end)
  group by organization_id
  having tier in ('hobbyist', 'creator', 'growth', 'scale')
), used_organizations as (
  select distinct "organizationId" as organization_id
  from sync_prod.sync_usage3
  cross join month_bounds
  where "generationEndedAt" >= month_start
    and "generationEndedAt" < month_end
    and "frameCount" > 0
    and "organizationId" is not null
    and "organizationId" != ''
)
select
  month_bounds.month_start as period_start,
  active.tier,
  countDistinct(active.organization_id) as active_subscriber_organizations,
  countDistinctIf(active.organization_id, used.organization_id != '') as usage_active_organizations,
  round(100.0 * usage_active_organizations / nullIf(active_subscriber_organizations, 0), 2) as usage_active_pct
from active_organizations active
cross join month_bounds
left join used_organizations used on used.organization_id = active.organization_id
group by period_start, tier
order by tier$query$,
    'bar', '{"x":"tier","series":["usage_active_pct"],"percentColumns":["usage_active_pct"]}'::jsonb,
    NULL, 'atlas-customer-economics-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-ltv-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7404),
    1, 'SQL',
    $query$with customer_months as (
  select
    toDate(concat(month, '-01')) as month_start,
    customer_id,
    argMax(lower(plan), revenue_usd) as customer_tier,
    sum(revenue_usd) as customer_revenue_usd
  from sync_prod.paid_customer_monthly_revenue
  where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by month_start, customer_id
), cohorts as (
  select customer_id, argMin(customer_tier, month_start) as starting_tier, min(month_start) as cohort_month
  from customer_months
  group by customer_id
), customer_lifetime_revenue as (
  select cohorts.customer_id, cohorts.starting_tier, cohorts.cohort_month, sum(customer_months.customer_revenue_usd) as lifetime_revenue_usd
  from cohorts
  inner join customer_months on customer_months.customer_id = cohorts.customer_id
  group by cohorts.customer_id, cohorts.starting_tier, cohorts.cohort_month
)
select
  starting_tier as tier,
  countDistinct(customer_id) as cohort_customers,
  round(sum(lifetime_revenue_usd) / nullIf(cohort_customers, 0), 2) as realized_lifetime_value_usd,
  multiIf(starting_tier = 'hobbyist', 83, starting_tier = 'creator', 81, starting_tier = 'growth', 72, starting_tier = 'scale', 66, 0) as gross_margin_assumption_pct,
  round(realized_lifetime_value_usd * gross_margin_assumption_pct / 100.0, 2) as gross_margin_adjusted_lifetime_value_usd,
  round(gross_margin_adjusted_lifetime_value_usd / 3.0, 2) as customer_acquisition_cost_target_usd
from customer_lifetime_revenue
where cohort_month >= toDate('2025-01-01') and cohort_month < toDate('2025-07-01')
group by starting_tier
order by realized_lifetime_value_usd desc$query$,
    'table', '{"currencyColumns":["realized_lifetime_value_usd","gross_margin_adjusted_lifetime_value_usd","customer_acquisition_cost_target_usd"],"percentColumns":["gross_margin_assumption_pct"]}'::jsonb,
    NULL, 'atlas-customer-economics-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-winbacks-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7405),
    1, 'SQL',
    $query$with monthly as (
  select
    customer_id,
    toDate(concat(month, '-01')) as month_start,
    argMax(lower(plan), revenue_usd) as customer_tier,
    sum(revenue_usd) as customer_revenue_usd
  from sync_prod.paid_customer_monthly_revenue
  where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by customer_id, month_start
), history as (
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
order by period_start, tier$query$,
    'bar', '{"x":"period_start","series":["won_back_customers","won_back_revenue_usd"],"groupBy":"tier","currencyColumns":["won_back_revenue_usd"]}'::jsonb,
    NULL, 'atlas-customer-economics-registry', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-customer-lifecycle-tab-economics',
  (SELECT "id" FROM "dashboard" WHERE "number" = 9),
  3,
  'Customer economics',
  2,
  'atlas:customer-lifecycle:economics'
)
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES
  ('atlas-customer-economics-card-paid-invoice-revenue', (SELECT "id" FROM "dashboard" WHERE "number" = 9), 'atlas-customer-lifecycle-tab-economics', (SELECT "id" FROM "question" WHERE "number" = 7400), 0, 0, 0, 24, 7, 'BAR', '{"periodLabel":"Latest 12 complete UTC months"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-customer-economics-card-logo-retention', (SELECT "id" FROM "dashboard" WHERE "number" = 9), 'atlas-customer-lifecycle-tab-economics', (SELECT "id" FROM "question" WHERE "number" = 6027), 1, 0, 7, 12, 9, 'LINE', '{"periodLabel":"Latest 8 UTC months"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-customer-economics-card-revenue-retention', (SELECT "id" FROM "dashboard" WHERE "number" = 9), 'atlas-customer-lifecycle-tab-economics', (SELECT "id" FROM "question" WHERE "number" = 7401), 2, 12, 7, 12, 9, 'LINE', '{"periodLabel":"Latest 8 UTC months"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-customer-economics-card-cohort-retention', (SELECT "id" FROM "dashboard" WHERE "number" = 9), 'atlas-customer-lifecycle-tab-economics', (SELECT "id" FROM "question" WHERE "number" = 7402), 3, 0, 16, 12, 9, 'LINE', '{"periodLabel":"2025 onward"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-customer-economics-card-usage-active', (SELECT "id" FROM "dashboard" WHERE "number" = 9), 'atlas-customer-lifecycle-tab-economics', (SELECT "id" FROM "question" WHERE "number" = 7403), 4, 12, 16, 12, 9, 'BAR', '{"periodLabel":"Latest complete UTC month"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-customer-economics-card-ltv', (SELECT "id" FROM "dashboard" WHERE "number" = 9), 'atlas-customer-lifecycle-tab-economics', (SELECT "id" FROM "question" WHERE "number" = 7404), 5, 0, 25, 12, 9, 'TABLE', '{"compact":true,"periodLabel":"2025 first-pay cohorts"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-customer-economics-card-winbacks', (SELECT "id" FROM "dashboard" WHERE "number" = 9), 'atlas-customer-lifecycle-tab-economics', (SELECT "id" FROM "question" WHERE "number" = 7405), 6, 12, 25, 12, 9, 'BAR', '{"periodLabel":"Latest 9 UTC months"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "dashboardId" = EXCLUDED."dashboardId",
  "tabId" = EXCLUDED."tabId",
  "questionId" = EXCLUDED."questionId",
  "position" = EXCLUDED."position",
  "x" = EXCLUDED."x",
  "y" = EXCLUDED."y",
  "width" = EXCLUDED."width",
  "height" = EXCLUDED."height",
  "visualization" = EXCLUDED."visualization",
  "displaySettings" = EXCLUDED."displaySettings",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 9;
