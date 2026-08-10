UPDATE "dataSource"
SET "label" = 'Metabase revenue questions', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'atlas:revenue';

UPDATE "question"
SET "databaseExternalId" = '166', "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" BETWEEN 1001 AND 1007;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-revenue-version-run-rate-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1001),
    2,
    'SQL',
    $query$with paid_usage as (
  select
    toStartOfMonth("generationCreatedAt") as month,
    sum("generationCostMillicents") / 100000.0 as paid_usage_accrual
  from sync_prod.sync_usage3
  where "generationCreatedAt" >= addMonths(toStartOfMonth(today()), -2)
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
    and i."createdAt" >= addMonths(toStartOfMonth(today()), -2)
    and i."createdAt" < toStartOfMonth(today())
    and p."amountPaid" > 0
    and i."customerId" not in ('cus_S1GousK6vr6sck', 'cus_T412vRZpb4RIVb')
  group by 1
)
select
  paid_usage.month,
  paid_usage.paid_usage_accrual + licensed_base.licensed_subscription_base as product_run_rate,
  (paid_usage.paid_usage_accrual + licensed_base.licensed_subscription_base) * 12 as annualized_run_rate,
  paid_usage.paid_usage_accrual,
  licensed_base.licensed_subscription_base
from paid_usage
join licensed_base using (month)
order by month$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-licensed-base-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1003),
    2,
    'SQL',
    $query$select
  toStartOfMonth(i."createdAt") as month,
  sum(i.amount) / 100.0 as subs_usd
from sync_prod.sync_stripe_invoice_items i
left join sync_prod.sync_stripe_invoices_pipe p on i."invoiceId" = p.id
where i.status = 'paid'
  and i."priceType" = 'licensed'
  and i."createdAt" >= addMonths(toStartOfMonth(today()), -2)
  and i."createdAt" < toStartOfMonth(today())
  and p."amountPaid" > 0
  and i."customerId" not in ('cus_S1GousK6vr6sck', 'cus_T412vRZpb4RIVb')
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-paid-customer-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1004),
    2,
    'SQL',
    $query$select
  month,
  sum(revenue_usd) as revenue_usd,
  uniqExact(customer_id) as customers,
  sum(invoice_count) as invoices
from sync_prod.paid_customer_monthly_revenue
where month >= formatDateTime(addMonths(toStartOfMonth(today()), -2), '%Y-%m')
  and month < formatDateTime(toStartOfMonth(today()), '%Y-%m')
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-collections-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1005),
    2,
    'SQL',
    $query$select
  toStartOfMonth("createdAt") as month,
  sum("amountPaid") / 100.0 as collections_usd,
  count() as invoices,
  uniqExact("customerId") as customers
from sync_prod.sync_stripe_invoices_paid
where "createdAt" >= addMonths(toStartOfMonth(today()), -2)
  and "createdAt" < toStartOfMonth(today())
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-billings-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1006),
    2,
    'SQL',
    $query$select
  toStartOfMonth("createdAt") as month,
  sum("amountDue") / 100.0 as amount_due_usd,
  sum("amountPaid") / 100.0 as amount_paid_usd
from sync_prod.sync_stripe_invoices
where "createdAt" >= addMonths(toStartOfMonth(today()), -2)
  and "createdAt" < toStartOfMonth(today())
  and status in ('paid', 'open')
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-ndr-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1007),
    2,
    'SQL',
    $query$with monthly_org_usage as (
  select
    toStartOfMonth("generationEndedAt") as month,
    "organizationId" as org_id,
    sum("generationCostMillicents") / 100000.0 as usage_spend_usd
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addMonths(toStartOfMonth(today()), -3)
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
  where addMonths(p.month, 1) < toStartOfMonth(today())
)
select
  month,
  sum(curr_spend) / nullIf(sum(prev_spend), 0) * 100 as usage_ndr_pct,
  count() as starting_orgs,
  sum(prev_spend) as starting_usage_spend,
  sum(curr_spend) as retained_usage_spend
from pairs
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  );
