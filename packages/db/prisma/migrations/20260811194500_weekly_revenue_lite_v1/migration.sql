INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-weekly-revenue-dashboard', 7, 'Weekly Revenue Lite',
  'Live governed product run-rate and usage-retention report. Each result uses explicit UTC bounds, an immutable snapshot, and a visible verification state.',
  1, 'atlas', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES
  (
    'atlas-weekly-revenue-tab-overview', 'atlas-weekly-revenue-dashboard', 1,
    'Run-rate', 0, 'atlas:weekly-revenue-lite:overview'
  ),
  (
    'atlas-weekly-revenue-tab-ndr', 'atlas-weekly-revenue-dashboard', 2,
    'NDR & retention', 1, 'atlas:weekly-revenue-lite:ndr'
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
    'atlas-weekly-revenue-question-overview', 1101,
    'Weekly Revenue Lite overview',
    'Current self-serve licensed base, accrued usage actual and pace, product run-rate, annualized run-rate, prior complete-month usage, pace comparison, and Stripe cash reconciliation at one UTC cutoff.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:overview',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-run-rate', 1102,
    'Current product run-rate',
    'Current self-serve licensed subscription base plus projected current-month accrued usage. Enterprise and Studio commitments are excluded.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:product-run-rate',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-usage-history', 1103,
    'Paid-plan usage accrual history and MTD pace',
    'Five completed UTC calendar months plus current-month actual and projected accrued usage, grouped by generationEndedAt.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:usage-history-pace',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-licensed-base', 1104,
    'Active licensed subscription base by plan',
    'Latest active or past-due self-serve subscriptions multiplied by the current licensed monthly price. Includes v2 and v3; excludes enterprise, program, and partner plans.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:licensed-base-by-plan',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-monthly-ndr', 1105,
    'Latest complete-month usage NDR',
    'Next-month accrued usage from the fixed starting organization cohort divided by its starting-month accrued usage.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:complete-month-ndr',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-monthly-ndr-tiers', 1106,
    'Complete-month usage NDR by starting tier',
    'Latest complete-month accrued usage NDR grouped by each organization plan at the end of the starting month.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:complete-month-ndr-tiers',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-weekly-ndr', 1107,
    'Weekly usage NDR proxy',
    'Directional usage retention for the previous complete Monday-Sunday UTC week from the fixed prior-week cohort. This is not finance-grade NDR.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:weekly-ndr-proxy',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-weekly-bridge', 1108,
    'Weekly usage retention bridge',
    'Starting cohort usage, retained usage, total report-week usage, usage outside the starting cohort, and total week-over-week movement.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:weekly-retention-bridge',
    'atlas:weekly-revenue-lite', '166', 'ACTIVE', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-question-weekly-ndr-tiers', 1109,
    'Weekly usage NDR proxy by starting tier',
    'Directional complete-week usage retention grouped by each organization plan at the end of the starting week.',
    'METABASE', 'atlas-revenue-source', 'weekly-revenue:weekly-ndr-tiers',
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
    'atlas-weekly-revenue-version-overview-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1101),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), latest_subscriptions as (
  select
    id,
    argMax(status, createdAt) as current_status,
    argMax(plan, createdAt) as current_plan,
    argMax(organizationId, createdAt) as organization_id
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
  from latest_subscriptions
  where current_status in ('active', 'past_due')
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
), collections as (
  select sum(amount_paid) / 100.0 as stripe_collections_mtd
  from (
    select
      id,
      argMax("amountPaid", createdAt) as amount_paid,
      argMax(status, createdAt) as current_status,
      argMax("createdAt", createdAt) as invoice_created_at
    from sync_prod.sync_stripe_invoices
    cross join bounds
    where "createdAt" < bounds.data_through
    group by id
  )
  where current_status = 'paid'
    and invoice_created_at >= (select month_start from bounds)
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
    'table', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-run-rate-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1102),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), latest_subscriptions as (
  select
    id,
    argMax(status, createdAt) as current_status,
    argMax(plan, createdAt) as current_plan
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
  from latest_subscriptions
  where current_status in ('active', 'past_due')
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
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-usage-history-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1103),
    1, 'SQL',
    $query$with months as (
  select addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -5 + toInt32(number)) as month
  from numbers(6)
), usage as (
  select
    toStartOfMonth("generationEndedAt") as month,
    sum("generationCostMillicents") / 100000.0 as usage_accrual
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -5)
    and "generationEndedAt" < toStartOfMinute(toTimeZone(now(), 'UTC'))
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
  group by month
)
select
  months.month as period_start,
  ifNull(usage.usage_accrual, 0) as usage_accrual,
  if(
    months.month = toStartOfMonth(toTimeZone(now(), 'UTC')),
    usage.usage_accrual
      * dateDiff('second', months.month, addMonths(months.month, 1))
      / nullIf(dateDiff('second', months.month, toStartOfMinute(toTimeZone(now(), 'UTC'))), 0),
    cast(null as Nullable(Float64))
  ) as projected_usage_accrual,
  if(
    months.month = toStartOfMonth(toTimeZone(now(), 'UTC')),
    toStartOfMinute(toTimeZone(now(), 'UTC')),
    addMonths(months.month, 1)
  ) as period_end,
  toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
