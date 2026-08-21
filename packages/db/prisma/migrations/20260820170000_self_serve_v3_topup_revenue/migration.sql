UPDATE "dashboard"
SET
  "description" = 'Monthly revenue and NDR with three revenue doors. The governed sync.tools view reports V2 and V3 subscriptions together, V2 postpaid usage, and successful V3 top-up payments. It excludes enterprise, program, and known channel-partner revenue.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 2;

UPDATE "question"
SET
  "description" = 'Current self-serve subscription value, V2 postpaid usage pace, V3 top-up pace, total run-rate, annualized run-rate, and Stripe cash reconciliation at one UTC cutoff.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1101;

UPDATE "question"
SET
  "name" = 'Self-serve combined run-rate',
  "description" = 'V2 and V3 subscription run-rate plus projected V2 postpaid usage and projected successful V3 top-up payments. Completed months use actual values. Excludes enterprise, program, and known channel-partner revenue.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1102;

UPDATE "question"
SET
  "name" = 'Self-serve V2 usage accrual and MTD pace',
  "description" = 'Completed-month V2 postpaid usage plus current-month actual and projected pace, using generationEndedAt in UTC. V3 credit consumption is excluded because V3 revenue is collected through top-up payments.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1103;

UPDATE "question"
SET
  "name" = 'Self-serve V2 usage run-rate',
  "description" = 'Projected V2 postpaid usage for the current UTC month compared with the previous complete month. Completed months use actual V2 usage. V3 credit consumption is excluded.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1110;

UPDATE "question"
SET
  "description" = 'Active or past-due V2 and V3 self-serve subscriptions at the plan price in effect at each UTC cutoff, compared with the previous month-end.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1111;

UPDATE "question"
SET
  "name" = 'V3 successful top-up payments',
  "description" = 'Successful V3 credit top-up payments grouped by payment month. This is top-up cash, not V3 credit consumption or subscription revenue.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 50;

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-weekly-revenue-question-v3-topup-run-rate', 1117,
    'Self-serve V3 top-up run-rate',
    'Successful V3 credit top-up payments for the current UTC month, projected from the exact data-through time and compared with the previous complete month. This is top-up cash, not V3 credit consumption.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:v3-top-up-run-rate',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-variable-run-rate', 1118,
    'Self-serve variable revenue run-rate',
    'Projected V2 postpaid usage plus projected successful V3 top-up payments, compared with the previous complete month. This excludes recurring subscription value and V3 credit consumption.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:variable-run-rate',
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
    'atlas-weekly-revenue-version-overview-v3',
    (SELECT "id" FROM "question" WHERE "number" = 1101),
    3, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), subscription_states as (
  select
    id,
    argMax(plan, tuple(currentPeriodStart, currentPeriodEnd, plan)) as current_plan,
    argMax(organizationId, tuple(currentPeriodStart, currentPeriodEnd, organizationId)) as organization_id,
    countIf(status in ('active', 'past_due')) > 0 as has_active_state,
    countIf(status = 'canceled' or eventType = 'customer.subscription.deleted') > 0 as has_terminal_state
  from sync_prod.sync_stripe_subscriptions_with_plan
  cross join bounds
  where createdAt < bounds.data_through
  group by id
), subscription_base as (
  select
    sum(multiIf(
      current_plan = 'hobbyist', 6,
      current_plan = 'creator', 20,
      current_plan = 'growth', 50,
      current_plan = 'scale', 250,
      current_plan = 'starter', 12,
      current_plan = 'pro', 29,
      current_plan = 'team', 99,
      0
    )) as licensed_subscription_base,
    count() as active_subscriptions,
    uniqExact(organization_id) as active_organizations
  from subscription_states
  where has_active_state
    and not has_terminal_state
    and current_plan in ('hobbyist', 'creator', 'growth', 'scale', 'starter', 'pro', 'team')
), usage as (
  select
    sumIf(
      "generationCostMillicents",
      "generationEndedAt" >= bounds.month_start
        and "generationEndedAt" < bounds.data_through
        and "organizationPlanType" in ('hobbyist', 'creator', 'growth', 'scale')
    ) / 100000.0 as v2_usage_accrual_mtd,
    sumIf(
      "generationCostMillicents",
      "generationEndedAt" >= addMonths(bounds.month_start, -1)
        and "generationEndedAt" < bounds.month_start
        and "organizationPlanType" in ('hobbyist', 'creator', 'growth', 'scale')
    ) / 100000.0 as prior_month_v2_usage_accrual
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
    ) / 100.0 as v3_top_up_payments_mtd,
    sumIf(
      amount,
      "createdAt" >= addMonths(bounds.month_start, -1)
        and "createdAt" < bounds.month_start
        and "billingVersion" = 'v3'
        and status = 'succeeded'
    ) / 100.0 as prior_month_v3_top_up_payments
  from sync_prod.sync_stripe_payments
  cross join bounds
), paced as (
  select
    usage.v2_usage_accrual_mtd
      * dateDiff('second', bounds.month_start, addMonths(bounds.month_start, 1))
      / nullIf(dateDiff('second', bounds.month_start, bounds.data_through), 0)
      as projected_v2_usage_accrual,
    topups.v3_top_up_payments_mtd
      * dateDiff('second', bounds.month_start, addMonths(bounds.month_start, 1))
      / nullIf(dateDiff('second', bounds.month_start, bounds.data_through), 0)
      as projected_v3_top_up_payments
  from bounds
  cross join usage
  cross join topups
)
select
  bounds.month_start as period_start,
  bounds.data_through as period_end,
  bounds.data_through as data_through,
  subscription_base.licensed_subscription_base,
  usage.v2_usage_accrual_mtd,
  paced.projected_v2_usage_accrual,
  topups.v3_top_up_payments_mtd,
  paced.projected_v3_top_up_payments,
  paced.projected_v2_usage_accrual + paced.projected_v3_top_up_payments
    as variable_revenue_run_rate,
  subscription_base.licensed_subscription_base
    + paced.projected_v2_usage_accrual
    + paced.projected_v3_top_up_payments as product_run_rate,
  product_run_rate * 12 as annualized_product_run_rate,
  usage.prior_month_v2_usage_accrual,
  topups.prior_month_v3_top_up_payments,
  subscription_base.active_subscriptions,
  subscription_base.active_organizations
