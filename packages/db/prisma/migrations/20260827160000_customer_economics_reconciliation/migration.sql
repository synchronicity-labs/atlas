UPDATE "question"
SET
  "name" = 'Paid invoice revenue by paid-event month',
  "description" = 'Paid Stripe invoice value assigned to the UTC month of the paid-invoice source event. This is Matt''s paid-invoice reporting basis. Successful standalone V3 top-ups are shown separately so they are not hidden to force a reference tie.',
  "purpose" = 'CERTIFIED',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 7400;

UPDATE "question"
SET
  "description" = 'Revenue retained in months 1, 3, 6, and 12 after a customer''s first positive paid-invoice month. Month zero and retained revenue both use paid invoices, so the cohort does not mix a successful V3 top-up with paid-invoice revenue.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 7402;

UPDATE "question"
SET
  "purpose" = 'CERTIFIED',
  "description" = 'Customers who paid in an earlier UTC month, had no paid invoice in the previous UTC month, and paid again in the selected month. Revenue is the paid-invoice value in the return month.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 7405;

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES (
  'atlas-customer-economics-reference-scope-bridge', 7406,
  'Paid invoice baseline and V3 top-up context',
  'Shows paid invoice revenue and successful standalone V3 top-up payments separately. The paid-invoice series is directly comparable with Matt''s reference panel. The V3 series stays visible even when that panel does not include it.',
  'METABASE', 'atlas-revenue-source', 'customer-economics:reference-scope-bridge',
  'atlas:customer-lifecycle:economics', '166', 'ACTIVE', 'CERTIFIED',
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
    'atlas-customer-economics-paid-invoice-revenue-v2',
    (SELECT "id" FROM "question" WHERE "number" = 7400),
    2, 'SQL',
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
    'atlas-customer-economics-cohort-retention-v2',
    (SELECT "id" FROM "question" WHERE "number" = 7402),
    2, 'SQL',
    $query$with customer_months as (
  select
    toDate(concat(month, '-01')) as month_start,
    customer_id,
    sum(revenue_usd) as customer_revenue_usd
  from sync_prod.paid_customer_monthly_revenue
  where lower(plan) in ('hobbyist', 'creator', 'growth', 'scale')
  group by month_start, customer_id
), cohorts as (
  select customer_id, min(month_start) as cohort_month
  from customer_months
  where customer_revenue_usd > 0
  group by customer_id
), cohort_customers as (
  select
    cohorts.customer_id,
    cohorts.cohort_month,
    coalesce(month_zero.customer_revenue_usd, 0) as month_0_revenue_usd
  from cohorts
  left join customer_months month_zero
    on month_zero.customer_id = cohorts.customer_id
   and month_zero.month_start = cohorts.cohort_month
), cohort_sizes as (
  select
    cohort_month,
    countDistinct(customer_id) as cohort_customers,
    sum(month_0_revenue_usd) as month_0_revenue_usd
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
    'line', '{"x":"month_number","series":["revenue_retention_pct"],"groupBy":"cohort_month","percentColumns":["revenue_retention_pct"]}'::jsonb,
    NULL, 'atlas-customer-economics-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-economics-winbacks-v2',
    (SELECT "id" FROM "question" WHERE "number" = 7405),
    2, 'SQL',
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
  ),
  (
    'atlas-customer-economics-reference-scope-bridge-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7406),
    1, 'SQL',
    $query$with paid_invoices as (
  select
    toStartOfMonth(toTimeZone("createdAt", 'UTC')) as period_start,
    round(sum("amountPaid") / 100.0, 2) as paid_invoice_revenue_usd,
    countDistinct(id) as paid_invoice_count
  from sync_prod.sync_stripe_invoices_paid
  where "createdAt" >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -12)
    and "createdAt" < toStartOfMonth(toTimeZone(now(), 'UTC'))
  group by period_start
), v3_top_ups as (
  select
    toStartOfMonth(toTimeZone("createdAt", 'UTC')) as period_start,
    round(sum(amount) / 100.0, 2) as successful_v3_top_up_payments_usd,
    countDistinct(id) as successful_v3_top_up_count
  from sync_prod.sync_stripe_payments
  where "createdAt" >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -12)
    and "createdAt" < toStartOfMonth(toTimeZone(now(), 'UTC'))
    and lower(status) = 'succeeded'
    and lower(coalesce("billingVersion", '')) = 'v3'
  group by period_start
)
select
  paid_invoices.period_start,
  paid_invoices.paid_invoice_revenue_usd,
  paid_invoices.paid_invoice_count,
  coalesce(v3_top_ups.successful_v3_top_up_payments_usd, 0) as successful_v3_top_up_payments_usd,
  coalesce(v3_top_ups.successful_v3_top_up_count, 0) as successful_v3_top_up_count,
  addMonths(paid_invoices.period_start, 1) as period_end,
  'V3 top-ups are context and are not removed to force a reference tie' as scope_note
from paid_invoices
left join v3_top_ups using (period_start)
order by period_start$query$,
    'bar', '{"x":"period_start","series":["paid_invoice_revenue_usd","successful_v3_top_up_payments_usd"],"currencyColumns":["paid_invoice_revenue_usd","successful_v3_top_up_payments_usd"]}'::jsonb,
    NULL, 'atlas-customer-economics-registry', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "sourceCardExternalId" = EXCLUDED."sourceCardExternalId",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-customer-economics-card-reference-scope-bridge',
  (SELECT "id" FROM "dashboard" WHERE "number" = 9),
  'atlas-customer-lifecycle-tab-economics',
  (SELECT "id" FROM "question" WHERE "number" = 7406),
  7, 0, 34, 24, 8, 'BAR',
  '{"periodLabel":"Latest 12 complete UTC months"}',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
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

SELECT setval(
  '"public"."question_publicNumber_seq"',
  (SELECT max("publicNumber") FROM "question"),
  true
);
