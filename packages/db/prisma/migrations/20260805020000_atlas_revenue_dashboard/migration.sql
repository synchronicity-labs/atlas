DELETE FROM "activity" WHERE "createdById" LIKE 'seed-%';
DELETE FROM "deal" WHERE "ownerId" LIKE 'seed-%';
DELETE FROM "contact" WHERE "ownerId" LIKE 'seed-%';
DELETE FROM "company" WHERE "ownerId" LIKE 'seed-%';
DELETE FROM "member" WHERE "userId" LIKE 'seed-%';
DELETE FROM "user" WHERE "id" LIKE 'seed-%';

INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "lastSyncAt",
  "freshnessDeadlineAt", "createdAt", "updatedAt"
) VALUES (
  'atlas-revenue-source', 'atlas:revenue', 'ATLAS', 'Rudy monthly report',
  'HEALTHY', '2026-08-01T16:09:00.000Z', '2026-09-01T16:00:00.000Z',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-revenue-dashboard', 2, 'Monthly revenue run-rate & NDR',
  'Monthly product revenue, reconciliation, and retention view sent by Rudy to Prady.',
  1, 'rudy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-revenue-dashboard-tab', 'atlas-revenue-dashboard', 1,
  'Revenue close', 0, 'rudy:monthly-revenue'
);

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-revenue-question-run-rate', 1001, 'Product accrual run-rate',
    'Licensed subscription base plus paid usage accrual for each completed calendar month.',
    'ATLAS', 'atlas-revenue-source', 'revenue:product-run-rate',
    'rudy:monthly-revenue', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-question-paid-usage', 1002, 'Paid usage accrual',
    'Generation cost accrued by organizations with a non-empty paid plan type.',
    'ATLAS', 'atlas-revenue-source', 'revenue:paid-usage-accrual',
    'rudy:monthly-revenue', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-question-licensed-base', 1003, 'Licensed subscription base proxy',
    'Paid licensed Stripe invoice-item amounts used as a subscription base proxy.',
    'ATLAS', 'atlas-revenue-source', 'revenue:licensed-subscription-base',
    'rudy:monthly-revenue', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-question-paid-customer', 1004, 'Paid customer monthly revenue',
    'Saved Metabase question 1256 equivalent, replicated through read-only native SQL.',
    'ATLAS', 'atlas-revenue-source', 'revenue:paid-customer-revenue',
    'rudy:monthly-revenue', '34', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-question-collections', 1005, 'Stripe paid invoice collections',
    'Cash collections from paid Stripe invoices for each completed month.',
    'ATLAS', 'atlas-revenue-source', 'revenue:paid-invoice-collections',
    'rudy:monthly-revenue', '34', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-question-billings', 1006, 'Stripe paid + open invoice billings',
    'Amount due on paid and open Stripe invoices for reconciliation.',
    'ATLAS', 'atlas-revenue-source', 'revenue:paid-open-billings',
    'rudy:monthly-revenue', '34', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-question-ndr', 1007, 'Usage-spend NDR',
    'Current-period spend from the same prior-month starting organization cohort divided by starting spend.',
    'ATLAS', 'atlas-revenue-source', 'revenue:usage-spend-ndr',
    'rudy:monthly-revenue', '34', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-revenue-version-run-rate', 'atlas-revenue-question-run-rate', 1, 'SQL',
    $query$with paid_usage as (
  select
    date_trunc('month', "generationCreatedAt") as month,
    sum("generationCostMillicents") / 100000.0 as paid_usage_accrual
  from sync_prod.sync_usage3
  where "generationCreatedAt" >= toStartOfMonth(today()) - interval 2 month
    and "generationCreatedAt" < toStartOfMonth(today())
    and "organizationPlanType" is not null
    and "organizationPlanType" <> ''
  group by 1
), licensed_base as (
  select
    date_trunc('month', i."createdAt") as month,
    sum(i.amount) / 100.0 as licensed_subscription_base
  from sync_prod.sync_stripe_invoice_items i
  left join sync_prod.sync_stripe_invoices_pipe p on i."invoiceId" = p.id
  where i.status = 'paid'
    and i."priceType" = 'licensed'
    and i."createdAt" >= toStartOfMonth(today()) - interval 2 month
    and i."createdAt" < toStartOfMonth(today())
    and p."amountPaid" > 0
    and i."customerId" not in ('cus_S1GousK6vr6sck', 'cus_T412vRZpb4RIVb')
  group by 1
)
select
  paid_usage.month,
  paid_usage.paid_usage_accrual,
  licensed_base.licensed_subscription_base,
  paid_usage.paid_usage_accrual + licensed_base.licensed_subscription_base as product_run_rate
from paid_usage
join licensed_base using (month)
order by month$query$,
    'smartscalar', '{}'::jsonb, NULL, 'rudy', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-paid-usage', 'atlas-revenue-question-paid-usage', 1, 'SQL',
    $query$select
  date_trunc('month', "generationCreatedAt") as month,
  sum("generationCostMillicents") / 100000.0 as usage_usd,
  count(distinct "organizationId") as orgs
