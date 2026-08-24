UPDATE "question"
SET
  "description" = 'Shows the current self-serve subscription run-rate beside paid licensed invoice items from the latest complete month and the current month. The live value uses today''s active and past-due subscriptions. The invoice-item values use when invoice items were created. They answer different questions and are not expected to match.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1123;

UPDATE "question"
SET
  "description" = 'Shows how much self-serve subscription and usage invoice value was due, paid, and still open for each invoice-creation month. The current month is still collecting, so an open invoice is not automatically a missed payment.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1124;

UPDATE "question"
SET
  "description" = 'Lists self-serve invoices that still had money due when Atlas checked Stripe. Use it to review collection work. A recent open invoice is not automatically bad debt; Finance still needs to confirm the final aging rule.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1125;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-weekly-revenue-version-subscription-reconciliation-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1123),
    2, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), latest_subscription_payloads as (
  select
    id,
    argMax("organizationId", tuple("currentPeriodEnd", "currentPeriodStart", "createdAt", eventType)) as organization_id,
    argMax(payload, tuple("currentPeriodEnd", "currentPeriodStart", "createdAt", eventType)) as payload
  from sync_prod.sync_stripe_subscriptions
  cross join bounds
  where "createdAt" < bounds.data_through
  group by id
), latest_subscription_states as (
  select
    id,
    argMax(status, tuple("currentPeriodEnd", "currentPeriodStart", "createdAt", eventType)) as subscription_status
  from sync_prod.sync_stripe_subscriptions_with_plan
  cross join bounds
  where "createdAt" < bounds.data_through
  group by id
), live_items as (
  select
    states.subscription_status,
    arrayJoin(JSONExtractArrayRaw(payloads.payload, 'items', 'data')) as item
  from latest_subscription_payloads as payloads
  inner join latest_subscription_states as states using (id)
  where states.subscription_status in ('active', 'past_due')
), live_value as (
  select round(sumIf(
    JSONExtractInt(item, 'price', 'unit_amount')
      * greatest(JSONExtractInt(item, 'quantity'), 1)
      / 100.0
      / if(
        JSONExtractString(item, 'price', 'recurring', 'interval') = 'year',
        12 * greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1),
        greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1)
      ),
    JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed'
  ), 2) as live_subscription_run_rate
  from live_items
), invoice_items as (
  select
    toStartOfMonth(toTimeZone(items."createdAt", 'UTC')) as period_start,
    sum(items.amount) / 100.0 as invoice_item_value
  from sync_prod.sync_stripe_invoice_items as items
  left join sync_prod.sync_stripe_invoices_pipe as invoices
    on items."invoiceId" = invoices.id
  cross join bounds
  where items."createdAt" >= addMonths(bounds.month_start, -1)
    and items."createdAt" < bounds.data_through
    and items.status = 'paid'
    and items."priceType" = 'licensed'
    and invoices."amountPaid" > 0
  group by period_start
)
select
  bounds.month_start as period_start,
  live_value.live_subscription_run_rate,
  round(sumIf(invoice_items.invoice_item_value, invoice_items.period_start = addMonths(bounds.month_start, -1)), 2) as previous_month_paid_licensed_amount,
  round(sumIf(invoice_items.invoice_item_value, invoice_items.period_start = bounds.month_start), 2) as current_month_paid_licensed_amount,
  bounds.data_through as period_end,
  bounds.data_through as data_through