from bounds
cross join subscription_base
cross join usage
cross join topups
cross join paced$query$,
    'table', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-run-rate-v4',
    (SELECT "id" FROM "question" WHERE "number" = 1102),
    4, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), periods as (
  select addMonths(month_start, -1) as period_start, month_start as period_end, 0 as is_current from bounds
  union all
  select month_start as period_start, data_through as period_end, 1 as is_current from bounds
), subscription_states as (
  select
    periods.period_start,
    subscriptions.id,
    argMaxIf(
      subscriptions.plan,
      tuple(subscriptions.currentPeriodStart, subscriptions.currentPeriodEnd, subscriptions.plan),
      subscriptions.createdAt < periods.period_end
    ) as current_plan,
    countIf(subscriptions.createdAt < periods.period_end and subscriptions.status in ('active', 'past_due')) > 0 as has_active_state,
    countIf(subscriptions.createdAt < periods.period_end and (subscriptions.status = 'canceled' or subscriptions.eventType = 'customer.subscription.deleted')) > 0 as has_terminal_state
  from sync_prod.sync_stripe_subscriptions_with_plan as subscriptions
  cross join periods
  group by periods.period_start, subscriptions.id
), subscription_base as (
  select
    period_start,
    sum(multiIf(
      current_plan = 'hobbyist', 6,
      current_plan = 'creator', 20,
      current_plan = 'growth', 50,
      current_plan = 'scale', 250,
      current_plan = 'starter', 12,
      current_plan = 'pro', 29,
      current_plan = 'team', 99,
      0
    )) as subscription_run_rate
  from subscription_states
  where has_active_state
    and not has_terminal_state
    and current_plan in ('hobbyist', 'creator', 'growth', 'scale', 'starter', 'pro', 'team')
  group by period_start
), usage as (
  select
    periods.period_start,
    periods.period_end,
    periods.is_current,
    sumIf(
      "generationCostMillicents",
      "generationEndedAt" >= periods.period_start
        and "generationEndedAt" < periods.period_end
        and "organizationPlanType" in ('hobbyist', 'creator', 'growth', 'scale')
    ) / 100000.0 as usage_actual
  from sync_prod.sync_usage3
  cross join periods
  group by periods.period_start, periods.period_end, periods.is_current
), topups as (
  select
    periods.period_start,
    periods.period_end,
    periods.is_current,
    sumIf(
      amount,
      "createdAt" >= periods.period_start
        and "createdAt" < periods.period_end
        and "billingVersion" = 'v3'
        and status = 'succeeded'
    ) / 100.0 as top_up_actual
  from sync_prod.sync_stripe_payments
  cross join periods
  group by periods.period_start, periods.period_end, periods.is_current
), values as (
  select
    usage.period_start,
    usage.period_end,
    subscription_base.subscription_run_rate,
    if(
      usage.is_current = 1,
      usage.usage_actual * dateDiff('second', usage.period_start, addMonths(usage.period_start, 1)) / nullIf(dateDiff('second', usage.period_start, usage.period_end), 0),
      usage.usage_actual
    ) as v2_usage_run_rate,
    if(
      topups.is_current = 1,
      topups.top_up_actual * dateDiff('second', topups.period_start, addMonths(topups.period_start, 1)) / nullIf(dateDiff('second', topups.period_start, topups.period_end), 0),
      topups.top_up_actual
    ) as v3_top_up_run_rate
  from usage
  inner join topups on topups.period_start = usage.period_start
  inner join subscription_base on subscription_base.period_start = usage.period_start
)
select
  values.period_start,
  values.subscription_run_rate + values.v2_usage_run_rate + values.v3_top_up_run_rate
    as product_run_rate,
  values.period_end,
  bounds.data_through as data_through
