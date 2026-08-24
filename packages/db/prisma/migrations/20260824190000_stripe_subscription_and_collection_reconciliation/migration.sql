UPDATE "question"
SET
  "name" = 'Paid licensed invoice items by creation month',
  "description" = 'Paid licensed Stripe invoice-item value grouped by the month when each item was created. This reproduces Metabase question 1255. It is invoice-item history, not live subscription run-rate.',
  "sourceExternalId" = 'revenue:paid-licensed-invoice-items-1255',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1003;

UPDATE "question"
SET
  "name" = 'Estimated self-serve month-end revenue',
  "description" = 'Current self-serve subscription value plus estimated month-end V2 usage and V3 top-up payments. This is an operating estimate. It is not booked revenue or cash collected.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1102;

UPDATE "question"
SET
  "name" = 'Self-serve revenue history and current-month pace',
  "description" = 'Six months of paid licensed invoice items, V2 postpaid usage, and V3 top-up payments. Completed months show observed activity. The open month also shows an estimated month-end total.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1103;

UPDATE "question"
SET
  "name" = 'Self-serve subscription run-rate by billing type and plan',
  "description" = 'Current active or past-due self-serve subscriptions. Atlas uses each subscription item''s own recurring licensed price and quantity, then groups the result by V2 or V3 billing type and plan.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1104;

UPDATE "question"
SET
  "name" = 'Self-serve subscription run-rate',
  "description" = 'Current active or past-due self-serve subscriptions at each subscription item''s own recurring licensed price and quantity. This is a live monthly value, not invoice history or cash collected.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1111;

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-weekly-revenue-question-subscription-reconciliation', 1123,
    'Live subscription value vs paid licensed invoice items',
    'Compares today''s self-serve recurring subscription value with paid licensed invoice items created this month and in the latest complete month. These measures answer different questions and are not expected to match.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:subscription-reconciliation',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-invoice-collection-by-type', 1124,
    'Invoice collection by revenue type',
    'Stripe invoice amount due, paid, and still uncollected by invoice creation month and revenue type. Mixed invoices are split between subscription, usage, and other lines in proportion to line value.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:invoice-collection-by-type',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-uncollected-invoices', 1125,
    'Uncollected invoices',
    'Self-serve Stripe invoices with money still due. This is an operational review list, grouped by the invoice creation date and latest known Stripe state.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:uncollected-invoices',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
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
    'atlas-revenue-paid-licensed-invoice-items-v6',
    (SELECT "id" FROM "question" WHERE "number" = 1003),
    6, 'SQL',
    $query$with bounds as (
  select
    addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -5) as start_at,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
)
select
  toStartOfMonth(toTimeZone(items."createdAt", 'UTC')) as period_start,
  round(sum(items.amount) / 100.0, 2) as paid_licensed_invoice_items,
  if(
    period_start = toStartOfMonth(bounds.data_through),
    bounds.data_through,
    addMonths(period_start, 1)
  ) as period_end,
  bounds.data_through as data_through
from sync_prod.sync_stripe_invoice_items as items
left join sync_prod.sync_stripe_invoices_pipe as invoices
  on items."invoiceId" = invoices.id
cross join bounds
where items."createdAt" >= bounds.start_at
  and items."createdAt" < bounds.data_through
  and items.status = 'paid'
  and items."priceType" = 'licensed'
  and invoices."amountPaid" > 0
  and items."customerId" not in ('cus_S1GousK6vr6sck', 'cus_T412vRZpb4RIVb')