from months
left join usage on usage.month = months.month
order by period_start$query$,
    'bar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-licensed-base-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1104),
    1, 'SQL',
    $query$with latest_subscriptions as (
  select
    id,
    argMax(status, createdAt) as current_status,
    argMax(plan, createdAt) as current_plan,
    argMax(organizationId, createdAt) as organization_id
  from sync_prod.sync_stripe_subscriptions_with_plan
  where createdAt < toStartOfMinute(toTimeZone(now(), 'UTC'))
  group by id
)
select
  toStartOfMonth(toTimeZone(now(), 'UTC')) as period_start,
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
  toStartOfMinute(toTimeZone(now(), 'UTC')) as period_end,
  toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
from latest_subscriptions
where current_status in ('active', 'past_due')
  and current_plan in ('hobbyist', 'creator', 'growth', 'scale', 'starter', 'pro', 'team')
group by current_plan
order by licensed_subscription_base desc$query$,
    'table', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-monthly-ndr-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1105),
    1, 'SQL',
    $query$with monthly_org_usage as (
  select
    toStartOfMonth("generationEndedAt") as month,
    "organizationId" as organization_id,
    sum("generationCostMillicents") / 100000.0 as usage_accrual
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -2)
    and "generationEndedAt" < toStartOfMonth(toTimeZone(now(), 'UTC'))
    and "organizationId" != ''
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
  group by month, organization_id
), cohort as (
  select
    p.organization_id,
    p.usage_accrual as starting_value,
    ifNull(c.usage_accrual, 0) as retained_value
  from monthly_org_usage p
  left join monthly_org_usage c
    on c.organization_id = p.organization_id
    and c.month = addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -1)
  where p.month = addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -2)
)
select
  addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -1) as period_start,
  sum(retained_value) / nullIf(sum(starting_value), 0) * 100 as usage_ndr_pct,
  toStartOfMonth(toTimeZone(now(), 'UTC')) as period_end,
  toStartOfMonth(toTimeZone(now(), 'UTC')) as data_through
from cohort$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-monthly-ndr-tiers-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1106),
    1, 'SQL',
    $query$with monthly_org_usage as (
  select
    toStartOfMonth("generationEndedAt") as month,
    "organizationId" as organization_id,
    argMax("organizationPlanType", "generationEndedAt") as starting_plan,
    sum("generationCostMillicents") / 100000.0 as usage_accrual
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -2)
    and "generationEndedAt" < toStartOfMonth(toTimeZone(now(), 'UTC'))
    and "organizationId" != ''
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
  group by month, organization_id
), cohort as (
  select
    p.organization_id,
    p.starting_plan,
    p.usage_accrual as starting_value,
    ifNull(c.usage_accrual, 0) as retained_value
  from monthly_org_usage p
  left join monthly_org_usage c
    on c.organization_id = p.organization_id
    and c.month = addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -1)
  where p.month = addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -2)
)
select
  addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -1) as period_start,
  starting_plan as starting_tier,
  count() as starting_organizations,
  sum(starting_value) as starting_usage_accrual,
  sum(retained_value) as retained_usage_accrual,
  sum(retained_value) / nullIf(sum(starting_value), 0) * 100 as usage_ndr_pct,
  toStartOfMonth(toTimeZone(now(), 'UTC')) as period_end,
  toStartOfMonth(toTimeZone(now(), 'UTC')) as data_through
