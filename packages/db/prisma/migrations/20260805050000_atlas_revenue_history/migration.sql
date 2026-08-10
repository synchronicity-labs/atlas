INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-revenue-question-run-rate-history', 1008,
    'Product run-rate composition · 6 months',
    'Paid usage and licensed subscription base for the six latest completed months.',
    'ATLAS', 'atlas-revenue-source', 'revenue:product-run-rate-history',
    'rudy:monthly-revenue', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-question-reconciliation-history', 1009,
    'Revenue reconciliation · 6 months',
    'Paid customer revenue, paid collections, and paid plus open billings for the six latest completed months.',
    'ATLAS', 'atlas-revenue-source', 'revenue:reconciliation-history',
    'rudy:monthly-revenue', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-question-ndr-history', 1010,
    'Usage-spend NDR · 6 months',
    'Usage-spend net dollar retention for the six latest completed month cohorts.',
    'ATLAS', 'atlas-revenue-source', 'revenue:usage-spend-ndr-history',
    'rudy:monthly-revenue', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("number") DO NOTHING;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-revenue-version-run-rate-history-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1008),
    1, 'SQL',
    $query$with paid_usage as (
  select
    toStartOfMonth("generationCreatedAt") as month,
    sum("generationCostMillicents") / 100000.0 as paid_usage_accrual
  from sync_prod.sync_usage3
  where "generationCreatedAt" >= addMonths(toStartOfMonth(today()), -6)
    and "generationCreatedAt" < toStartOfMonth(today())
    and "organizationPlanType" is not null
    and "organizationPlanType" <> ''
  group by 1
), licensed_base as (
  select
    toStartOfMonth(i."createdAt") as month,
    sum(i.amount) / 100.0 as licensed_subscription_base
  from sync_prod.sync_stripe_invoice_items i
  left join sync_prod.sync_stripe_invoices_pipe p on i."invoiceId" = p.id
  where i.status = 'paid'
    and i."priceType" = 'licensed'
    and i."createdAt" >= addMonths(toStartOfMonth(today()), -6)
    and i."createdAt" < toStartOfMonth(today())
    and p."amountPaid" > 0
    and i."customerId" not in ('cus_S1GousK6vr6sck', 'cus_T412vRZpb4RIVb')
  group by 1
)
select
  paid_usage.month,
  paid_usage.paid_usage_accrual,
  licensed_base.licensed_subscription_base
from paid_usage
join licensed_base using (month)
order by month$query$,
    'bar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-reconciliation-history-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1009),
    1, 'SQL',
    $query$with months as (
  select addMonths(toStartOfMonth(today()), -6 + toInt32(number)) as month
  from numbers(6)
), paid_customer as (
  select
    toDate(concat(month, '-01')) as month,
    sum(revenue_usd) as paid_customer_revenue
  from sync_prod.paid_customer_monthly_revenue
  where month >= formatDateTime(addMonths(toStartOfMonth(today()), -6), '%Y-%m')
    and month < formatDateTime(toStartOfMonth(today()), '%Y-%m')
  group by 1
), collections as (
  select
    toStartOfMonth("createdAt") as month,
    sum("amountPaid") / 100.0 as paid_collections
  from sync_prod.sync_stripe_invoices_paid
  where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
    and "createdAt" < toStartOfMonth(today())
  group by 1
), billings as (
  select
    toStartOfMonth("createdAt") as month,
    sum("amountDue") / 100.0 as paid_open_billings
  from sync_prod.sync_stripe_invoices
  where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
    and "createdAt" < toStartOfMonth(today())
    and status in ('paid', 'open')
  group by 1
)
select
  months.month,
  ifNull(paid_customer.paid_customer_revenue, 0) as paid_customer_revenue,
  ifNull(collections.paid_collections, 0) as paid_collections,
  ifNull(billings.paid_open_billings, 0) as paid_open_billings
from months
left join paid_customer using (month)
left join collections using (month)
left join billings using (month)
order by month$query$,
    'bar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-ndr-history-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1010),
    1, 'SQL',
    $query$with monthly_org_usage as (
  select
    toStartOfMonth("generationEndedAt") as month,
    "organizationId" as org_id,
    sum("generationCostMillicents") / 100000.0 as usage_spend_usd
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addMonths(toStartOfMonth(today()), -7)
    and "generationEndedAt" < toStartOfMonth(today())
    and "organizationId" is not null
    and "organizationPlanType" is not null
  group by 1, 2
), pairs as (
  select
    addMonths(p.month, 1) as month,
    p.org_id,
    p.usage_spend_usd as prev_spend,
    ifNull(c.usage_spend_usd, 0) as curr_spend
  from monthly_org_usage p
  left join monthly_org_usage c
    on c.org_id = p.org_id
    and c.month = addMonths(p.month, 1)
  where addMonths(p.month, 1) >= addMonths(toStartOfMonth(today()), -6)
    and addMonths(p.month, 1) < toStartOfMonth(today())
)
select
  month,
  sum(curr_spend) / nullIf(sum(prev_spend), 0) * 100 as usage_ndr_pct
from pairs
group by 1
order by 1$query$,
    'bar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-revenue-card-run-rate-history', 'atlas-revenue-dashboard',
    'atlas-revenue-dashboard-tab', 'atlas-revenue-question-run-rate-history',
    7, 0, 15, 12, 9, 'BAR', '{"stackType":"stacked"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-card-reconciliation-history', 'atlas-revenue-dashboard',
    'atlas-revenue-dashboard-tab', 'atlas-revenue-question-reconciliation-history',
    8, 12, 15, 12, 9, 'BAR', '{"stackType":"default"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-card-ndr-history', 'atlas-revenue-dashboard',
    'atlas-revenue-dashboard-tab', 'atlas-revenue-question-ndr-history',
    9, 0, 24, 24, 8, 'BAR', '{"stackType":"default"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO NOTHING;