from bounds
cross join live_value
left join invoice_items on 1 = 1
group by bounds.month_start, bounds.data_through, live_value.live_subscription_run_rate$query$,
    'table', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-invoice-collection-by-type-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1124),
    2, 'SQL',
    $query$with bounds as (
  select
    addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -5) as start_at,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), invoice_states as (
  select
    id,
    argMax(
      status,
      tuple(
        "amountPaid",
        multiIf(status = 'paid', 5, status = 'open', 4, status = 'uncollectible', 3, status = 'void', 2, 1),
        eventType
      )
    ) as invoice_status,
    max("amountDue") as amount_due_cents,
    max("amountPaid") as amount_paid_cents,
    greatest(max("amountDue") - max("amountPaid"), 0) as amount_remaining_cents,
    min("createdAt") as invoice_created_at
  from sync_prod.sync_stripe_invoices
  cross join bounds
  where "createdAt" >= bounds.start_at
    and "createdAt" < bounds.data_through
    and lower(coalesce("orgPlan", '')) not in ('enterprise', 'program', 'partner')
  group by id
), item_states as (
  select
    id,
    any("invoiceId") as invoice_id,
    argMax("priceType", tuple("createdAt", status, amount)) as price_type,
    max(abs(amount)) as amount_cents
  from sync_prod.sync_stripe_invoice_items
  cross join bounds
  where "createdAt" >= bounds.start_at
    and "createdAt" < bounds.data_through
  group by id
), invoice_type_lines as (
  select
    invoice_id,
    multiIf(price_type = 'licensed', 'subscription', price_type = 'metered', 'usage', 'other') as revenue_type,
    sum(amount_cents) as line_amount_cents
  from item_states
  group by invoice_id, revenue_type
), invoice_type_weights as (
  select
    invoice_id,
    revenue_type,
    line_amount_cents,
    sum(line_amount_cents) over (partition by invoice_id) as invoice_line_total_cents
  from invoice_type_lines
), allocated as (
  select
    invoices.id as invoice_id,
    invoices.invoice_created_at,
    invoices.invoice_status,
    coalesce(lines.revenue_type, 'other') as revenue_type,
    if(lines.invoice_line_total_cents > 0, lines.line_amount_cents / lines.invoice_line_total_cents, 1) as allocation_share,
    invoices.amount_due_cents,
    invoices.amount_paid_cents,
    invoices.amount_remaining_cents
  from invoice_states as invoices
  left join invoice_type_weights as lines on lines.invoice_id = invoices.id
), monthly as (
  select
    toStartOfMonth(toTimeZone(invoice_created_at, 'UTC')) as period_start,
    revenue_type,
    sum(amount_due_cents * allocation_share) / 100.0 as amount_due,
    sum(amount_paid_cents * allocation_share) / 100.0 as amount_paid,
    sum(amount_remaining_cents * allocation_share) / 100.0 as amount_uncollected
  from allocated
  where invoice_status in ('paid', 'open', 'uncollectible')
  group by period_start, revenue_type
)
select
  period_start,
  round(sumIf(amount_due, revenue_type = 'subscription'), 2) as subscription_amount_due,
  round(sumIf(amount_paid, revenue_type = 'subscription'), 2) as subscription_amount_paid,
  round(sumIf(amount_uncollected, revenue_type = 'subscription'), 2) as subscription_amount_uncollected,
  round(100 * subscription_amount_paid / nullIf(subscription_amount_due, 0), 2) as subscription_collection_rate_pct,
  round(sumIf(amount_due, revenue_type = 'usage'), 2) as usage_amount_due,
  round(sumIf(amount_paid, revenue_type = 'usage'), 2) as usage_amount_paid,
  round(sumIf(amount_uncollected, revenue_type = 'usage'), 2) as usage_amount_uncollected,
  round(100 * usage_amount_paid / nullIf(usage_amount_due, 0), 2) as usage_collection_rate_pct,
  round(sumIf(amount_due, revenue_type = 'other'), 2) as other_amount_due,
  round(sumIf(amount_paid, revenue_type = 'other'), 2) as other_amount_paid,
  round(sumIf(amount_uncollected, revenue_type = 'other'), 2) as other_amount_uncollected,
  if(period_start = toStartOfMonth(bounds.data_through), bounds.data_through, addMonths(period_start, 1)) as period_end,
  bounds.data_through as data_through
from monthly
cross join bounds
group by period_start, bounds.data_through
order by period_start$query$,
    'table', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-uncollected-invoices-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1125),
    2, 'SQL',
    $query$with bounds as (
  select
    addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -12) as period_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), invoice_states as (
  select
    id,
    argMax(
      status,
      tuple(
        "amountPaid",
        multiIf(status = 'paid', 5, status = 'open', 4, status = 'uncollectible', 3, status = 'void', 2, 1),
        eventType
      )
    ) as invoice_status,
    max("amountDue") as amount_due_cents,
    max("amountPaid") as amount_paid_cents,
    greatest(max("amountDue") - max("amountPaid"), 0) as amount_remaining_cents,
    any("organizationId") as organization_id,
    any("customerId") as customer_id,
    min("createdAt") as invoice_created_at
  from sync_prod.sync_stripe_invoices
  cross join bounds
  where "createdAt" >= bounds.period_start
    and "createdAt" < bounds.data_through
    and lower(coalesce("orgPlan", '')) not in ('enterprise', 'program', 'partner')
  group by id
), item_states as (
  select
    id,
    any("invoiceId") as invoice_id,
    argMax("priceType", tuple("createdAt", status, amount)) as price_type
  from sync_prod.sync_stripe_invoice_items
  cross join bounds
  where "createdAt" >= bounds.period_start
    and "createdAt" < bounds.data_through
  group by id
), invoice_types as (
  select
    invoice_id,
    arrayStringConcat(arraySort(groupUniqArray(
      multiIf(price_type = 'licensed', 'subscription', price_type = 'metered', 'usage', 'other')
    )), ', ') as revenue_types
  from item_states
  group by invoice_id
)
select
  bounds.period_start,
  bounds.data_through as period_end,
  invoices.id as invoice_id,
  invoices.organization_id,
  invoices.customer_id,
  invoices.invoice_created_at,
  dateDiff('day', invoices.invoice_created_at, bounds.data_through) as age_days,
  invoices.invoice_status,
  coalesce(invoice_types.revenue_types, 'other') as revenue_types,
  round(invoices.amount_due_cents / 100.0, 2) as amount_due,
  round(invoices.amount_paid_cents / 100.0, 2) as amount_paid,
  round(invoices.amount_remaining_cents / 100.0, 2) as amount_uncollected,
  bounds.data_through as data_through
from invoice_states as invoices
left join invoice_types on invoice_types.invoice_id = invoices.id
cross join bounds
where invoices.amount_remaining_cents > 0
  and invoices.invoice_status in ('open', 'past_due', 'uncollectible')
order by amount_uncollected desc, invoices.invoice_created_at
limit 250$query$,
    'table', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO NOTHING;

UPDATE "dashboardCard"
SET visualization = 'TABLE', "updatedAt" = CURRENT_TIMESTAMP
WHERE "questionId" = (SELECT "id" FROM "question" WHERE "number" = 1124);
