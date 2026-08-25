UPDATE "question"
SET
  "name" = 'Exit survey cancellation-request coverage',
  "description" = 'Completed UTC-week cancellation requests from server-emitted subscription_cancel_pending events. The response numerator is the subset whose server-side cancellation event includes survey_completed=true after joining the latest organization exit-survey row. Structured reason and plan distributions are published. Survey dismissals remain a separate count. Raw comments, competitor names, and customer identifiers are excluded.',
  "connector" = 'ATLAS',
  "sourceId" = (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:marketing'),
  "sourceDashboardExternalId" = 'atlas:customer-lifecycle:exit-survey',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-exit-survey';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-exit-survey-v2',
  'atlas-cron-question-exit-survey',
  2,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'posthog',
    'personPolicy', 'exclude_banned_product_users',
    'query', $hog$with cancellation_events as (
  select
    toStartOfWeek(toTimeZone(timestamp, 'UTC')) as week_start,
    uuid,
    properties.survey_completed = true as response_completed,
    coalesce(nullIf(toString(properties.survey_reason), ''), 'unknown') as reason,
    coalesce(nullIf(toString(properties.plan), ''), 'unknown') as plan
  from events
  where event = 'subscription_cancel_pending'
    and timestamp >= toStartOfWeek(toTimeZone(now(), 'UTC')) - interval 12 week
    and timestamp < toStartOfWeek(toTimeZone(now(), 'UTC'))
    and {{atlas_product_user_eligible}}
), weekly_totals as (
  select
    week_start,
    count() as source_event_rows,
    uniqExact(uuid) as cancellation_requests,
    uniqExactIf(uuid, response_completed) as responses,
    round(
      uniqExactIf(uuid, response_completed)
        / nullIf(uniqExact(uuid), 0) * 100,
      2
    ) as response_rate_pct
  from cancellation_events
  group by week_start
), response_groups as (
  select
    week_start,
    reason,
    plan,
    uniqExact(uuid) as response_group_count
  from cancellation_events
  where response_completed
  group by week_start, reason, plan
), reason_totals as (
  select week_start, reason, uniqExact(uuid) as reason_count
  from cancellation_events
  where response_completed
  group by week_start, reason
), plan_totals as (
  select week_start, plan, uniqExact(uuid) as plan_count
  from cancellation_events
  where response_completed
  group by week_start, plan
), weekly_dismissals as (
  select
    toStartOfWeek(toTimeZone(timestamp, 'UTC')) as week_start,
    uniqExact(uuid) as dismissed_feedback_forms
  from events
  where event = 'exit_survey_dismissed'
    and timestamp >= toStartOfWeek(toTimeZone(now(), 'UTC')) - interval 12 week
    and timestamp < toStartOfWeek(toTimeZone(now(), 'UTC'))
    and {{atlas_product_user_eligible}}
  group by week_start
)
select
  totals.week_start,
  totals.cancellation_requests,
  totals.responses,
  totals.response_rate_pct,
  coalesce(groups.reason, 'no_response') as reason,
  coalesce(reasons.reason_count, 0) as reason_count,
  coalesce(groups.plan, 'no_response') as plan,
  coalesce(plans.plan_count, 0) as plan_count,
  coalesce(groups.response_group_count, 0) as response_group_count,
  coalesce(dismissals.dismissed_feedback_forms, 0) as dismissed_feedback_forms,
  replaceAll(coalesce(groups.reason, 'no_response'), '_', ' ') as structured_theme,
  totals.source_event_rows,
  toStartOfWeek(toTimeZone(now(), 'UTC')) as data_through
from weekly_totals as totals
left join response_groups as groups on groups.week_start = totals.week_start
left join reason_totals as reasons
  on reasons.week_start = groups.week_start and reasons.reason = groups.reason
left join plan_totals as plans
  on plans.week_start = groups.week_start and plans.plan = groups.plan
left join weekly_dismissals as dismissals
  on dismissals.week_start = groups.week_start
order by totals.week_start desc, reason_count desc, plan_count desc
limit 1000$hog$
  )),
  'table',
  '{"columns":["week_start","cancellation_requests","responses","response_rate_pct","reason","reason_count","plan","plan_count","dismissed_feedback_forms","data_through"]}'::jsonb,
  NULL,
  'atlas-exit-survey-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-customer-lifecycle-dashboard',
  9,
  'Customer lifecycle & retention',
  'Governed customer lifecycle, cancellation, retention, and exit-survey metrics used by Rudy reports.',
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
  'atlas-customer-lifecycle-tab-exit-survey',
  (SELECT "id" FROM "dashboard" WHERE "number" = 9),
  1,
  'Exit survey',
  0,
  'atlas:customer-lifecycle:exit-survey'
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
  'atlas-customer-lifecycle-card-exit-survey',
  (SELECT "id" FROM "dashboard" WHERE "number" = 9),
  (
    SELECT "id"
    FROM "dashboardTab"
    WHERE "dashboardId" = (SELECT "id" FROM "dashboard" WHERE "number" = 9)
      AND "number" = 1
  ),
  'atlas-cron-question-exit-survey',
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
