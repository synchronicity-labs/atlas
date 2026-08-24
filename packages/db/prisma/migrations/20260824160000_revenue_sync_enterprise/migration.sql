UPDATE "dashboard"
SET
  "description" = 'Monthly revenue and NDR by revenue door. Revenue close preserves the historical audit view. sync.tools, sync.partners, and sync.enterprise show governed operating views. sync.productions needs contract and service-delivery data before Atlas can build it safely.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 2;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-revenue-dashboard-tab-sync-enterprise',
  (SELECT "id" FROM "dashboard" WHERE "number" = 2),
  4,
  'sync.enterprise',
  3,
  'atlas:revenue:sync-enterprise'
)
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-weekly-revenue-question-enterprise-usage-run-rate', 1119,
    'Enterprise usage run-rate',
    'Accrued usage from enterprise-plan organizations after removing every organization in the governed channel-partner registry. The current UTC month is estimated from the exact data-through time and compared with the previous complete month. This is usage incurred, not an invoice, contract value, or cash collection.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:enterprise-usage-run-rate',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-enterprise-invoices-raised', 1120,
    'Enterprise invoices raised',
    'Stripe invoice amount due for enterprise-plan organizations after removing channel partners, counted once when each invoice was raised. The current month is compared with the same elapsed UTC window in the previous month. This is booked revenue in Stripe, not full contract value or cash collected.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:enterprise-invoices-raised',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-enterprise-cash-collected', 1121,
    'Enterprise cash collected',
    'Stripe amount paid for enterprise-plan invoices after removing channel partners, grouped by the actual paid timestamp. The current month is compared with the same elapsed UTC window in the previous month. This is cash collected, not booked or recognized revenue.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:enterprise-cash-collected',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-enterprise-reconciliation', 1122,
    'Enterprise revenue reconciliation',
    'Monthly enterprise usage incurred, Stripe invoices raised, and Stripe cash collected after removing channel partners. These are separate views of the same business activity and must not be added together. Contract value is not shown until Atlas has a governed contract source.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:enterprise-reconciliation',
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
    'atlas-weekly-revenue-version-enterprise-usage-run-rate-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1119),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), periods as (
  select
    addMonths(bounds.month_start, -1) as period_start,
    bounds.month_start as period_end,
    0 as is_current
  from bounds
  union all
  select
    bounds.month_start as period_start,
    bounds.data_through as period_end,
    1 as is_current
  from bounds
), usage as (
  select
    periods.period_start,
    periods.period_end,
    periods.is_current,
    sumIf(
      "generationCostMillicents",
      "generationEndedAt" >= periods.period_start
        and "generationEndedAt" < periods.period_end
    ) / 100000.0 as usage_actual
  from sync_prod.sync_usage3
  cross join periods
  group by periods.period_start, periods.period_end, periods.is_current
)
select
  usage.period_start,
  if(
    usage.is_current = 1,
    usage.usage_actual
      * dateDiff('second', usage.period_start, addMonths(usage.period_start, 1))
      / nullIf(dateDiff('second', usage.period_start, usage.period_end), 0),
    usage.usage_actual
  ) as enterprise_usage_run_rate,
  usage.period_end,
  bounds.data_through as data_through
from usage
cross join bounds
order by usage.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-enterprise-invoices-raised-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1120),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through,
    dateDiff(
      'second',
      toStartOfMonth(toTimeZone(now(), 'UTC')),
      toStartOfMinute(toTimeZone(now(), 'UTC'))
    ) as elapsed_seconds
), periods as (
  select
    addMonths(bounds.month_start, -1) as period_start,
    least(
      addSeconds(addMonths(bounds.month_start, -1), bounds.elapsed_seconds),
      bounds.month_start
    ) as period_end
  from bounds
  union all
  select
    bounds.month_start as period_start,
    bounds.data_through as period_end
  from bounds
), invoice_states as (
  select
    periods.period_start,
    periods.period_end,
    invoices.id,
    max(invoices.amountDue) as amount_due_cents,
    countIf(invoices.status in ('open', 'paid')) > 0 as was_raised,
    countIf(invoices.status = 'void') > 0 as was_voided
  from sync_prod.sync_stripe_invoices as invoices
  cross join periods
  where invoices.createdAt >= periods.period_start
    and invoices.createdAt < periods.period_end
  group by periods.period_start, periods.period_end, invoices.id
)
select
  invoice_states.period_start,
  sumIf(invoice_states.amount_due_cents, invoice_states.was_raised and not invoice_states.was_voided) / 100.0 as enterprise_invoices_raised,
  invoice_states.period_end,
  bounds.data_through as data_through
