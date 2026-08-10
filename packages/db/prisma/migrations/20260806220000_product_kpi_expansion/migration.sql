INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
)
SELECT
  'atlas-product-tab-billing', "id", 5, 'Billing v2 vs v3', 4, 'metabase:collection:billing-v2-vs-v3'
FROM "dashboard"
WHERE "number" = 1;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
)
SELECT
  'atlas-product-tab-reliability', "id", 6, 'Reliability', 5, 'metabase:collection:platform'
FROM "dashboard"
WHERE "number" = 1;

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "createdAt", "updatedAt"
)
SELECT
  values."id", values."number", values."name", values."description",
  'METABASE', source."id", values."sourceExternalId",
  values."sourceDashboardExternalId", values."databaseExternalId",
  'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  VALUES
    ('atlas-product-question-billing-org-mix', 46, 'Organizations by billing version', 'Current organization population split by billing_version. This is a point-in-time population view, not a signup cohort or conversion rate.', '8053', 'billing-v2-vs-v3', '34'),
    ('atlas-product-question-v3-plan-mix', 47, 'V3 organizations by plan', 'Current plan mix for billing v3 organizations. A null plan is labeled free.', '8054', 'billing-v2-vs-v3', '34'),
    ('atlas-product-question-billing-paid-rate', 48, 'Paid organization rate by billing version', 'Paid organizations divided by all organizations in each billing version. Paid means a recognized named plan. V3 accounts are still an early assigned population, so this is not a causal v2/v3 experiment read.', '8055', 'billing-v2-vs-v3', '34'),
    ('atlas-product-question-billing-subscription-revenue', 49, 'Subscription revenue by billing version', 'Monthly paid invoice revenue split by inferred billing version. V3 means plan starter, pro, or team. Top-up cash is excluded and shown separately.', '8056', 'billing-v2-vs-v3', '166'),
    ('atlas-product-question-v3-topups', 50, 'V3 top-up cash', 'Successful billing v3 credit purchases grouped by month. This is top-up cash, not usage accrual or subscription revenue.', '8057', 'billing-v2-vs-v3', '166'),
    ('atlas-product-question-billing-frames', 51, 'Lipsync frames by billing version', 'Monthly lip-sync frames split by tier-derived billing version. V3 is starter, pro, or team; every other tier is grouped as v2.', '8058', 'billing-v2-vs-v3', '166'),
    ('atlas-product-question-billing-dubbing', 52, 'Dubbing cost by billing version', 'Monthly ElevenLabs dubbing usage cost split by organization plan-derived billing version.', '8059', 'billing-v2-vs-v3', '166'),
    ('atlas-product-question-billing-tts', 53, 'TTS cost by billing version', 'Monthly ElevenLabs text-to-speech usage cost split by organization plan-derived billing version.', '8060', 'billing-v2-vs-v3', '166'),
    ('atlas-product-question-success-today', 54, 'Generation success rate today', 'Non-failed generations divided by all generations since the current UTC day began. Null status is treated as non-failed to preserve the source question definition.', '696', 'platform-reliability', '34'),
    ('atlas-product-question-success-week', 55, 'Generation success rate this week', 'Non-failed generations divided by all generations since the current UTC week began. Null status is treated as non-failed to preserve the source question definition.', '697', 'platform-reliability', '34'),
    ('atlas-product-question-success-history', 56, 'Weekly generation success rate', 'Non-failed generations divided by all generations for each of the latest ten UTC calendar weeks, including the current partial week.', '2676', 'platform-reliability', '34'),
    ('atlas-product-question-success-model', 57, 'Generation success by model', 'Seven-day generation success rate and volume by model. Read rate with volume so a low-volume model does not dominate prioritization.', '991', 'platform-reliability', '34'),
    ('atlas-product-question-success-input', 58, 'Generation success by input type', 'Seven-day generation success rate, generation count, and frame count split between video and image inputs.', '7921', 'platform-reliability', '34'),
    ('atlas-product-question-failure-hour', 59, 'Failure rate by hour today', 'Failed generations divided by all generations for each UTC hour in the current day.', '732', 'platform-reliability', '34')
) AS values(
  "id", "number", "name", "description", "sourceExternalId",
  "sourceDashboardExternalId", "databaseExternalId"
)
CROSS JOIN "dataSource" AS source
WHERE source."key" = 'metabase:sync';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
VALUES
  (
    'atlas-product-version-billing-org-mix-v1', 'atlas-product-question-billing-org-mix', 1, 'SQL',
    $query$select
  coalesce(billing_version, 'unassigned') as billing_version,
  count(*) as organizations
from public.organizations
group by 1
order by organizations desc$query$,
    'bar', '{}'::jsonb, '8053', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-v3-plan-mix-v1', 'atlas-product-question-v3-plan-mix', 1, 'SQL',
    $query$select
  coalesce(plan, 'free') as plan,
  count(*) as organizations
from public.organizations
where billing_version = 'v3'
group by 1
order by organizations desc$query$,
    'pie', '{}'::jsonb, '8054', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-billing-paid-rate-v1', 'atlas-product-question-billing-paid-rate', 1, 'SQL',
    $query$select
  coalesce(billing_version, 'unassigned') as billing_version,
  count(*) as organizations,
  count(*) filter (
    where plan in (
      'creator', 'hobbyist', 'growth', 'scale', 'program', 'enterprise',
      'partner', 'starter', 'pro', 'team'
    )
  ) as paid_organizations,
  round(
    100.0 * count(*) filter (
      where plan in (
        'creator', 'hobbyist', 'growth', 'scale', 'program', 'enterprise',
        'partner', 'starter', 'pro', 'team'
      )
    ) / nullif(count(*), 0),
    2
  ) as paid_rate_pct
from public.organizations
group by 1
order by organizations desc$query$,
    'table', '{}'::jsonb, '8055', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-billing-subscription-revenue-v1', 'atlas-product-question-billing-subscription-revenue', 1, 'SQL',
    $query$select
  toStartOfMonth("createdAt") as month,
  if(plan in ('starter', 'pro', 'team'), 'v3', 'v2') as billing_version,
  sum("amountPaid") / 100.0 as subscription_revenue_usd
from sync_prod.sync_stripe_invoices_paid
where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
  and "createdAt" < now()
group by month, billing_version
order by month, billing_version$query$,
    'line', '{}'::jsonb, '8056', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-v3-topups-v1', 'atlas-product-question-v3-topups', 1, 'SQL',
    $query$select
  toStartOfMonth("createdAt") as month,
  sum(amount) / 100.0 as top_up_cash_usd
from sync_prod.sync_stripe_payments
where "billingVersion" = 'v3'
  and status = 'succeeded'
  and "createdAt" >= addMonths(toStartOfMonth(today()), -6)
  and "createdAt" < now()
group by month
order by month$query$,
    'bar', '{}'::jsonb, '8057', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-billing-frames-v1', 'atlas-product-question-billing-frames', 1, 'SQL',
    $query$select
  toStartOfMonth(month_date) as month,
  if(tier in ('starter', 'pro', 'team'), 'v3', 'v2') as billing_version,
  sum(total_frames) as frames
from sync_prod.usage_data_by_model_by_tier_by_month
where month_date >= addMonths(toStartOfMonth(today()), -6)
group by month, billing_version
order by month, billing_version$query$,
    'line', '{}'::jsonb, '8058', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-billing-dubbing-v1', 'atlas-product-question-billing-dubbing', 1, 'SQL',
    $query$select
  toStartOfMonth("createdAt") as month,
  if("organizationPlanType" in ('starter', 'pro', 'team'), 'v3', 'v2') as billing_version,
  sum("usageCostMillicents") / 100000.0 as dubbing_cost_usd
from sync_prod.sync_usage_integration_dubbing
where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
  and "createdAt" < now()
group by month, billing_version
order by month, billing_version$query$,
    'bar', '{}'::jsonb, '8059', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-billing-tts-v1', 'atlas-product-question-billing-tts', 1, 'SQL',
    $query$select
  toStartOfMonth("createdAt") as month,
  if("organizationPlanType" in ('starter', 'pro', 'team'), 'v3', 'v2') as billing_version,
  sum("usageCostMillicents") / 100000.0 as tts_cost_usd
from sync_prod.sync_usage_integration_tts
where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
  and "createdAt" < now()
group by month, billing_version
order by month, billing_version$query$,
    'line', '{}'::jsonb, '8060', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-today-v1', 'atlas-product-question-success-today', 1, 'SQL',
    $query$select
  date_trunc('day', now())::date as day,
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct
from public.generations
where created_at >= date_trunc('day', now())$query$,
    'smartscalar', '{}'::jsonb, '696', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-week-v1', 'atlas-product-question-success-week', 1, 'SQL',
    $query$select
  date_trunc('week', now())::date as week,
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct
from public.generations
where created_at >= date_trunc('week', now())$query$,
    'smartscalar', '{}'::jsonb, '697', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-history-v1', 'atlas-product-question-success-history', 1, 'SQL',
    $query$select
  date_trunc('week', created_at)::date as week,
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct,
  count(*) as generations
from public.generations
where created_at >= date_trunc('week', now()) - interval '9 weeks'
group by 1
order by 1$query$,
    'line', '{}'::jsonb, '2676', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-model-v1', 'atlas-product-question-success-model', 1, 'SQL',
    $query$select
  coalesce(model_name, 'unknown') as model,
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct,
  count(*) as generations
from public.generations
where created_at >= now() - interval '7 days'
group by 1
order by generations desc$query$,
    'table', '{}'::jsonb, '991', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-input-v1', 'atlas-product-question-success-input', 1, 'SQL',
    $query$with typed as (
  select
    status,
    frame_count,
    case
      when inputs @> '[{"type": "image"}]' then 'image'
      when inputs @> '[{"type": "video"}]' then 'video'
      else 'other'
    end as input_type
  from public.generations
  where created_at >= now() - interval '7 days'
)
select
  input_type,
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct,
  count(*) as generations,
  sum(frame_count) as frames
from typed
group by input_type
order by generations desc$query$,
    'table', '{}'::jsonb, '7921', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-failure-hour-v1', 'atlas-product-question-failure-hour', 1, 'SQL',
    $query$select
  date_trunc('hour', created_at) as hour,
  round(
    100.0 * count(*) filter (where status = 'FAILED') / nullif(count(*), 0),
    2
  ) as failure_rate_pct
from public.generations
where created_at >= date_trunc('day', now())
group by 1
order by 1$query$,
    'line', '{}'::jsonb, '732', 'atlas', CURRENT_TIMESTAMP
  );

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
)
SELECT
  values."id", dashboard."id", tab."id", question."id", values."position",
  values."x", values."y", values."width", values."height",
  values."visualization"::"VisualizationType", values."displaySettings"::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  VALUES
    ('atlas-product-card-billing-org-mix', 5, 46, 0, 0, 0, 8, 6, 'BAR', '{}'),
    ('atlas-product-card-v3-plan-mix', 5, 47, 1, 8, 0, 8, 6, 'PIE', '{}'),
    ('atlas-product-card-billing-paid-rate', 5, 48, 2, 16, 0, 8, 6, 'TABLE', '{}'),
    ('atlas-product-card-billing-subscription-revenue', 5, 49, 3, 0, 6, 12, 8, 'LINE', '{}'),
    ('atlas-product-card-v3-topups', 5, 50, 4, 12, 6, 12, 8, 'BAR', '{}'),
    ('atlas-product-card-billing-frames', 5, 51, 5, 0, 14, 24, 8, 'LINE', '{}'),
    ('atlas-product-card-billing-dubbing', 5, 52, 6, 0, 22, 12, 8, 'BAR', '{}'),
    ('atlas-product-card-billing-tts', 5, 53, 7, 12, 22, 12, 8, 'LINE', '{}'),
    ('atlas-product-card-success-today', 6, 54, 0, 0, 0, 6, 5, 'NUMBER', '{}'),
    ('atlas-product-card-success-week', 6, 55, 1, 6, 0, 6, 5, 'NUMBER', '{}'),
    ('atlas-product-card-success-history', 6, 56, 2, 12, 0, 12, 8, 'LINE', '{}'),
    ('atlas-product-card-success-model', 6, 57, 3, 0, 8, 12, 9, 'TABLE', '{}'),
    ('atlas-product-card-success-input', 6, 58, 4, 12, 8, 12, 9, 'TABLE', '{}'),
    ('atlas-product-card-failure-hour', 6, 59, 5, 0, 17, 24, 8, 'LINE', '{}')
) AS values(
  "id", "tabNumber", "questionNumber", "position", "x", "y", "width",
  "height", "visualization", "displaySettings"
)
CROSS JOIN "dashboard" AS dashboard
JOIN "dashboardTab" AS tab
  ON tab."dashboardId" = dashboard."id" AND tab."number" = values."tabNumber"
JOIN "question" AS question
  ON question."number" = values."questionNumber"
WHERE dashboard."number" = 1;

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1;
