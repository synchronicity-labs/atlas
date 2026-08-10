INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-revenue-version-reconciliation-history-v2',
  (SELECT "id" FROM "question" WHERE "number" = 1009),
  2, 'SQL',
  $query$with months as (
  select addMonths(toStartOfMonth(today()), -6 + toInt32(number)) as month
  from numbers(6)
), paid_customer as (
  select
    toDate(concat(source.month, '-01')) as month,
    sum(source.revenue_usd) as paid_customer_revenue
  from sync_prod.paid_customer_monthly_revenue source
  where source.month >= formatDateTime(addMonths(toStartOfMonth(today()), -6), '%Y-%m')
    and source.month < formatDateTime(toStartOfMonth(today()), '%Y-%m')
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
)
ON CONFLICT ("questionId", "version") DO NOTHING;