from values
cross join bounds
order by values.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-usage-history-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1103),
    2, 'SQL',
    $query$with months as (
  select addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -5 + toInt32(number)) as month
  from numbers(6)
), usage as (
  select
    toStartOfMonth("generationEndedAt") as month,
    sum("generationCostMillicents") / 100000.0 as v2_usage_accrual
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -5)
    and "generationEndedAt" < toStartOfMinute(toTimeZone(now(), 'UTC'))
    and "organizationPlanType" in ('hobbyist', 'creator', 'growth', 'scale')
  group by month
)
select
  months.month as period_start,
  ifNull(usage.v2_usage_accrual, 0) as v2_usage_accrual,
  if(
    months.month = toStartOfMonth(toTimeZone(now(), 'UTC')),
    usage.v2_usage_accrual
      * dateDiff('second', months.month, addMonths(months.month, 1))
      / nullIf(dateDiff('second', months.month, toStartOfMinute(toTimeZone(now(), 'UTC'))), 0),
    cast(null as Nullable(Float64))
  ) as projected_v2_usage_accrual,
  if(
    months.month = toStartOfMonth(toTimeZone(now(), 'UTC')),
    toStartOfMinute(toTimeZone(now(), 'UTC')),
    addMonths(months.month, 1)
  ) as period_end,
  toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
from months
left join usage on usage.month = months.month
order by period_start$query$,
    'bar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-usage-run-rate-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1110),
    2, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), periods as (
  select addMonths(month_start, -1) as period_start, month_start as period_end, 0 as is_current from bounds
  union all
  select month_start as period_start, data_through as period_end, 1 as is_current from bounds
), usage as (
  select
    periods.period_start,
    periods.period_end,
    periods.is_current,
    sumIf(
      "generationCostMillicents",
      "generationEndedAt" >= periods.period_start
        and "generationEndedAt" < periods.period_end
        and "organizationPlanType" in ('hobbyist', 'creator', 'growth', 'scale')
    ) / 100000.0 as usage_actual
  from sync_prod.sync_usage3
  cross join periods
  group by periods.period_start, periods.period_end, periods.is_current
)
select
  usage.period_start,
  if(
    usage.is_current = 1,
    usage.usage_actual * dateDiff('second', usage.period_start, addMonths(usage.period_start, 1)) / nullIf(dateDiff('second', usage.period_start, usage.period_end), 0),
    usage.usage_actual
  ) as v2_usage_run_rate,
  usage.period_end,
  bounds.data_through as data_through