from invoice_states
cross join bounds
group by invoice_states.period_start, invoice_states.period_end, bounds.data_through
order by invoice_states.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-enterprise-cash-collected-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1121),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through,
    dateDiff(
      'second',
      toStartOfMonth(toTimeZone(now(), 'UTC')),
      toStartOfMinute(toTimeZone(now(), 'UTC'))
    ) as elapsed_seconds
), periods as (
  select
    addMonths(bounds.month_start, -1) as period_start,
    least(
      addSeconds(addMonths(bounds.month_start, -1), bounds.elapsed_seconds),
      bounds.month_start
    ) as period_end
  from bounds
  union all
  select
    bounds.month_start as period_start,
    bounds.data_through as period_end
  from bounds
), paid_invoices as (
  select
    invoices.id,
    max(invoices.amountPaid) as amount_paid_cents,
    max(JSONExtractInt(invoices.payload, 'status_transitions', 'paid_at')) as paid_at_epoch
  from sync_prod.sync_stripe_invoices as invoices
  where invoices.status = 'paid' or invoices.eventType = 'invoice.paid'
  group by invoices.id
)
select
  periods.period_start,
  sumIf(
    paid_invoices.amount_paid_cents,
    paid_invoices.paid_at_epoch >= toUnixTimestamp(periods.period_start)
      and paid_invoices.paid_at_epoch < toUnixTimestamp(periods.period_end)
  ) / 100.0 as enterprise_cash_collected,
  periods.period_end,
  bounds.data_through as data_through
from periods
cross join bounds
cross join paid_invoices
group by periods.period_start, periods.period_end, bounds.data_through
order by periods.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-enterprise-reconciliation-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1122),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), usage_months as (
  select
    toStartOfMonth("generationEndedAt") as period_start,
    sum("generationCostMillicents") / 100000.0 as usage_incurred,
    0.0 as invoices_raised,
    0.0 as cash_collected
  from sync_prod.sync_usage3
  cross join bounds
  where "generationEndedAt" >= addMonths(bounds.month_start, -5)
    and "generationEndedAt" < bounds.data_through
  group by period_start
), invoice_states as (
  select
    invoices.id,
    any(invoices."organizationId") as "organizationId",
    min(invoices.createdAt) as invoice_created_at,
    max(invoices.amountDue) as amount_due_cents,
    max(invoices.amountPaid) as amount_paid_cents,
    max(JSONExtractInt(invoices.payload, 'status_transitions', 'paid_at')) as paid_at_epoch,
    countIf(invoices.status in ('open', 'paid')) > 0 as was_raised,
    countIf(invoices.status = 'void') > 0 as was_voided
  from sync_prod.sync_stripe_invoices as invoices
  cross join bounds
  where invoices.createdAt < bounds.data_through
  group by invoices.id
), booked_months as (
  select
    toStartOfMonth(invoice_states.invoice_created_at) as period_start,
    0.0 as usage_incurred,
    sum(invoice_states.amount_due_cents) / 100.0 as invoices_raised,
    0.0 as cash_collected
  from invoice_states
  cross join bounds
  where invoice_states.was_raised
    and not invoice_states.was_voided
    and invoice_states.invoice_created_at >= addMonths(bounds.month_start, -5)
  group by period_start
), cash_months as (
  select
    toStartOfMonth(fromUnixTimestamp(invoice_states.paid_at_epoch)) as period_start,
    0.0 as usage_incurred,
    0.0 as invoices_raised,
    sum(invoice_states.amount_paid_cents) / 100.0 as cash_collected
  from invoice_states
  cross join bounds
  where invoice_states.paid_at_epoch > 0
    and fromUnixTimestamp(invoice_states.paid_at_epoch) >= addMonths(bounds.month_start, -5)
    and fromUnixTimestamp(invoice_states.paid_at_epoch) < bounds.data_through
  group by period_start
), all_values as (
  select * from usage_months
  union all
  select * from booked_months
  union all
  select * from cash_months
)
select
  all_values.period_start,
  sum(all_values.usage_incurred) as usage_incurred,
  sum(all_values.invoices_raised) as invoices_raised,
  sum(all_values.cash_collected) as cash_collected,
  if(
    all_values.period_start = bounds.month_start,
    bounds.data_through,
    addMonths(all_values.period_start, 1)
  ) as period_end,
  bounds.data_through as data_through
from all_values
cross join bounds
group by all_values.period_start, bounds.month_start, bounds.data_through
order by all_values.period_start desc$query$,
    'table', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-revenue-sync-enterprise-card-usage-run-rate',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-enterprise',
    (SELECT "id" FROM "question" WHERE "number" = 1119),
    0, 0, 0, 8, 5, 'NUMBER', '{"compareCurrentPeriod":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-enterprise-card-invoices-raised',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-enterprise',
    (SELECT "id" FROM "question" WHERE "number" = 1120),
    1, 8, 0, 8, 5, 'NUMBER', '{"compareCurrentPeriod":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-enterprise-card-cash-collected',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-enterprise',
    (SELECT "id" FROM "question" WHERE "number" = 1121),
    2, 16, 0, 8, 5, 'NUMBER', '{"compareCurrentPeriod":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-enterprise-card-reconciliation',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-enterprise',
    (SELECT "id" FROM "question" WHERE "number" = 1122),
    3, 0, 5, 24, 10, 'TABLE', NULL,
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
