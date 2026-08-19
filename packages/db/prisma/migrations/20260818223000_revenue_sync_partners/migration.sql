UPDATE "dashboard"
SET
  "description" = 'Monthly revenue and NDR with three views: the original Rudy close for audit, governed sync.tools revenue, and known sync.partners revenue. The partner registry is still being completed.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 2;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-revenue-dashboard-tab-sync-partners',
  (SELECT "id" FROM "dashboard" WHERE "number" = 2),
  3,
  'sync.partners',
  2,
  'atlas:revenue:sync-partners'
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
    'atlas-weekly-revenue-question-partner-usage-run-rate', 1112,
    'Channel-partner usage run-rate',
    'Accrued usage from organizations in the governed sync.partners registry. The current UTC month is projected from the exact data-through time and compared with the previous complete month. Usage is counted when a generation ends. This is usage incurred, not an invoice or cash collection.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:partner-usage-run-rate',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-partner-booked-revenue', 1113,
    'Channel-partner invoices raised',
    'Stripe invoice amount due for known channel partners, counted once when the invoice was raised. The current month is compared with the same elapsed UTC window in the previous month. This is booked revenue, not cash collected or recognized revenue.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:partner-booked-revenue',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-partner-cash-collected', 1114,
    'Channel-partner cash collected',
    'Stripe amount paid for known channel-partner invoices, grouped by the actual paid timestamp. The current month is compared with the same elapsed UTC window in the previous month. This is cash collected, not booked or recognized revenue.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:partner-cash-collected',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-partner-usage-history', 1115,
    'Channel-partner usage by partner',
    'Monthly accrued usage for fal.ai, higgsfield.ai, replicate.com, magichour.ai, and any additional organizations already marked with the partner plan. The current month is month to date. The partner list is still being completed.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:partner-usage-history',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-partner-reconciliation', 1116,
    'Channel-partner revenue reconciliation',
    'Monthly partner usage incurred, Stripe invoices raised, and cash collected shown together by partner. These are three views of the same economics. Do not add them together.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:partner-reconciliation',
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
    'atlas-weekly-revenue-version-partner-usage-run-rate-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1112),
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
  ) as partner_usage_run_rate,
  usage.period_end,
  bounds.data_through as data_through
from usage
cross join bounds
order by usage.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-partner-booked-revenue-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1113),
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
  sumIf(invoice_states.amount_due_cents, invoice_states.was_raised and not invoice_states.was_voided) / 100.0 as partner_invoices_raised,
  invoice_states.period_end,
  bounds.data_through as data_through
from invoice_states
cross join bounds
group by invoice_states.period_start, invoice_states.period_end, bounds.data_through
order by invoice_states.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-partner-cash-collected-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1114),
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
  ) / 100.0 as partner_cash_collected,
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
    'atlas-weekly-revenue-version-partner-usage-history-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1115),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), partner_usage as (
  select
    toStartOfMonth("generationEndedAt") as period_start,
    __ATLAS_PARTNER_LABEL__ as partner,
    sum("generationCostMillicents") / 100000.0 as usage_accrual
  from sync_prod.sync_usage3
  cross join bounds
  where "generationEndedAt" >= addMonths(bounds.month_start, -5)
    and "generationEndedAt" < bounds.data_through
  group by period_start, partner
)
select
  partner_usage.period_start,
  sumIf(partner_usage.usage_accrual, partner_usage.partner = 'fal.ai') as fal_ai,
  sumIf(partner_usage.usage_accrual, partner_usage.partner = 'higgsfield.ai') as higgsfield_ai,
  sumIf(partner_usage.usage_accrual, partner_usage.partner = 'replicate.com') as replicate_com,
  sumIf(partner_usage.usage_accrual, partner_usage.partner = 'magichour.ai') as magichour_ai,
  sumIf(
    partner_usage.usage_accrual,
    partner_usage.partner not in ('fal.ai', 'higgsfield.ai', 'replicate.com', 'magichour.ai')
  ) as other_partner,
  if(
    partner_usage.period_start = bounds.month_start,
    bounds.data_through,
    addMonths(partner_usage.period_start, 1)
  ) as period_end,
  bounds.data_through as data_through
from partner_usage
cross join bounds
group by partner_usage.period_start, bounds.month_start, bounds.data_through
order by partner_usage.period_start$query$,
    'bar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-partner-reconciliation-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1116),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), usage_months as (
  select
    toStartOfMonth("generationEndedAt") as period_start,
    __ATLAS_PARTNER_LABEL__ as partner,
    sum("generationCostMillicents") / 100000.0 as usage_incurred,
    0.0 as invoices_raised,
    0.0 as cash_collected
  from sync_prod.sync_usage3
  cross join bounds
  where "generationEndedAt" >= addMonths(bounds.month_start, -5)
    and "generationEndedAt" < bounds.data_through
  group by period_start, partner
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
    __ATLAS_PARTNER_LABEL__ as partner,
    0.0 as usage_incurred,
    sum(invoice_states.amount_due_cents) / 100.0 as invoices_raised,
    0.0 as cash_collected
  from invoice_states
  cross join bounds
  where invoice_states.was_raised
    and not invoice_states.was_voided
    and invoice_states.invoice_created_at >= addMonths(bounds.month_start, -5)
  group by period_start, partner
), cash_months as (
  select
    toStartOfMonth(fromUnixTimestamp(invoice_states.paid_at_epoch)) as period_start,
    __ATLAS_PARTNER_LABEL__ as partner,
    0.0 as usage_incurred,
    0.0 as invoices_raised,
    sum(invoice_states.amount_paid_cents) / 100.0 as cash_collected
  from invoice_states
  cross join bounds
  where invoice_states.paid_at_epoch > 0
    and fromUnixTimestamp(invoice_states.paid_at_epoch) >= addMonths(bounds.month_start, -5)
    and fromUnixTimestamp(invoice_states.paid_at_epoch) < bounds.data_through
  group by period_start, partner
), all_values as (
  select * from usage_months
  union all
  select * from booked_months
  union all
  select * from cash_months
)
select
  all_values.period_start,
  all_values.partner,
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
group by all_values.period_start, all_values.partner, bounds.month_start, bounds.data_through
order by all_values.period_start desc, usage_incurred desc$query$,
    'table', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-revenue-sync-partners-card-usage-run-rate',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-partners',
    (SELECT "id" FROM "question" WHERE "number" = 1112),
    0, 0, 0, 8, 5, 'NUMBER', '{"compareCurrentPeriod":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-partners-card-booked-revenue',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-partners',
    (SELECT "id" FROM "question" WHERE "number" = 1113),
    1, 8, 0, 8, 5, 'NUMBER', '{"compareCurrentPeriod":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-partners-card-cash-collected',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-partners',
    (SELECT "id" FROM "question" WHERE "number" = 1114),
    2, 16, 0, 8, 5, 'NUMBER', '{"compareCurrentPeriod":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-partners-card-usage-history',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-partners',
    (SELECT "id" FROM "question" WHERE "number" = 1115),
    3, 0, 5, 24, 9, 'BAR', NULL,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-partners-card-reconciliation',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-partners',
    (SELECT "id" FROM "question" WHERE "number" = 1116),
    4, 0, 14, 24, 10, 'TABLE', NULL,
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
