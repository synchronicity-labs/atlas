UPDATE "dataSource"
SET
  "label" = 'Metabase finance revenue model',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'atlas:revenue';

UPDATE "dashboard"
SET
  "description" = 'Finance-correct monthly product revenue, reconciliation, and retention. Earlier question versions preserve the Rudy close quirks for audit.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-dashboard';

UPDATE "question"
SET
  "description" = CASE "number"
    WHEN 1001 THEN 'Finance-correct monthly product run-rate: ended-at paid usage plus one deduplicated latest-state licensed invoice item per Stripe item.'
    WHEN 1002 THEN 'Generation cost grouped by generationEndedAt for organizations with a non-empty paid plan type.'
    WHEN 1003 THEN 'Licensed paid or open Stripe invoice items deduplicated to one latest reliable state per invoice-item id.'
    WHEN 1004 THEN 'Native SQL equivalent of Metabase question 1256; direct saved-card execution remains permission blocked.'
    WHEN 1005 THEN 'Paid collections deduplicated to one latest reliable state per Stripe invoice id.'
    WHEN 1006 THEN 'Paid and open billings deduplicated to one latest reliable state per Stripe invoice id.'
    WHEN 1008 THEN 'Finance-correct paid usage and licensed subscription base for six completed months and current month to date.'
    WHEN 1009 THEN 'Native-equivalent paid customer revenue plus deduplicated collections and billings for six completed months and current month to date.'
    WHEN 1011 THEN 'Annualized finance-correct product run-rate for each completed month.'
    WHEN 1012 THEN 'Distinct paid-plan organizations with usage grouped by generationEndedAt.'
    ELSE "description"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" IN (1001, 1002, 1003, 1004, 1005, 1006, 1008, 1009, 1011, 1012);