from sync_prod.sync_usage3
where "generationCreatedAt" >= toStartOfMonth(today()) - interval 2 month
  and "generationCreatedAt" < toStartOfMonth(today())
  and "organizationPlanType" is not null
  and "organizationPlanType" <> ''
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'rudy', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-licensed-base', 'atlas-revenue-question-licensed-base', 1, 'SQL',
    $query$select
  to_char(date_trunc('month', i."createdAt"), 'YYYY-MM') as month,
  sum(i.amount) / 100.0 as subs_usd
from sync_prod.sync_stripe_invoice_items i
left join sync_prod.sync_stripe_invoices_pipe p on i."invoiceId" = p.id
where i.status = 'paid'
  and i."priceType" = 'licensed'
  and i."createdAt" >= toStartOfMonth(today()) - interval 2 month
  and i."createdAt" < toStartOfMonth(today())
  and p."amountPaid" > 0
  and i."customerId" not in ('cus_S1GousK6vr6sck', 'cus_T412vRZpb4RIVb')
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'rudy', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-paid-customer', 'atlas-revenue-question-paid-customer', 1, 'SQL',
    $query$select
  month,
  count(distinct customer_id) as customers,
  sum(invoice_count) as invoices,
  sum(revenue_usd) as revenue_usd
from public.paid_customer_monthly_revenue
where month >= to_char(date_trunc('month', current_date) - interval '2 months', 'YYYY-MM')
  and month < to_char(date_trunc('month', current_date), 'YYYY-MM')
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'rudy', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-collections', 'atlas-revenue-question-collections', 1, 'SQL',
    $query$select
  date_trunc('month', "createdAt") as month,
  count(*) as invoices,
  count(distinct "customerId") as customers,
  sum("amountPaid") / 100.0 as collections_usd
from public.sync_stripe_invoices_paid
where "createdAt" >= date_trunc('month', current_date) - interval '2 months'
  and "createdAt" < date_trunc('month', current_date)
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'rudy', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-billings', 'atlas-revenue-question-billings', 1, 'SQL',
    $query$select
  date_trunc('month', "createdAt") as month,
  sum("amountDue") / 100.0 as amount_due_usd,
  sum("amountPaid") / 100.0 as amount_paid_usd
from public.sync_stripe_invoices
where "createdAt" >= date_trunc('month', current_date) - interval '2 months'
  and "createdAt" < date_trunc('month', current_date)
  and status in ('paid', 'open')
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'rudy', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-ndr', 'atlas-revenue-question-ndr', 1, 'SQL',
    $query$with monthly_org_usage as (
  select
    date_trunc('month', "generationEndedAt")::date as month,
    "organizationId" as org_id,
    sum("generationCostMillicents")::numeric / 100000.0 as usage_spend_usd
  from public.sync_usage3
  where "generationEndedAt" >= date_trunc('month', current_date) - interval '3 months'
    and "generationEndedAt" < date_trunc('month', current_date)
    and "organizationId" is not null
    and "organizationPlanType" is not null
  group by 1, 2
), pairs as (
  select
    (p.month + interval '1 month')::date as month,
    p.org_id,
    p.usage_spend_usd as prev_spend,
    coalesce(c.usage_spend_usd, 0) as curr_spend
  from monthly_org_usage p
  left join monthly_org_usage c
    on c.org_id = p.org_id
    and c.month = p.month + interval '1 month'
)
select
  month,
  count(*) as starting_orgs,
  sum(prev_spend) as starting_usage_spend,
  sum(curr_spend) as retained_usage_spend,
  sum(curr_spend) / nullif(sum(prev_spend), 0) as usage_ndr
