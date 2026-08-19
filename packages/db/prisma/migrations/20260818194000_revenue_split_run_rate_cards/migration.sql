UPDATE "question"
SET
  "description" = 'Self-serve subscription run-rate plus projected current-month usage accrual, compared with the previous complete month at UTC cutoffs. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1102;

UPDATE "question"
SET
  "name" = 'Self-serve subscription run-rate by billing type and plan',
  "description" = 'Latest active or past-due self-serve Stripe subscriptions multiplied by the current monthly plan price, grouped by V2 or V3 billing type and plan. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed. This is subscription run-rate, not cash collected.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1104;

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-weekly-revenue-question-usage-run-rate', 1110,
    'Self-serve usage run-rate',
    'Projected self-serve usage accrual for the current UTC month compared with the previous complete month. Completed months use actual accrued usage. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:usage-run-rate',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-subscription-run-rate', 1111,
    'Self-serve subscription run-rate',
    'Active or past-due self-serve subscriptions at the plan price in effect at each UTC cutoff, compared with the previous month-end. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:subscription-run-rate',
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
    'atlas-weekly-revenue-version-run-rate-v3',
    (SELECT "id" FROM "question" WHERE "number" = 1102),
    3, 'SQL',
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
), subscription_states as (
  select
    periods.period_start,
    subscriptions.id,
    argMaxIf(
      subscriptions.plan,
      tuple(subscriptions.currentPeriodStart, subscriptions.currentPeriodEnd, subscriptions.plan),
      subscriptions.createdAt < periods.period_end
    ) as current_plan,
    countIf(
      subscriptions.createdAt < periods.period_end
        and subscriptions.status in ('active', 'past_due')
    ) > 0 as has_active_state,
    countIf(
      subscriptions.createdAt < periods.period_end
        and (subscriptions.status = 'canceled' or subscriptions.eventType = 'customer.subscription.deleted')
    ) > 0 as has_terminal_state
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
        and "organizationPlanType" is not null
        and "organizationPlanType" != ''
    ) / 100000.0 as usage_actual
  from sync_prod.sync_usage3
  cross join periods
  group by periods.period_start, periods.period_end, periods.is_current
), values as (
  select
    usage.period_start,
    subscription_base.subscription_run_rate,
    if(
      usage.is_current = 1,
      usage.usage_actual
        * dateDiff('second', usage.period_start, addMonths(usage.period_start, 1))
        / nullIf(dateDiff('second', usage.period_start, usage.period_end), 0),
      usage.usage_actual
    ) as usage_run_rate,
    usage.period_end
  from usage
  inner join subscription_base on subscription_base.period_start = usage.period_start
)
select
  values.period_start,
  values.subscription_run_rate + values.usage_run_rate as product_run_rate,
  values.period_end,
  bounds.data_through as data_through
from values
cross join bounds
order by values.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-usage-run-rate-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1110),
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
        and "organizationPlanType" is not null
        and "organizationPlanType" != ''
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
  ) as usage_run_rate,
  usage.period_end,
  bounds.data_through as data_through
from usage
cross join bounds
order by usage.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-subscription-run-rate-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1111),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), periods as (
  select
    addMonths(bounds.month_start, -1) as period_start,
    bounds.month_start as period_end
  from bounds
  union all
  select
    bounds.month_start as period_start,
    bounds.data_through as period_end
  from bounds
), subscription_states as (
  select
    periods.period_start,
    periods.period_end,
    subscriptions.id,
    argMaxIf(
      subscriptions.plan,
      tuple(subscriptions.currentPeriodStart, subscriptions.currentPeriodEnd, subscriptions.plan),
      subscriptions.createdAt < periods.period_end
    ) as current_plan,
    countIf(
      subscriptions.createdAt < periods.period_end
        and subscriptions.status in ('active', 'past_due')
    ) > 0 as has_active_state,
    countIf(
      subscriptions.createdAt < periods.period_end
        and (subscriptions.status = 'canceled' or subscriptions.eventType = 'customer.subscription.deleted')
    ) > 0 as has_terminal_state
  from sync_prod.sync_stripe_subscriptions_with_plan as subscriptions
  cross join periods
  group by periods.period_start, periods.period_end, subscriptions.id
)
select
  subscription_states.period_start,
  sum(multiIf(
    current_plan = 'hobbyist', 6,
    current_plan = 'creator', 20,
    current_plan = 'growth', 50,
    current_plan = 'scale', 250,
    current_plan = 'starter', 12,
    current_plan = 'pro', 29,
    current_plan = 'team', 99,
    0
  )) as subscription_run_rate,
  subscription_states.period_end,
  bounds.data_through as data_through
from subscription_states
cross join bounds
where has_active_state
  and not has_terminal_state
  and current_plan in ('hobbyist', 'creator', 'growth', 'scale', 'starter', 'pro', 'team')
group by subscription_states.period_start, subscription_states.period_end, bounds.data_through
order by subscription_states.period_start$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-licensed-base-v3',
    (SELECT "id" FROM "question" WHERE "number" = 1104),
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
)
select
  bounds.month_start as period_start,
  multiIf(
    current_plan in ('hobbyist', 'creator', 'growth', 'scale'), 'V2',
    current_plan in ('starter', 'pro', 'team'), 'V3',
    'Other'
  ) as billing_type,
  current_plan as plan,
  count() as subscriptions,
  uniqExact(organization_id) as organizations,
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
  bounds.data_through as period_end,
  bounds.data_through as data_through
from subscription_states
cross join bounds
where has_active_state
  and not has_terminal_state
  and current_plan in ('hobbyist', 'creator', 'growth', 'scale', 'starter', 'pro', 'team')
group by bounds.month_start, bounds.data_through, billing_type, current_plan
order by billing_type, licensed_subscription_base desc$query$,
    'table', '{}'::jsonb, NULL, 'atlas-revenue-registry', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-revenue-sync-tools-card-usage-run-rate',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-tools',
    (SELECT "id" FROM "question" WHERE "number" = 1110),
    0, 0, 0, 8, 5, 'NUMBER', '{"compareCurrentPeriod":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-tools-card-subscription-run-rate',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-tools',
    (SELECT "id" FROM "question" WHERE "number" = 1111),
    1, 8, 0, 8, 5, 'NUMBER', '{"compareCurrentPeriod":true}'::jsonb,
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
  "position" = 2,
  "x" = 16,
  "y" = 0,
  "width" = 8,
  "height" = 5,
  "displaySettings" = '{"compareCurrentPeriod":true}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-sync-tools-card-combined';

UPDATE "dashboardCard"
SET
  "position" = 3,
  "x" = 0,
  "y" = 5,
  "width" = 24,
  "height" = 9,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-sync-tools-card-usage';

UPDATE "dashboardCard"
SET
  "position" = 4,
  "x" = 0,
  "y" = 14,
  "width" = 24,
  "height" = 10,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-sync-tools-card-subscription';