from usage
cross join bounds
order by usage.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-v3-topup-run-rate-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1117),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), periods as (
  select addMonths(month_start, -1) as period_start, month_start as period_end, 0 as is_current from bounds
  union all
  select month_start as period_start, data_through as period_end, 1 as is_current from bounds
), topups as (
  select
    periods.period_start,
    periods.period_end,
    periods.is_current,
    sumIf(
      amount,
      "createdAt" >= periods.period_start
        and "createdAt" < periods.period_end
        and "billingVersion" = 'v3'
        and status = 'succeeded'
    ) / 100.0 as top_up_actual
  from sync_prod.sync_stripe_payments
  cross join periods
  group by periods.period_start, periods.period_end, periods.is_current
)
select
  topups.period_start,
  if(
    topups.is_current = 1,
    topups.top_up_actual * dateDiff('second', topups.period_start, addMonths(topups.period_start, 1)) / nullIf(dateDiff('second', topups.period_start, topups.period_end), 0),
    topups.top_up_actual
  ) as v3_top_up_run_rate,
  topups.period_end,
  bounds.data_through as data_through
from topups
cross join bounds
order by topups.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-variable-run-rate-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1118),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), periods as (
  select addMonths(month_start, -1) as period_start, month_start as period_end, 0 as is_current from bounds
  union all
  select month_start as period_start, data_through as period_end, 1 as is_current from bounds
), usage as (
  select
    periods.period_start,
    periods.period_end,
    periods.is_current,
    sumIf(
      "generationCostMillicents",
      "generationEndedAt" >= periods.period_start
        and "generationEndedAt" < periods.period_end
        and "organizationPlanType" in ('hobbyist', 'creator', 'growth', 'scale')
    ) / 100000.0 as usage_actual
  from sync_prod.sync_usage3
  cross join periods
  group by periods.period_start, periods.period_end, periods.is_current
), topups as (
  select
    periods.period_start,
    periods.period_end,
    periods.is_current,
    sumIf(
      amount,
      "createdAt" >= periods.period_start
        and "createdAt" < periods.period_end
        and "billingVersion" = 'v3'
        and status = 'succeeded'
    ) / 100.0 as top_up_actual
  from sync_prod.sync_stripe_payments
  cross join periods
  group by periods.period_start, periods.period_end, periods.is_current
), values as (
  select
    usage.period_start,
    usage.period_end,
    if(
      usage.is_current = 1,
      usage.usage_actual * dateDiff('second', usage.period_start, addMonths(usage.period_start, 1)) / nullIf(dateDiff('second', usage.period_start, usage.period_end), 0),
      usage.usage_actual
    ) as v2_usage_run_rate,
    if(
      topups.is_current = 1,
      topups.top_up_actual * dateDiff('second', topups.period_start, addMonths(topups.period_start, 1)) / nullIf(dateDiff('second', topups.period_start, topups.period_end), 0),
      topups.top_up_actual
    ) as v3_top_up_run_rate
  from usage
  inner join topups on topups.period_start = usage.period_start
)
select
  values.period_start,
  values.v2_usage_run_rate + values.v3_top_up_run_rate as variable_revenue_run_rate,
  values.period_end,
  bounds.data_through as data_through
from values
cross join bounds
order by values.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-revenue-sync-tools-card-v3-topup-run-rate',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-tools',
    (SELECT "id" FROM "question" WHERE "number" = 1117),
    2, 16, 0, 8, 5, 'NUMBER', '{"compareCurrentPeriod":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-tools-card-variable-run-rate',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-tools',
    (SELECT "id" FROM "question" WHERE "number" = 1118),
    3, 0, 5, 12, 5, 'NUMBER', '{"compareCurrentPeriod":true}'::jsonb,
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

UPDATE "dashboardCard"
SET
  "position" = 0,
  "x" = 0,
  "y" = 0,
  "width" = 8,
  "height" = 5,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-sync-tools-card-subscription-run-rate';

UPDATE "dashboardCard"
SET
  "position" = 1,
  "x" = 8,
  "y" = 0,
  "width" = 8,
  "height" = 5,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-sync-tools-card-usage-run-rate';

UPDATE "dashboardCard"
SET
  "position" = 4,
  "x" = 12,
  "y" = 5,
  "width" = 12,
  "height" = 5,
  "displaySettings" = '{"compareCurrentPeriod":true}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-sync-tools-card-combined';

UPDATE "dashboardCard"
SET
  "position" = 5,
  "x" = 0,
  "y" = 10,
  "width" = 24,
  "height" = 9,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-sync-tools-card-usage';

UPDATE "dashboardCard"
SET
  "position" = 6,
  "x" = 0,
  "y" = 19,
  "width" = 24,
  "height" = 10,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-sync-tools-card-subscription';
