UPDATE "revenueDoorPolicy"
SET
  "status" = 'PARTIAL',
  "notes" = 'Seven channel partners are listed in Sanjit''s registry. Atlas can use the domains as a provisional revenue filter. Final certification is blocked by unresolved Product organization and Stripe billing mappings for Replicate, MagicHour, Runware, Adapt Global, and Fal manual wires.',
  "reviewedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'company-revenue-doors';

UPDATE "dashboard"
SET
  "description" = 'Monthly revenue and NDR by revenue door. sync.tools shows a separate open-month operating estimate for subscriptions, V2 postpaid usage, and V3 top-ups. Company booked revenue remains invoice-based and is not replaced by that estimate.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 2;

UPDATE "dashboard"
SET
  "description" = 'Company KPIs use the same canonical Atlas questions as the team dashboards. A card keeps its own trust state, while the overall dashboard stays pending when any required company KPI is still open.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 8;

UPDATE "question"
SET
  "name" = 'Estimated self-serve month-end revenue',
  "description" = 'Current subscription value plus estimated month-end V2 postpaid usage and V3 top-up payments. This is an open-month operating estimate, not company booked revenue or cash collected.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1102;

UPDATE "question"
SET
  "name" = 'Self-serve revenue history and current-month pace',
  "description" = 'Six months of self-serve subscription value, V2 postpaid usage, and V3 top-up payments. Completed months show actual values. The open month also shows an estimated month-end total from the shared UTC data-through time.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1103;

UPDATE "question"
SET
  "name" = 'Estimated self-serve V2 usage month-end',
  "description" = 'Estimated month-end V2 postpaid usage compared with the previous complete month. This is one part of self-serve revenue and is not the headline company booked-revenue measure.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1110;

UPDATE "question"
SET
  "name" = 'Estimated self-serve V3 top-ups month-end',
  "description" = 'Estimated month-end V3 credit top-up payments compared with the previous complete month. This is successful top-up payment volume, not V3 credit consumption or company cash flow.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1117;

UPDATE "question"
SET
  "name" = 'Estimated self-serve variable revenue month-end',
  "description" = 'Estimated month-end V2 postpaid usage plus V3 top-up payments, compared with the previous complete month. This excludes recurring subscription value and V3 credit consumption.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1118;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-weekly-revenue-version-revenue-history-v3',
  (SELECT "id" FROM "question" WHERE "number" = 1103),
  3,
  'SQL',
  $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), periods as (
  select
    addMonths(bounds.month_start, -5 + toInt32(number)) as period_start,
    if(
      addMonths(bounds.month_start, -5 + toInt32(number)) = bounds.month_start,
      bounds.data_through,
      addMonths(addMonths(bounds.month_start, -5 + toInt32(number)), 1)
    ) as period_end,
    addMonths(bounds.month_start, -5 + toInt32(number)) = bounds.month_start as is_current
  from bounds
  cross join numbers(6)
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
    periods.period_start,
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
    periods.period_start,
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
), monthly_values as (
  select
    periods.period_start,
    periods.period_end,
    periods.is_current,
    ifNull(subscription_values.subscription_revenue, 0) as subscription_revenue,
    ifNull(usage_values.v2_usage_revenue, 0) as v2_usage_revenue,
    ifNull(top_up_values.v3_top_up_revenue, 0) as v3_top_up_revenue
  from periods
  left join subscription_values on subscription_values.period_start = periods.period_start
  left join usage_values on usage_values.period_start = periods.period_start
  left join top_up_values on top_up_values.period_start = periods.period_start
)
select
  monthly_values.period_start,
  monthly_values.subscription_revenue,
  monthly_values.v2_usage_revenue,
  monthly_values.v3_top_up_revenue,
  monthly_values.subscription_revenue
    + monthly_values.v2_usage_revenue
    + monthly_values.v3_top_up_revenue as actual_revenue,
  if(
    monthly_values.is_current,
    monthly_values.subscription_revenue
      + (monthly_values.v2_usage_revenue + monthly_values.v3_top_up_revenue)
        * dateDiff('second', monthly_values.period_start, addMonths(monthly_values.period_start, 1))
        / nullIf(dateDiff('second', monthly_values.period_start, monthly_values.period_end), 0),
    cast(null as Nullable(Float64))
  ) as estimated_month_end_revenue,
  monthly_values.period_end,
  bounds.data_through as data_through
from monthly_values
cross join bounds
order by monthly_values.period_start$query$,
  'bar',
  '{}'::jsonb,
  NULL,
  'atlas-revenue-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

UPDATE "dashboardCard"
SET
  "questionId" = (SELECT "id" FROM "question" WHERE "number" = 1116),
  "visualization" = 'TABLE',
  "displaySettings" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'cmsxi10c200ay05jrjw6np83r';

UPDATE "metrics"."metricCatalogEntry"
SET
  "canonicalQuestionId" = (SELECT "id" FROM "question" WHERE "number" = 1116),
  "readiness" = 'RECONCILING',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE lower("title") = 'channel partner revenue by partner'
  AND "missingAt" IS NULL;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-company-kpis-revenue-doors',
  (SELECT "id" FROM "dashboard" WHERE "number" = 8),
  2,
  'Revenue doors',
  1,
  'atlas:company-kpis:revenue-doors'
)
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-company-kpis-card-self-serve-estimate',
    (SELECT "id" FROM "dashboard" WHERE "number" = 8),
    'atlas-company-kpis-revenue-doors',
    (SELECT "id" FROM "question" WHERE "number" = 1102),
    0, 0, 0, 8, 5, 'NUMBER', '{"compareCurrentPeriod":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-company-kpis-card-self-serve-history',
    (SELECT "id" FROM "dashboard" WHERE "number" = 8),
    'atlas-company-kpis-revenue-doors',
    (SELECT "id" FROM "question" WHERE "number" = 1103),
    1, 0, 5, 24, 9, 'BAR', NULL,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-company-kpis-card-partner-reconciliation',
    (SELECT "id" FROM "dashboard" WHERE "number" = 8),
    'atlas-company-kpis-revenue-doors',
    (SELECT "id" FROM "question" WHERE "number" = 1116),
    2, 0, 14, 24, 10, 'TABLE', NULL,
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
