UPDATE "question"
SET
  "name" = CASE "number"
    WHEN 1008 THEN 'Product run-rate composition · history + MTD'
    WHEN 1009 THEN 'Revenue reconciliation · history + MTD'
    WHEN 1010 THEN 'Usage-spend NDR · history + MTD'
    ELSE "name"
  END,
  "description" = CASE "number"
    WHEN 1008 THEN 'Paid usage and licensed subscription base for the latest six completed months and current month to date.'
    WHEN 1009 THEN 'Paid customer revenue, paid collections, and paid plus open billings for the latest six completed months and current month to date.'
    WHEN 1010 THEN 'Usage-spend net dollar retention for the latest six completed month cohorts and current month to date.'
    ELSE "description"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" BETWEEN 1008 AND 1010;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-revenue-version-run-rate-history-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1008),
    2, 'SQL',
    $query$with paid_usage as (
  select
    toStartOfMonth("generationCreatedAt") as month,
    sum("generationCostMillicents") / 100000.0 as paid_usage_accrual
  from sync_prod.sync_usage3
  where "generationCreatedAt" >= addMonths(toStartOfMonth(today()), -6)
    and "generationCreatedAt" < now()
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
    and i."createdAt" < now()
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
    'atlas-revenue-version-reconciliation-history-v4',
    (SELECT "id" FROM "question" WHERE "number" = 1009),
    4, 'SQL',
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
), collections as (
  select
    toStartOfMonth("createdAt") as month,
    sum("amountPaid") / 100.0 as paid_collections
  from sync_prod.sync_stripe_invoices_paid
  where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
    and "createdAt" < now()
  group by 1
), billings as (
  select
    toStartOfMonth("createdAt") as month,
    sum("amountDue") / 100.0 as paid_open_billings
  from sync_prod.sync_stripe_invoices
  where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
    and "createdAt" < now()
    and status in ('paid', 'open')
  group by 1
)
select
  months.month,
  ifNull(paid_customer.paid_customer_revenue, 0) as paid_customer_revenue,
  ifNull(collections.paid_collections, 0) as paid_collections,
  ifNull(billings.paid_open_billings, 0) as paid_open_billings
from months
left join paid_customer on paid_customer.month = months.month
left join collections on collections.month = months.month
left join billings on billings.month = months.month
order by months.month$query$,
    'bar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-ndr-history-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1010),
    2, 'SQL',
    $query$with monthly_org_usage as (
  select
    toStartOfMonth("generationEndedAt") as month,
    "organizationId" as org_id,
    sum("generationCostMillicents") / 100000.0 as usage_spend_usd
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addMonths(toStartOfMonth(today()), -7)
    and "generationEndedAt" < now()
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
    and addMonths(p.month, 1) <= toStartOfMonth(today())
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

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-revenue-question-annualized-run-rate', 1011,
    'Annualized product run-rate',
    'Monthly product accrual run-rate multiplied by twelve.',
    'ATLAS', 'atlas-revenue-source', 'revenue:annualized-run-rate',
    'rudy:monthly-revenue', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-question-paid-usage-organizations', 1012,
    'Paid usage organizations',
    'Organizations contributing paid usage accrual in each completed month.',
    'ATLAS', 'atlas-revenue-source', 'revenue:paid-usage-organizations',
    'rudy:monthly-revenue', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-question-ndr-starting-spend', 1013,
    'NDR starting cohort spend',
    'Previous-month usage spend for the cohort used in the NDR calculation.',
    'ATLAS', 'atlas-revenue-source', 'revenue:ndr-starting-spend',
    'rudy:monthly-revenue', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-question-ndr-retained-spend', 1014,
    'NDR retained cohort spend',
    'Current-month usage spend retained from the NDR starting cohort.',
    'ATLAS', 'atlas-revenue-source', 'revenue:ndr-retained-spend',
    'rudy:monthly-revenue', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("number") DO NOTHING;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-revenue-version-annualized-run-rate-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1011),
    1, 'SQL',
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
  (paid_usage.paid_usage_accrual + licensed_base.licensed_subscription_base) * 12 as annualized_run_rate
from paid_usage
join licensed_base using (month)
order by month$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-paid-usage-organizations-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1012),
    1, 'SQL',
    $query$select
  toStartOfMonth("generationCreatedAt") as month,
  uniqExact("organizationId") as paid_usage_organizations
from sync_prod.sync_usage3
where "generationCreatedAt" >= addMonths(toStartOfMonth(today()), -2)
  and "generationCreatedAt" < toStartOfMonth(today())
  and "organizationPlanType" is not null
  and "organizationPlanType" <> ''
  and "organizationId" is not null
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-ndr-starting-spend-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1013),
    1, 'SQL',
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
select month, sum(prev_spend) as starting_usage_spend
from pairs
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-version-ndr-retained-spend-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1014),
    1, 'SQL',
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
select month, sum(curr_spend) as retained_usage_spend
from pairs
group by 1
order by 1$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO NOTHING;

UPDATE "dashboardCard"
SET
  "y" = CASE
    WHEN "id" IN ('atlas-revenue-card-run-rate-history', 'atlas-revenue-card-reconciliation-history') THEN 20
    WHEN "id" = 'atlas-revenue-card-ndr-history' THEN 29
    ELSE "y"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'atlas-revenue-card-run-rate-history',
  'atlas-revenue-card-reconciliation-history',
  'atlas-revenue-card-ndr-history'
);

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-revenue-card-annualized-run-rate', 'atlas-revenue-dashboard',
    'atlas-revenue-dashboard-tab', 'atlas-revenue-question-annualized-run-rate',
    7, 0, 15, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-card-paid-usage-organizations', 'atlas-revenue-dashboard',
    'atlas-revenue-dashboard-tab', 'atlas-revenue-question-paid-usage-organizations',
    8, 6, 15, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-card-ndr-starting-spend', 'atlas-revenue-dashboard',
    'atlas-revenue-dashboard-tab', 'atlas-revenue-question-ndr-starting-spend',
    9, 12, 15, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-card-ndr-retained-spend', 'atlas-revenue-dashboard',
    'atlas-revenue-dashboard-tab', 'atlas-revenue-question-ndr-retained-spend',
    10, 18, 15, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO NOTHING;

UPDATE "dashboardCard"
SET
  "position" = CASE "id"
    WHEN 'atlas-revenue-card-run-rate-history' THEN 11
    WHEN 'atlas-revenue-card-reconciliation-history' THEN 12
    WHEN 'atlas-revenue-card-ndr-history' THEN 13
    ELSE "position"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'atlas-revenue-card-run-rate-history',
  'atlas-revenue-card-reconciliation-history',
  'atlas-revenue-card-ndr-history'
);