group by period_start, bounds.data_through
order by period_start$query$,
    'bar', '{}'::jsonb, '1255', 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-product-run-rate-v6',
    (SELECT "id" FROM "question" WHERE "number" = 1102),
    6, 'SQL',
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
    argMax(plan, tuple("currentPeriodEnd", "currentPeriodStart", "createdAt", eventType)) as plan,
    argMax(status, tuple("currentPeriodEnd", "currentPeriodStart", "createdAt", eventType)) as subscription_status
  from sync_prod.sync_stripe_subscriptions_with_plan
  cross join bounds
  where "createdAt" < bounds.data_through
  group by id
), licensed_items as (
  select
    payloads.id,
    payloads.organization_id,
    states.subscription_status,
    states.plan,
    arrayJoin(JSONExtractArrayRaw(payloads.payload, 'items', 'data')) as item
  from latest_subscription_payloads as payloads
  inner join latest_subscription_states as states using (id)
  where states.subscription_status in ('active', 'past_due')
), subscription_value as (
  select
    round(sumIf(
      JSONExtractInt(item, 'price', 'unit_amount')
        * greatest(JSONExtractInt(item, 'quantity'), 1)
        / 100.0
        / if(
          JSONExtractString(item, 'price', 'recurring', 'interval') = 'year',
          12 * greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1),
          greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1)
        ),
      JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed'
    ), 2) as subscription_run_rate,
    round(sumIf(
      JSONExtractInt(item, 'price', 'unit_amount')
        * greatest(JSONExtractInt(item, 'quantity'), 1)
        / 100.0
        / if(
          JSONExtractString(item, 'price', 'recurring', 'interval') = 'year',
          12 * greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1),
          greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1)
        ),
      JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed'
        and subscription_status = 'active'
    ), 2) as active_subscription_value,
    round(sumIf(
      JSONExtractInt(item, 'price', 'unit_amount')
        * greatest(JSONExtractInt(item, 'quantity'), 1)
        / 100.0
        / if(
          JSONExtractString(item, 'price', 'recurring', 'interval') = 'year',
          12 * greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1),
          greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1)
        ),
      JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed'
        and subscription_status = 'past_due'
    ), 2) as past_due_subscription_value
  from licensed_items
), usage as (
  select
    sumIf(
      "generationCostMillicents",
      "generationEndedAt" >= bounds.month_start
        and "generationEndedAt" < bounds.data_through
        and "organizationPlanType" in ('hobbyist', 'creator', 'growth', 'scale')
    ) / 100000.0 as v2_usage_mtd
  from sync_prod.sync_usage3
  cross join bounds
), topups as (
  select
    sumIf(
      amount,
      "createdAt" >= bounds.month_start
        and "createdAt" < bounds.data_through
        and "billingVersion" = 'v3'
        and status = 'succeeded'
    ) / 100.0 as v3_top_ups_mtd
  from sync_prod.sync_stripe_payments
  cross join bounds
)
select
  bounds.month_start as period_start,
  round(
    subscription_value.subscription_run_rate
      + usage.v2_usage_mtd
        * dateDiff('second', bounds.month_start, addMonths(bounds.month_start, 1))
        / nullIf(dateDiff('second', bounds.month_start, bounds.data_through), 0)
      + topups.v3_top_ups_mtd
        * dateDiff('second', bounds.month_start, addMonths(bounds.month_start, 1))
        / nullIf(dateDiff('second', bounds.month_start, bounds.data_through), 0),
    2
  ) as product_run_rate,
  subscription_value.subscription_run_rate,
  subscription_value.active_subscription_value,
  subscription_value.past_due_subscription_value,
  round(usage.v2_usage_mtd, 2) as v2_usage_mtd,
  round(
    usage.v2_usage_mtd
      * dateDiff('second', bounds.month_start, addMonths(bounds.month_start, 1))
      / nullIf(dateDiff('second', bounds.month_start, bounds.data_through), 0),
    2
  ) as estimated_month_end_v2_usage,
  round(topups.v3_top_ups_mtd, 2) as v3_top_ups_mtd,
  round(
    topups.v3_top_ups_mtd
      * dateDiff('second', bounds.month_start, addMonths(bounds.month_start, 1))
      / nullIf(dateDiff('second', bounds.month_start, bounds.data_through), 0),
    2
  ) as estimated_month_end_v3_top_ups,
  bounds.data_through as period_end,
  bounds.data_through as data_through