from cohort
group by starting_plan
order by starting_usage_accrual desc$query$,
    'table', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-weekly-ndr-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1107),
    1, 'SQL',
    $query$with weekly_org_usage as (
  select
    toStartOfWeek("generationEndedAt", 1) as week,
    "organizationId" as organization_id,
    sum("generationCostMillicents") / 100000.0 as usage_accrual
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -2)
    and "generationEndedAt" < toStartOfWeek(toTimeZone(now(), 'UTC'), 1)
    and "organizationId" != ''
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
  group by week, organization_id
), cohort as (
  select
    p.organization_id,
    p.usage_accrual as starting_value,
    ifNull(c.usage_accrual, 0) as retained_value
  from weekly_org_usage p
  left join weekly_org_usage c
    on c.organization_id = p.organization_id
    and c.week = addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -1)
  where p.week = addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -2)
)
select
  addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -1) as period_start,
  sum(retained_value) / nullIf(sum(starting_value), 0) * 100 as usage_ndr_proxy_pct,
  toStartOfWeek(toTimeZone(now(), 'UTC'), 1) as period_end,
  toStartOfWeek(toTimeZone(now(), 'UTC'), 1) as data_through
from cohort$query$,
    'smartscalar', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-weekly-bridge-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1108),
    1, 'SQL',
    $query$with weekly_org_usage as (
  select
    toStartOfWeek("generationEndedAt", 1) as week,
    "organizationId" as organization_id,
    sum("generationCostMillicents") / 100000.0 as usage_accrual
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -2)
    and "generationEndedAt" < toStartOfWeek(toTimeZone(now(), 'UTC'), 1)
    and "organizationId" != ''
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
  group by week, organization_id
), cohort as (
  select
    p.organization_id,
    p.usage_accrual as starting_value,
    ifNull(c.usage_accrual, 0) as retained_value
  from weekly_org_usage p
  left join weekly_org_usage c
    on c.organization_id = p.organization_id
    and c.week = addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -1)
  where p.week = addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -2)
), totals as (
  select
    sumIf(usage_accrual, week = addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -2)) as starting_total,
    sumIf(usage_accrual, week = addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -1)) as report_total
  from weekly_org_usage
)
select
  addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -1) as period_start,
  count() as starting_organizations,
  sum(starting_value) as starting_usage_accrual,
  sum(retained_value) as retained_usage_accrual,
  sum(retained_value) / nullIf(sum(starting_value), 0) * 100 as usage_ndr_proxy_pct,
  any(totals.report_total) as report_total_usage,
  any(totals.report_total) - sum(retained_value) as usage_outside_starting_cohort,
  (any(totals.report_total) / nullIf(any(totals.starting_total), 0) - 1) * 100 as total_usage_wow_pct,
  toStartOfWeek(toTimeZone(now(), 'UTC'), 1) as period_end,
  toStartOfWeek(toTimeZone(now(), 'UTC'), 1) as data_through
