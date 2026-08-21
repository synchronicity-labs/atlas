INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-weekly-revenue-version-revenue-history-v4',
  (SELECT "id" FROM "question" WHERE "number" = 1103),
  4,
  'SQL',
  $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), months as (
  select
    addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -5 + toInt32(number)) as period_start
  from numbers(6)
), periods as (
  select
    months.period_start as period_start,
    if(
      months.period_start = bounds.month_start,
      bounds.data_through,
      addMonths(months.period_start, 1)
    ) as period_end,
    months.period_start = bounds.month_start as is_current
  from months
  cross join bounds
), subscription_states as (
  select
    periods.period_start as period_start,
    subscriptions.id as subscription_id,
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
), subscription_values as (
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
    )) as subscription_revenue
  from subscription_states
  where has_active_state
    and not has_terminal_state
    and current_plan in ('hobbyist', 'creator', 'growth', 'scale', 'starter', 'pro', 'team')
  group by period_start
), usage_values as (
  select
    periods.period_start as period_start,
    sumIf(
      "generationCostMillicents",
      "generationEndedAt" >= periods.period_start
        and "generationEndedAt" < periods.period_end
        and "organizationPlanType" in ('hobbyist', 'creator', 'growth', 'scale')
    ) / 100000.0 as v2_usage_revenue
  from sync_prod.sync_usage3
  cross join periods
  group by periods.period_start
), top_up_values as (
  select
    periods.period_start as period_start,
    sumIf(
      amount,
      "createdAt" >= periods.period_start
        and "createdAt" < periods.period_end
        and "billingVersion" = 'v3'
        and status = 'succeeded'
    ) / 100.0 as v3_top_up_revenue
  from sync_prod.sync_stripe_payments
  cross join periods
  group by periods.period_start
), values_by_month as (
  select
    periods.period_start as period_start,
    periods.period_end as period_end,
    periods.is_current as is_current,
    ifNull(subscription_values.subscription_revenue, 0) as subscription_revenue,
    ifNull(usage_values.v2_usage_revenue, 0) as v2_usage_revenue,
    ifNull(top_up_values.v3_top_up_revenue, 0) as v3_top_up_revenue
  from periods
  left join subscription_values on subscription_values.period_start = periods.period_start
  left join usage_values on usage_values.period_start = periods.period_start
  left join top_up_values on top_up_values.period_start = periods.period_start
)
select
  period_start,
  subscription_revenue,
  v2_usage_revenue,
  v3_top_up_revenue,
  subscription_revenue + v2_usage_revenue + v3_top_up_revenue as actual_revenue,
  if(
    is_current,
    subscription_revenue
      + (v2_usage_revenue + v3_top_up_revenue)
        * dateDiff('second', period_start, addMonths(period_start, 1))
        / nullIf(dateDiff('second', period_start, period_end), 0),
    cast(null as Nullable(Float64))
  ) as estimated_month_end_revenue,
  period_end,
  bounds.data_through as data_through
from values_by_month
cross join bounds
order by period_start$query$,
  'bar',
  '{}'::jsonb,
  NULL,
  'atlas-revenue-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;