from bounds
cross join subscription_value
cross join usage
cross join topups$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-usage-history-v6',
    (SELECT "id" FROM "question" WHERE "number" = 1103),
    6, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -5) as start_at,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), invoice_items as (
  select
    toStartOfMonth(toTimeZone(items."createdAt", 'UTC')) as period_start,
    sum(items.amount) / 100.0 as paid_licensed_invoice_items,
    0.0 as v2_usage_revenue,
    0.0 as v3_top_up_revenue
  from sync_prod.sync_stripe_invoice_items as items
  left join sync_prod.sync_stripe_invoices_pipe as invoices
    on items."invoiceId" = invoices.id
  cross join bounds
  where items."createdAt" >= bounds.start_at
    and items."createdAt" < bounds.data_through
    and items.status = 'paid'
    and items."priceType" = 'licensed'
    and invoices."amountPaid" > 0
  group by period_start
), usage as (
  select
    toStartOfMonth(toTimeZone("generationEndedAt", 'UTC')) as period_start,
    0.0 as paid_licensed_invoice_items,
    sum("generationCostMillicents") / 100000.0 as v2_usage_revenue,
    0.0 as v3_top_up_revenue
  from sync_prod.sync_usage3
  cross join bounds
  where "generationEndedAt" >= bounds.start_at
    and "generationEndedAt" < bounds.data_through
    and "organizationPlanType" in ('hobbyist', 'creator', 'growth', 'scale')
  group by period_start
), topups as (
  select
    toStartOfMonth(toTimeZone("createdAt", 'UTC')) as period_start,
    0.0 as paid_licensed_invoice_items,
    0.0 as v2_usage_revenue,
    sum(amount) / 100.0 as v3_top_up_revenue
  from sync_prod.sync_stripe_payments
  cross join bounds
  where "createdAt" >= bounds.start_at
    and "createdAt" < bounds.data_through
    and "billingVersion" = 'v3'
    and status = 'succeeded'
  group by period_start
), monthly as (
  select
    period_start,
    sum(paid_licensed_invoice_items) as paid_licensed_invoice_items,
    sum(v2_usage_revenue) as v2_usage_revenue,
    sum(v3_top_up_revenue) as v3_top_up_revenue
  from (
    select * from invoice_items
    union all
    select * from usage
    union all
    select * from topups
  )
  group by period_start
)
select
  monthly.period_start,
  round(monthly.paid_licensed_invoice_items, 2) as paid_licensed_invoice_items,
  round(monthly.v2_usage_revenue, 2) as v2_usage_revenue,
  round(monthly.v3_top_up_revenue, 2) as v3_top_up_revenue,
  round(
    monthly.paid_licensed_invoice_items
      + monthly.v2_usage_revenue
      + monthly.v3_top_up_revenue,
    2
  ) as observed_revenue_activity,
  if(
    monthly.period_start = bounds.month_start,
    round(
      monthly.paid_licensed_invoice_items
        + monthly.v2_usage_revenue
          * dateDiff('second', bounds.month_start, addMonths(bounds.month_start, 1))
          / nullIf(dateDiff('second', bounds.month_start, bounds.data_through), 0)
        + monthly.v3_top_up_revenue
          * dateDiff('second', bounds.month_start, addMonths(bounds.month_start, 1))
          / nullIf(dateDiff('second', bounds.month_start, bounds.data_through), 0),
      2
    ),
    NULL
  ) as estimated_month_end_activity,
  if(
    monthly.period_start = bounds.month_start,
    bounds.data_through,
    addMonths(monthly.period_start, 1)
  ) as period_end,
  bounds.data_through as data_through
from monthly
cross join bounds
order by monthly.period_start$query$,
    'bar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-licensed-base-v5',
    (SELECT "id" FROM "question" WHERE "number" = 1104),
    5, 'SQL',
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
    argMax(plan, tuple("currentPeriodEnd", "currentPeriodStart", "createdAt", eventType)) as plan,
    argMax(status, tuple("currentPeriodEnd", "currentPeriodStart", "createdAt", eventType)) as subscription_status
  from sync_prod.sync_stripe_subscriptions_with_plan
  cross join bounds
  where "createdAt" < bounds.data_through
  group by id
), licensed_items as (
  select
    payloads.id,
    payloads.organization_id,
    states.subscription_status as status,
    states.plan,
    arrayJoin(JSONExtractArrayRaw(payloads.payload, 'items', 'data')) as item
  from latest_subscription_payloads as payloads
  inner join latest_subscription_states as states using (id)
  where states.subscription_status in ('active', 'past_due')
)
select
  bounds.month_start as period_start,
  status,
  if(plan in ('hobbyist', 'creator', 'growth', 'scale'), 'V2', 'V3') as billing_type,
  plan,
  countDistinctIf(id, JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed') as subscriptions,
  countDistinctIf(organization_id, JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed') as organizations,
  round(sumIf(
    JSONExtractInt(item, 'price', 'unit_amount')
      * greatest(JSONExtractInt(item, 'quantity'), 1)
      / 100.0
      / if(
        JSONExtractString(item, 'price', 'recurring', 'interval') = 'year',
        12 * greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1),
        greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1)
      ),
    JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed'
  ), 2) as monthly_value,
  bounds.data_through as period_end,
  bounds.data_through as data_through