from cohort
cross join totals$query$,
    'table', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-version-weekly-ndr-tiers-v1',
    (SELECT "id" FROM "question" WHERE "number" = 1109),
    1, 'SQL',
    $query$with weekly_org_usage as (
  select
    toStartOfWeek("generationEndedAt", 1) as week,
    "organizationId" as organization_id,
    argMax("organizationPlanType", "generationEndedAt") as starting_plan,
    sum("generationCostMillicents") / 100000.0 as usage_accrual
  from sync_prod.sync_usage3
  where "generationEndedAt" >= addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -2)
    and "generationEndedAt" < toStartOfWeek(toTimeZone(now(), 'UTC'), 1)
    and "organizationId" != ''
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
  group by week, organization_id
), cohort as (
  select
    p.organization_id,
    p.starting_plan,
    p.usage_accrual as starting_value,
    ifNull(c.usage_accrual, 0) as retained_value
  from weekly_org_usage p
  left join weekly_org_usage c
    on c.organization_id = p.organization_id
    and c.week = addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -1)
  where p.week = addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -2)
)
select
  addWeeks(toStartOfWeek(toTimeZone(now(), 'UTC'), 1), -1) as period_start,
  starting_plan as starting_tier,
  count() as starting_organizations,
  sum(starting_value) as starting_usage_accrual,
  sum(retained_value) as retained_usage_accrual,
  sum(retained_value) / nullIf(sum(starting_value), 0) * 100 as usage_ndr_proxy_pct,
  toStartOfWeek(toTimeZone(now(), 'UTC'), 1) as period_end,
  toStartOfWeek(toTimeZone(now(), 'UTC'), 1) as data_through
from cohort
group by starting_plan
order by starting_usage_accrual desc$query$,
    'table', '{}'::jsonb, NULL, 'atlas', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-weekly-revenue-card-run-rate', 'atlas-weekly-revenue-dashboard',
    'atlas-weekly-revenue-tab-overview', 'atlas-weekly-revenue-question-run-rate',
    0, 0, 0, 8, 5, 'NUMBER',
    '{"timeframe":"Current UTC month through the shared source cutoff"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-card-overview', 'atlas-weekly-revenue-dashboard',
    'atlas-weekly-revenue-tab-overview', 'atlas-weekly-revenue-question-overview',
    1, 8, 0, 16, 7, 'TABLE',
    '{"timeframe":"Current UTC month through the shared source cutoff","visibleRows":"all"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-card-usage-history', 'atlas-weekly-revenue-dashboard',
    'atlas-weekly-revenue-tab-overview', 'atlas-weekly-revenue-question-usage-history',
    2, 0, 7, 16, 9, 'BAR',
    '{"timeframe":"Five completed UTC months plus current month to date"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-card-licensed-base', 'atlas-weekly-revenue-dashboard',
    'atlas-weekly-revenue-tab-overview', 'atlas-weekly-revenue-question-licensed-base',
    3, 16, 7, 8, 9, 'TABLE',
    '{"timeframe":"Current state at the shared UTC cutoff","visibleRows":"all"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-card-monthly-ndr', 'atlas-weekly-revenue-dashboard',
    'atlas-weekly-revenue-tab-ndr', 'atlas-weekly-revenue-question-monthly-ndr',
    0, 0, 0, 12, 5, 'NUMBER',
    '{"timeframe":"Latest complete UTC calendar-month pair"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-card-weekly-ndr', 'atlas-weekly-revenue-dashboard',
    'atlas-weekly-revenue-tab-ndr', 'atlas-weekly-revenue-question-weekly-ndr',
    1, 12, 0, 12, 5, 'NUMBER',
    '{"timeframe":"Previous complete Monday-Sunday UTC week","periodLabel":"Directional proxy"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-card-monthly-ndr-tiers', 'atlas-weekly-revenue-dashboard',
    'atlas-weekly-revenue-tab-ndr', 'atlas-weekly-revenue-question-monthly-ndr-tiers',
    2, 0, 5, 12, 11, 'TABLE',
    '{"timeframe":"Latest complete UTC calendar-month pair","visibleRows":"all"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-card-weekly-ndr-tiers', 'atlas-weekly-revenue-dashboard',
    'atlas-weekly-revenue-tab-ndr', 'atlas-weekly-revenue-question-weekly-ndr-tiers',
    3, 12, 5, 12, 11, 'TABLE',
    '{"timeframe":"Previous complete Monday-Sunday UTC week","visibleRows":"all"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-weekly-revenue-card-weekly-bridge', 'atlas-weekly-revenue-dashboard',
    'atlas-weekly-revenue-tab-ndr', 'atlas-weekly-revenue-question-weekly-bridge',
    4, 0, 16, 24, 7, 'TABLE',
    '{"timeframe":"Previous complete Monday-Sunday UTC week","visibleRows":"all"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE SET
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