UPDATE "questionVersion"
SET "sourceCardExternalId" = '1256'
WHERE "questionId" = (SELECT "id" FROM "question" WHERE "number" = 1004)
  AND "version" = 2;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-revenue-version-run-rate-v3-finance-correct',
    (SELECT "id" FROM "question" WHERE "number" = 1001),
    3, 'SQL',
    $query$with paid_usage as (
  select
    toStartOfMonth("generationEndedAt") as month,
    sum("generationCostMillicents") / 100000.0 as paid_usage_accrual
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addMonths(toStartOfMonth(today()), -2)
    and "generationEndedAt" < toStartOfMonth(today())
    and "organizationPlanType" is not null
    and "organizationPlanType" <> ''
  group by 1
), licensed_items as (
  select
    id,
    argMax(toStartOfMonth("createdAt"), state_rank) as month,
    argMax(amount, state_rank) as amount,
    argMax("priceType", state_rank) as price_type,
    argMax("customerId", state_rank) as customer_id,
    argMax(status, state_rank) as status
  from (
    select *,
      multiIf(status = 'paid', 4, status = 'void', 3, status = 'uncollectible', 2, status = 'open', 1, 0) as state_rank
    from sync_prod.sync_stripe_invoice_items
    where "createdAt" >= addMonths(toStartOfMonth(today()), -2)
      and "createdAt" < toStartOfMonth(today())
  )
  group by id
), licensed_base as (
  select month, sum(amount) / 100.0 as licensed_subscription_base
  from licensed_items
  where status in ('paid', 'open')
    and price_type = 'licensed'
    and customer_id not in ('cus_S1GousK6vr6sck', 'cus_T412vRZpb4RIVb')
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
    'atlas-revenue-version-paid-usage-v2-ended-at',
    (SELECT "id" FROM "question" WHERE "number" = 1002),
    2, 'SQL',
    $query$select
  toStartOfMonth("generationEndedAt") as month,
  sum("generationCostMillicents") / 100000.0 as usage_usd,
  uniqExact("organizationId") as orgs
from sync_prod.sync_usage3
where "generationEndedAt" >= addMonths(toStartOfMonth(today()), -2)
  and "generationEndedAt" < toStartOfMonth(today())
  and "organizationPlanType" is not null
  and "organizationPlanType" <> ''
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-licensed-base-v3-deduped',
    (SELECT "id" FROM "question" WHERE "number" = 1003),
    3, 'SQL',
    $query$with licensed_items as (
  select
    id,
    argMax(toStartOfMonth("createdAt"), state_rank) as month,
    argMax(amount, state_rank) as amount,
    argMax("priceType", state_rank) as price_type,
    argMax("customerId", state_rank) as customer_id,
    argMax(status, state_rank) as status
  from (
    select *,
      multiIf(status = 'paid', 4, status = 'void', 3, status = 'uncollectible', 2, status = 'open', 1, 0) as state_rank
    from sync_prod.sync_stripe_invoice_items
    where "createdAt" >= addMonths(toStartOfMonth(today()), -2)
      and "createdAt" < toStartOfMonth(today())
  )
  group by id
)
select month, sum(amount) / 100.0 as subs_usd
from licensed_items
where status in ('paid', 'open')
  and price_type = 'licensed'
  and customer_id not in ('cus_S1GousK6vr6sck', 'cus_T412vRZpb4RIVb')
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-collections-v3-deduped',
    (SELECT "id" FROM "question" WHERE "number" = 1005),
    3, 'SQL',
    $query$with invoices as (
  select
    id,
    argMax(toStartOfMonth("createdAt"), state_rank) as month,
    argMax("amountPaid", state_rank) as amount_paid,
    argMax("customerId", state_rank) as customer_id,
    argMax(status, state_rank) as status
  from (
    select *,
      multiIf(status = 'paid', 4, status = 'void', 3, status = 'uncollectible', 2, status = 'open', 1, 0) as state_rank
    from sync_prod.sync_stripe_invoices
    where "createdAt" >= addMonths(toStartOfMonth(today()), -2)
      and "createdAt" < toStartOfMonth(today())
  )
  group by id
)
select
  month,
  sumIf(amount_paid, status = 'paid') / 100.0 as collections_usd,
  countIf(status = 'paid') as invoices,
  uniqExactIf(customer_id, status = 'paid') as customers
from invoices
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-billings-v3-deduped',
    (SELECT "id" FROM "question" WHERE "number" = 1006),
    3, 'SQL',
    $query$with invoices as (
  select
    id,
    argMax(toStartOfMonth("createdAt"), state_rank) as month,
    argMax("amountDue", state_rank) as amount_due,
    argMax("amountPaid", state_rank) as amount_paid,
    argMax(status, state_rank) as status
  from (
    select *,
      multiIf(status = 'paid', 4, status = 'void', 3, status = 'uncollectible', 2, status = 'open', 1, 0) as state_rank
    from sync_prod.sync_stripe_invoices
    where "createdAt" >= addMonths(toStartOfMonth(today()), -2)
      and "createdAt" < toStartOfMonth(today())
  )
  group by id
)
select
  month,
  sumIf(amount_due, status in ('paid', 'open')) / 100.0 as amount_due_usd,
  sumIf(amount_paid, status in ('paid', 'open')) / 100.0 as amount_paid_usd
from invoices
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-run-rate-history-v3-finance-correct',
    (SELECT "id" FROM "question" WHERE "number" = 1008),
    3, 'SQL',
    $query$with months as (
  select addMonths(toStartOfMonth(today()), -6 + toInt32(number)) as month
  from numbers(7)
), paid_usage as (
  select
    toStartOfMonth("generationEndedAt") as month,
    sum("generationCostMillicents") / 100000.0 as paid_usage_accrual
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addMonths(toStartOfMonth(today()), -6)
    and "generationEndedAt" < now()
    and "organizationPlanType" is not null
    and "organizationPlanType" <> ''
  group by 1
), licensed_items as (
  select
    id,
    argMax(toStartOfMonth("createdAt"), state_rank) as month,
    argMax(amount, state_rank) as amount,
    argMax("priceType", state_rank) as price_type,
    argMax("customerId", state_rank) as customer_id,
    argMax(status, state_rank) as status
  from (
    select *,
      multiIf(status = 'paid', 4, status = 'void', 3, status = 'uncollectible', 2, status = 'open', 1, 0) as state_rank
    from sync_prod.sync_stripe_invoice_items
    where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
      and "createdAt" < now()
  )
  group by id
), licensed_base as (
  select month, sum(amount) / 100.0 as licensed_subscription_base
  from licensed_items
  where status in ('paid', 'open')
    and price_type = 'licensed'
    and customer_id not in ('cus_S1GousK6vr6sck', 'cus_T412vRZpb4RIVb')
  group by 1
)
select
  months.month,
  ifNull(paid_usage.paid_usage_accrual, 0) as paid_usage_accrual,
  ifNull(licensed_base.licensed_subscription_base, 0) as licensed_subscription_base
from months
left join paid_usage on paid_usage.month = months.month
left join licensed_base on licensed_base.month = months.month
order by months.month$query$,
    'bar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-reconciliation-history-v5-deduped',
    (SELECT "id" FROM "question" WHERE "number" = 1009),
    5, 'SQL',
    $query$with months as (
  select addMonths(toStartOfMonth(today()), -6 + toInt32(number)) as month
  from numbers(7)
), paid_customer as (
  select
    toDate(concat(source.month, '-01')) as month,
    sum(source.revenue_usd) as paid_customer_revenue
  from sync_prod.paid_customer_monthly_revenue source
  where source.month >= formatDateTime(addMonths(toStartOfMonth(today()), -6), '%Y-%m')
    and source.month < formatDateTime(addMonths(toStartOfMonth(today()), 1), '%Y-%m')
  group by 1
), invoices as (
  select
    id,
    argMax(toStartOfMonth("createdAt"), state_rank) as month,
    argMax("amountPaid", state_rank) as amount_paid,
    argMax("amountDue", state_rank) as amount_due,
    argMax(status, state_rank) as status
  from (
    select *,
      multiIf(status = 'paid', 4, status = 'void', 3, status = 'uncollectible', 2, status = 'open', 1, 0) as state_rank
    from sync_prod.sync_stripe_invoices
    where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
      and "createdAt" < now()
  )
  group by id
), invoice_rollup as (
  select
    month,
    sumIf(amount_paid, status = 'paid') / 100.0 as paid_collections,
    sumIf(amount_due, status in ('paid', 'open')) / 100.0 as paid_open_billings
  from invoices
  group by 1
)
select
  months.month,
  ifNull(paid_customer.paid_customer_revenue, 0) as paid_customer_revenue,
  ifNull(invoice_rollup.paid_collections, 0) as paid_collections,
  ifNull(invoice_rollup.paid_open_billings, 0) as paid_open_billings
from months
left join paid_customer on paid_customer.month = months.month
left join invoice_rollup on invoice_rollup.month = months.month
order by months.month$query$,
    'bar', '{}'::jsonb, '1256', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-annualized-run-rate-v2-finance-correct',
    (SELECT "id" FROM "question" WHERE "number" = 1011),
    2, 'SQL',
    $query$with paid_usage as (
  select
    toStartOfMonth("generationEndedAt") as month,
    sum("generationCostMillicents") / 100000.0 as paid_usage_accrual
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addMonths(toStartOfMonth(today()), -2)
    and "generationEndedAt" < toStartOfMonth(today())
    and "organizationPlanType" is not null
    and "organizationPlanType" <> ''
  group by 1
), licensed_items as (
  select
    id,
    argMax(toStartOfMonth("createdAt"), state_rank) as month,
    argMax(amount, state_rank) as amount,
    argMax("priceType", state_rank) as price_type,
    argMax("customerId", state_rank) as customer_id,
    argMax(status, state_rank) as status
  from (
    select *,
      multiIf(status = 'paid', 4, status = 'void', 3, status = 'uncollectible', 2, status = 'open', 1, 0) as state_rank
    from sync_prod.sync_stripe_invoice_items
    where "createdAt" >= addMonths(toStartOfMonth(today()), -2)
      and "createdAt" < toStartOfMonth(today())
  )
  group by id
), licensed_base as (
  select month, sum(amount) / 100.0 as licensed_subscription_base
  from licensed_items
  where status in ('paid', 'open')
    and price_type = 'licensed'
    and customer_id not in ('cus_S1GousK6vr6sck', 'cus_T412vRZpb4RIVb')
  group by 1
)
select
  paid_usage.month,
  (paid_usage.paid_usage_accrual + licensed_base.licensed_subscription_base) * 12 as annualized_run_rate
from paid_usage
join licensed_base using (month)
order by month$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-paid-usage-organizations-v2-ended-at',
    (SELECT "id" FROM "question" WHERE "number" = 1012),
    2, 'SQL',
    $query$select
  toStartOfMonth("generationEndedAt") as month,
  uniqExact("organizationId") as paid_usage_organizations
from sync_prod.sync_usage3
where "generationEndedAt" >= addMonths(toStartOfMonth(today()), -2)
  and "generationEndedAt" < toStartOfMonth(today())
  and "organizationPlanType" is not null
  and "organizationPlanType" <> ''
  and "organizationId" is not null
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO NOTHING;