from licensed_items
cross join bounds
group by bounds.month_start, bounds.data_through, status, billing_type, plan
order by billing_type, status, monthly_value desc$query$,
    'table', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-subscription-run-rate-v3',
    (SELECT "id" FROM "question" WHERE "number" = 1111),
    3, 'SQL',
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
    argMax(plan, tuple("currentPeriodEnd", "currentPeriodStart", "createdAt", eventType)) as plan,
    argMax(status, tuple("currentPeriodEnd", "currentPeriodStart", "createdAt", eventType)) as subscription_status
  from sync_prod.sync_stripe_subscriptions_with_plan
  cross join bounds
  where "createdAt" < bounds.data_through
  group by id
), licensed_items as (
  select
    payloads.id,
    payloads.organization_id,
    states.subscription_status,
    states.plan,
    arrayJoin(JSONExtractArrayRaw(payloads.payload, 'items', 'data')) as item
  from latest_subscription_payloads as payloads
  inner join latest_subscription_states as states using (id)
  where states.subscription_status in ('active', 'past_due')
), valued as (
  select
    subscription_status,
    JSONExtractInt(item, 'price', 'unit_amount')
      * greatest(JSONExtractInt(item, 'quantity'), 1)
      / 100.0
      / if(
        JSONExtractString(item, 'price', 'recurring', 'interval') = 'year',
        12 * greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1),
        greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1)
      ) as monthly_value
  from licensed_items
  where JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed'
)
select
  bounds.month_start as period_start,
  round(sum(monthly_value), 2) as subscription_run_rate,
  round(sumIf(monthly_value, subscription_status = 'active'), 2) as active_subscription_value,
  round(sumIf(monthly_value, subscription_status = 'past_due'), 2) as past_due_subscription_value,
  bounds.data_through as period_end,
  bounds.data_through as data_through
from valued
cross join bounds
group by bounds.month_start, bounds.data_through$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-subscription-reconciliation-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1123),
    1, 'SQL',
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
  round(sumIf(invoice_items.invoice_item_value, invoice_items.period_start = addMonths(bounds.month_start, -1)), 2) as previous_month_paid_licensed_items,
  round(sumIf(invoice_items.invoice_item_value, invoice_items.period_start = bounds.month_start), 2) as current_month_paid_licensed_items,
  bounds.data_through as period_end,
  bounds.data_through as data_through
from bounds
cross join live_value
left join invoice_items on 1 = 1
group by bounds.month_start, bounds.data_through, live_value.live_subscription_run_rate$query$,
    'table', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-invoice-collection-by-type-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1124),
    1, 'SQL',
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
    any("organizationId") as organization_id,
    any("customerId") as customer_id,
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
)
select
  toStartOfMonth(toTimeZone(invoice_created_at, 'UTC')) as period_start,
  revenue_type,
  countDistinct(invoice_id) as invoices,
  round(sum(amount_due_cents * allocation_share) / 100.0, 2) as amount_due,
  round(sum(amount_paid_cents * allocation_share) / 100.0, 2) as amount_paid,
  round(sum(amount_remaining_cents * allocation_share) / 100.0, 2) as amount_uncollected,
  round(100 * amount_paid / nullIf(amount_due, 0), 2) as collection_rate_pct,
  if(period_start = toStartOfMonth(bounds.data_through), bounds.data_through, addMonths(period_start, 1)) as period_end,
  bounds.data_through as data_through
from allocated
cross join bounds
where invoice_status in ('paid', 'open', 'uncollectible')
group by period_start, revenue_type, bounds.data_through
order by period_start, amount_due desc$query$,
    'bar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-uncollected-invoices-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1125),
    1, 'SQL',
    $query$with bounds as (
  select toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
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
  where "createdAt" < bounds.data_through
    and lower(coalesce("orgPlan", '')) not in ('enterprise', 'program', 'partner')
  group by id
), item_states as (
  select
    id,
    any("invoiceId") as invoice_id,
    argMax("priceType", tuple("createdAt", status, amount)) as price_type,
    max(abs(amount)) as amount_cents
  from sync_prod.sync_stripe_invoice_items
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

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  x, y, width, height, visualization, "displaySettings", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-revenue-sync-tools-card-subscription-reconciliation',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-tools',
    (SELECT "id" FROM "question" WHERE "number" = 1123),
    7, 0, 29, 24, 7, 'TABLE', '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-tools-card-invoice-collection-by-type',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-tools',
    (SELECT "id" FROM "question" WHERE "number" = 1124),
    8, 0, 36, 24, 10, 'BAR', '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-tools-card-uncollected-invoices',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-tools',
    (SELECT "id" FROM "question" WHERE "number" = 1125),
    9, 0, 46, 24, 12, 'TABLE', '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE SET
  "questionId" = EXCLUDED."questionId",
  "position" = EXCLUDED."position",
  x = EXCLUDED.x,
  y = EXCLUDED.y,
  width = EXCLUDED.width,
  height = EXCLUDED.height,
  visualization = EXCLUDED.visualization,
  "displaySettings" = EXCLUDED."displaySettings",
  "updatedAt" = CURRENT_TIMESTAMP;
