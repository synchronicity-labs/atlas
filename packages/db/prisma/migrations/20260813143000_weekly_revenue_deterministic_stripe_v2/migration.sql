INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-weekly-revenue-version-overview-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1101),
    2, 'SQL',
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
        and "organizationPlanType" is not null
        and "organizationPlanType" != ''
    ) / 100000.0 as usage_accrual_mtd,
    sumIf(
      "generationCostMillicents",
      "generationEndedAt" >= addMonths(bounds.month_start, -1)
        and "generationEndedAt" < bounds.month_start
        and "organizationPlanType" is not null
        and "organizationPlanType" != ''
    ) / 100000.0 as prior_month_usage_accrual
  from sync_prod.sync_usage3
  cross join bounds
), invoice_states as (
  select
    id,
    max("amountPaid") as amount_paid,
    min("createdAt") as invoice_created_at,
    max(JSONExtractUInt(payload, 'status_transitions', 'paid_at')) as paid_at
  from sync_prod.sync_stripe_invoices
  group by id
), collections as (
  select sum(amount_paid) / 100.0 as stripe_collections_mtd
  from invoice_states
  cross join bounds
  where invoice_created_at >= bounds.month_start
    and invoice_created_at < bounds.data_through
    and paid_at > 0
    and paid_at < toUnixTimestamp(bounds.data_through)
)
select
  bounds.month_start as period_start,
  bounds.data_through as period_end,
  bounds.data_through as data_through,
  subscription_base.licensed_subscription_base as licensed_subscription_base,
  usage.usage_accrual_mtd as usage_accrual_mtd,
  usage.usage_accrual_mtd
    * dateDiff('second', bounds.month_start, addMonths(bounds.month_start, 1))
    / nullIf(dateDiff('second', bounds.month_start, bounds.data_through), 0)
    as projected_usage_accrual,
  subscription_base.licensed_subscription_base + projected_usage_accrual
    as product_run_rate,
  (subscription_base.licensed_subscription_base + projected_usage_accrual) * 12
    as annualized_product_run_rate,
  usage.prior_month_usage_accrual as prior_month_usage_accrual,
  (projected_usage_accrual / nullIf(usage.prior_month_usage_accrual, 0) - 1) * 100
    as projected_usage_vs_prior_month_pct,
  collections.stripe_collections_mtd as stripe_collections_mtd,
  subscription_base.active_subscriptions as active_subscriptions,
  subscription_base.active_organizations as active_organizations
from bounds
cross join subscription_base
cross join usage
cross join collections$query$,
    'table', '{}'::jsonb, NULL, 'atlas-revenue-verification', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-run-rate-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1102),
    2, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), subscription_states as (
  select
    id,
    argMax(plan, tuple(currentPeriodStart, currentPeriodEnd, plan)) as current_plan,
    countIf(status in ('active', 'past_due')) > 0 as has_active_state,
    countIf(status = 'canceled' or eventType = 'customer.subscription.deleted') > 0 as has_terminal_state
  from sync_prod.sync_stripe_subscriptions_with_plan
  cross join bounds
  where createdAt < bounds.data_through
  group by id
), subscription_base as (
  select sum(multiIf(
    current_plan = 'hobbyist', 6,
    current_plan = 'creator', 20,
    current_plan = 'growth', 50,
    current_plan = 'scale', 250,
    current_plan = 'starter', 12,
    current_plan = 'pro', 29,
    current_plan = 'team', 99,
    0
  )) as licensed_subscription_base
  from subscription_states
  where has_active_state
    and not has_terminal_state
    and current_plan in ('hobbyist', 'creator', 'growth', 'scale', 'starter', 'pro', 'team')
), usage as (
  select sum("generationCostMillicents") / 100000.0 as usage_accrual_mtd
  from sync_prod.sync_usage3
  cross join bounds
  where "generationEndedAt" >= bounds.month_start
    and "generationEndedAt" < bounds.data_through
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
)
select
  bounds.month_start as period_start,
  subscription_base.licensed_subscription_base
    + usage.usage_accrual_mtd
      * dateDiff('second', bounds.month_start, addMonths(bounds.month_start, 1))
      / nullIf(dateDiff('second', bounds.month_start, bounds.data_through), 0)
    as product_run_rate,
  bounds.data_through as period_end,
  bounds.data_through as data_through
from bounds
cross join subscription_base
cross join usage$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas-revenue-verification', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-licensed-base-v2',
    (SELECT "id" FROM "question" WHERE "number" = 1104),
    2, 'SQL',
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
group by bounds.month_start, bounds.data_through, current_plan
order by licensed_subscription_base desc$query$,
    'table', '{}'::jsonb, NULL, 'atlas-revenue-verification', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO NOTHING;