from pairs
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'rudy', CURRENT_TIMESTAMP
  );

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES
  ('atlas-revenue-card-run-rate', 'atlas-revenue-dashboard', 'atlas-revenue-dashboard-tab', 'atlas-revenue-question-run-rate', 0, 0, 0, 12, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-revenue-card-ndr', 'atlas-revenue-dashboard', 'atlas-revenue-dashboard-tab', 'atlas-revenue-question-ndr', 1, 12, 0, 12, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-revenue-card-paid-usage', 'atlas-revenue-dashboard', 'atlas-revenue-dashboard-tab', 'atlas-revenue-question-paid-usage', 2, 0, 5, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-revenue-card-licensed-base', 'atlas-revenue-dashboard', 'atlas-revenue-dashboard-tab', 'atlas-revenue-question-licensed-base', 3, 8, 5, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-revenue-card-paid-customer', 'atlas-revenue-dashboard', 'atlas-revenue-dashboard-tab', 'atlas-revenue-question-paid-customer', 4, 16, 5, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-revenue-card-collections', 'atlas-revenue-dashboard', 'atlas-revenue-dashboard-tab', 'atlas-revenue-question-collections', 5, 0, 10, 12, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-revenue-card-billings', 'atlas-revenue-dashboard', 'atlas-revenue-dashboard-tab', 'atlas-revenue-question-billings', 6, 12, 10, 12, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "resultSnapshot" (
  "id", "idempotencyKey", "sourceId", "dashboardExternalId",
  "questionExternalId", "reportingPeriod", "capturedAt", "contentHash",
  "columns", "rows", "rowCount", "createdAt"
) VALUES
  ('atlas-revenue-snapshot-run-rate', 'atlas:revenue:product-run-rate:2026-07:v1', 'atlas-revenue-source', 'rudy:monthly-revenue', 'revenue:product-run-rate', '2026-07', '2026-08-01T16:09:00.000Z', 'revenue-product-run-rate-v1', '[{"name":"month","displayName":"Month","baseType":"type/DateTime"},{"name":"product_run_rate","displayName":"Product run-rate","baseType":"type/Decimal"}]'::jsonb, '[["2026-06-01T00:00:00.000Z",1104096],["2026-07-01T00:00:00.000Z",1319276]]'::jsonb, 2, CURRENT_TIMESTAMP),
  ('atlas-revenue-snapshot-paid-usage', 'atlas:revenue:paid-usage:2026-07:v1', 'atlas-revenue-source', 'rudy:monthly-revenue', 'revenue:paid-usage-accrual', '2026-07', '2026-08-01T16:09:00.000Z', 'revenue-paid-usage-v1', '[{"name":"month","displayName":"Month","baseType":"type/DateTime"},{"name":"paid_usage_accrual","displayName":"Paid usage accrual","baseType":"type/Decimal"}]'::jsonb, '[["2026-06-01T00:00:00.000Z",703969],["2026-07-01T00:00:00.000Z",854644]]'::jsonb, 2, CURRENT_TIMESTAMP),
  ('atlas-revenue-snapshot-licensed-base', 'atlas:revenue:licensed-base:2026-07:v1', 'atlas-revenue-source', 'rudy:monthly-revenue', 'revenue:licensed-subscription-base', '2026-07', '2026-08-01T16:09:00.000Z', 'revenue-licensed-base-v1', '[{"name":"month","displayName":"Month","baseType":"type/DateTime"},{"name":"licensed_subscription_base","displayName":"Licensed subscription base","baseType":"type/Decimal"}]'::jsonb, '[["2026-06-01T00:00:00.000Z",400126],["2026-07-01T00:00:00.000Z",464632]]'::jsonb, 2, CURRENT_TIMESTAMP),
  ('atlas-revenue-snapshot-paid-customer', 'atlas:revenue:paid-customer:2026-07:v1', 'atlas-revenue-source', 'rudy:monthly-revenue', 'revenue:paid-customer-revenue', '2026-07', '2026-08-01T16:09:00.000Z', 'revenue-paid-customer-v1', '[{"name":"month","displayName":"Month","baseType":"type/DateTime"},{"name":"paid_customer_revenue","displayName":"Paid customer revenue","baseType":"type/Decimal"}]'::jsonb, '[["2026-06-01T00:00:00.000Z",654313],["2026-07-01T00:00:00.000Z",616425]]'::jsonb, 2, CURRENT_TIMESTAMP),
  ('atlas-revenue-snapshot-collections', 'atlas:revenue:collections:2026-07:v1', 'atlas-revenue-source', 'rudy:monthly-revenue', 'revenue:paid-invoice-collections', '2026-07', '2026-08-01T16:09:00.000Z', 'revenue-collections-v1', '[{"name":"month","displayName":"Month","baseType":"type/DateTime"},{"name":"collections_usd","displayName":"Collections","baseType":"type/Decimal"}]'::jsonb, '[["2026-06-01T00:00:00.000Z",654313],["2026-07-01T00:00:00.000Z",616425]]'::jsonb, 2, CURRENT_TIMESTAMP),
  ('atlas-revenue-snapshot-billings', 'atlas:revenue:billings:2026-07:v1', 'atlas-revenue-source', 'rudy:monthly-revenue', 'revenue:paid-open-billings', '2026-07', '2026-08-01T16:09:00.000Z', 'revenue-billings-v1', '[{"name":"month","displayName":"Month","baseType":"type/DateTime"},{"name":"amount_due_usd","displayName":"Paid and open billings","baseType":"type/Decimal"}]'::jsonb, '[["2026-06-01T00:00:00.000Z",1447624],["2026-07-01T00:00:00.000Z",1338456]]'::jsonb, 2, CURRENT_TIMESTAMP),
  ('atlas-revenue-snapshot-ndr', 'atlas:revenue:ndr:2026-07:v1', 'atlas-revenue-source', 'rudy:monthly-revenue', 'revenue:usage-spend-ndr', '2026-07', '2026-08-01T16:09:00.000Z', 'revenue-ndr-v1', '[{"name":"month","displayName":"Month","baseType":"type/DateTime"},{"name":"usage_ndr_pct","displayName":"Usage-spend NDR","baseType":"type/Decimal"}]'::jsonb, '[["2026-06-01T00:00:00.000Z",88.1],["2026-07-01T00:00:00.000Z",106.5]]'::jsonb, 2, CURRENT_TIMESTAMP);
