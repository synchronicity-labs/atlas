UPDATE "question"
SET
  "name" = 'GEO-attributed product conversion',
  "description" = 'Two mature weekly signup cohorts whose first recorded referring domain matches the approved AI-provider registry. It reports clean-user signups and the subset that completes a successful generation or starts a paid subscription within seven days. Q25 remains the governed GA4 traffic source because GA4 and PostHog do not share a stable person identifier.',
  "connector" = 'ATLAS',
  "sourceId" = 'atlas-marketing-source',
  "sourceExternalId" = 'cron:geo:weekly-conversion',
  "sourceDashboardExternalId" = 'atlas:marketing:geo',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-geo-weekly';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-geo-weekly-v2',
  'atlas-cron-question-geo-weekly',
  2,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'posthog',
    'personPolicy', 'exclude_banned_product_users',
    'query', $hog$with person_events as (
  select
    person_id,
    lower(toString(person.properties.$initial_referring_domain)) as ref_domain,
    minIf(timestamp, event = 'user_signed_up') as signup_at,
    minIf(
      timestamp,
      event in ('generation_completed', 'playground_completed_generation')
    ) as generation_at,
    minIf(timestamp, event = 'subscription_created') as subscription_at
  from events
  where toTimeZone(timestamp, 'UTC') >= toDateTime(
      toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
      'UTC'
    ) - interval 4 week
    and toTimeZone(timestamp, 'UTC') < toDateTime(
      toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
      'UTC'
    )
    and person.properties.$initial_referring_domain is not null
    and {{atlas_product_user_eligible}}
  group by person_id, ref_domain
), classified as (
  select
    person_id,
    signup_at,
    generation_at,
    subscription_at,
    multiIf(
      ref_domain like '%chatgpt.com%' or ref_domain = 'chatgpt', 'ChatGPT',
      ref_domain like '%gemini.google.com%' or ref_domain like '%business.gemini.google%', 'Gemini',
      ref_domain like '%claude.ai%', 'Claude',
      ref_domain like '%perplexity.ai%' or ref_domain = 'perplexity', 'Perplexity',
      ref_domain like '%copilot.microsoft.com%' or ref_domain like '%copilot.com%' or ref_domain like '%ms-sso.copilot.microsoft.com%', 'Copilot',
      ref_domain like '%l.meta.ai%' or ref_domain like '%meta.ai%', 'Meta AI',
      ref_domain like '%kagi.com%', 'Kagi',
      ref_domain like '%chat.qwen.ai%', 'Qwen',
      null
    ) as provider
  from person_events
), cohorts as (
  select
    toMonday(toTimeZone(signup_at, 'UTC')) as cohort_week,
    provider,
    uniqExact(person_id) as signups,
    uniqExactIf(
      person_id,
      generation_at >= signup_at and generation_at < signup_at + interval 7 day
    ) as first_successful_generations,
    uniqExactIf(
      person_id,
      subscription_at >= signup_at and subscription_at < signup_at + interval 7 day
    ) as paid_subscriptions
  from classified
  where provider is not null
    and toTimeZone(signup_at, 'UTC') >= toDateTime(
      toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
      'UTC'
    ) - interval 3 week
    and toTimeZone(signup_at, 'UTC') < toDateTime(
      toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
      'UTC'
    ) - interval 1 week
  group by cohort_week, provider
)
select
  cohort_week,
  provider,
  signups,
  first_successful_generations,
  paid_subscriptions,
  round(first_successful_generations / nullIf(signups, 0) * 100, 2) as signup_to_generation_pct,
  round(paid_subscriptions / nullIf(signups, 0) * 100, 2) as signup_to_paid_pct,
  toMonday(toTimeZone(now(), 'UTC')) - interval 1 week as data_through
from cohorts
order by cohort_week, signups desc, provider
limit 100$hog$
  )),
  'table',
  '{"columns":["cohort_week","provider","signups","first_successful_generations","paid_subscriptions","signup_to_generation_pct","signup_to_paid_pct","data_through"]}'::jsonb,
  NULL,
  'atlas-geo-conversion-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-marketing-card-geo-conversion',
  'atlas-marketing-dashboard',
  'atlas-marketing-tab-search',
  'atlas-cron-question-geo-weekly',
  6,
  0,
  24,
  24,
  9,
  'TABLE',
  '{"compact":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
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
