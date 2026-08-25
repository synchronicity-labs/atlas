INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-lipsync-source',
  'atlas:lipsync',
  'ATLAS',
  'PostHog Lipsync-attributed product events',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "question"
SET
  "name" = 'Lipsync-attributed product conversion',
  "description" = 'Mature weekly signup cohorts whose first recorded referring domain is lipsync.com. It reports clean-user signups and the subset that starts a project, completes a generation, or starts a paid subscription within seven days. GA4 traffic and Search Console demand remain separate governed questions because they do not share a stable person identifier with PostHog.',
  "connector" = 'ATLAS',
  "sourceId" = (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:lipsync'),
  "sourceExternalId" = 'cron:lipsync:product-funnel',
  "sourceDashboardExternalId" = 'atlas:lipsync:product-funnel',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-lipsync-funnel';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-lipsync-funnel-v2',
  'atlas-cron-question-lipsync-funnel',
  2,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'posthog',
    'personPolicy', 'exclude_banned_product_users',
    'query', $hog$with person_events as (
  select
    person_id,
    minIf(timestamp, event = 'user_signed_up') as signup_at,
    minIf(timestamp, event = 'project_created') as project_at,
    minIf(
      timestamp,
      event in ('generation_completed', 'playground_completed_generation')
    ) as generation_at,
    minIf(timestamp, event = 'subscription_created') as subscription_at
  from events
  where toTimeZone(timestamp, 'UTC') >= toDateTime(
      toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
      'UTC'
    ) - interval 12 week
    and toTimeZone(timestamp, 'UTC') < toDateTime(
      toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
      'UTC'
    )
    and person.properties.$initial_referring_domain in ('lipsync.com', 'www.lipsync.com')
    and {{atlas_product_user_eligible}}
  group by person_id
), mature_cohorts as (
  select
    toMonday(toTimeZone(signup_at, 'UTC')) as cohort_week,
    uniqExact(person_id) as signups,
    uniqExactIf(
      person_id,
      project_at >= signup_at and project_at < signup_at + interval 7 day
    ) as projects_started,
    uniqExactIf(
      person_id,
      project_at >= signup_at
        and project_at < signup_at + interval 7 day
        and generation_at >= project_at
        and generation_at < signup_at + interval 7 day
    ) as successful_generations,
    uniqExactIf(
      person_id,
      subscription_at >= signup_at
        and subscription_at < signup_at + interval 7 day
    ) as paid_subscriptions
  from person_events
  where toTimeZone(signup_at, 'UTC') >= toDateTime(
      toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
      'UTC'
    ) - interval 12 week
    and toTimeZone(signup_at, 'UTC') < toDateTime(
      toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
      'UTC'
    ) - interval 1 week
  group by cohort_week
)
select
  cohort_week,
  signups,
  projects_started,
  successful_generations,
  paid_subscriptions,
  round(projects_started / nullIf(signups, 0) * 100, 2) as signup_to_project_pct,
  round(successful_generations / nullIf(signups, 0) * 100, 2) as signup_to_generation_pct,
  round(paid_subscriptions / nullIf(signups, 0) * 100, 2) as signup_to_paid_pct,
  toMonday(toTimeZone(now(), 'UTC')) - interval 1 week as data_through
from mature_cohorts
order by cohort_week
limit 100$hog$
  )),
  'table',
  '{"columns":["cohort_week","signups","projects_started","successful_generations","paid_subscriptions","signup_to_project_pct","signup_to_generation_pct","signup_to_paid_pct","data_through"]}'::jsonb,
  NULL,
  'atlas-lipsync-funnel-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-lipsync-dashboard',
  10,
  'Lipsync acquisition and conversion',
  'Governed lipsync.com search, traffic, and product conversion metrics.',
  1,
  'atlas',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-lipsync-tab-funnel',
  (SELECT "id" FROM "dashboard" WHERE "number" = 10),
  1,
  'Product funnel',
  0,
  'atlas:lipsync:product-funnel'
)
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-lipsync-card-funnel',
  (SELECT "id" FROM "dashboard" WHERE "number" = 10),
  (
    SELECT "id"
    FROM "dashboardTab"
    WHERE "dashboardId" = (SELECT "id" FROM "dashboard" WHERE "number" = 10)
      AND "number" = 1
  ),
  'atlas-cron-question-lipsync-funnel',
  0,
  0,
  0,
  24,
  12,
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
