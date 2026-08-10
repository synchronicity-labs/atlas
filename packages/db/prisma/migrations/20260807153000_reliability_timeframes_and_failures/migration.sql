UPDATE "dashboardCard"
SET "displaySettings" = coalesce("displaySettings", '{}'::jsonb) || values.settings::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
FROM (
  VALUES
    ('atlas-product-card-success-today', '{"timeframe":"Today · UTC"}'),
    ('atlas-product-card-success-week', '{"timeframe":"Current calendar week · UTC"}'),
    ('atlas-product-card-success-history', '{"timeframe":"Last 10 calendar weeks · weekly · UTC"}'),
    ('atlas-product-card-success-model', '{"timeframe":"Last 7 rolling days · by model"}'),
    ('atlas-product-card-success-input', '{"timeframe":"Last 7 rolling days · by input type"}'),
    ('atlas-product-card-failure-hour', '{"timeframe":"Today · hourly · UTC"}')
) AS values(id, settings)
WHERE "dashboardCard"."id" = values.id;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
VALUES
  (
    'atlas-product-version-success-today-v3',
    'atlas-product-question-success-today', 3, 'SQL',
    $query$select
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct
from public.generations
where created_at >= (
  date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
)
  and created_at < now()$query$,
    'smartscalar', '{}'::jsonb, '696', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-week-v3',
    'atlas-product-question-success-week', 3, 'SQL',
    $query$select
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct
from public.generations
where created_at >= (
  date_trunc('week', now() at time zone 'UTC') at time zone 'UTC'
)
  and created_at < now()$query$,
    'smartscalar', '{}'::jsonb, '697', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-history-v3',
    'atlas-product-question-success-history', 3, 'SQL',
    $query$select
  date_trunc('week', created_at at time zone 'UTC')::date as week,
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct
from public.generations
where created_at >= (
  (date_trunc('week', now() at time zone 'UTC') - interval '9 weeks')
    at time zone 'UTC'
)
  and created_at < now()
group by 1
order by 1$query$,
    'line', '{}'::jsonb, '2676', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-model-v2',
    'atlas-product-question-success-model', 2, 'SQL',
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
  and created_at < now()
group by 1
order by generations desc$query$,
    'table', '{}'::jsonb, '991', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-input-v2',
    'atlas-product-question-success-input', 2, 'SQL',
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
    and created_at < now()
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
    'atlas-product-version-failure-hour-v2',
    'atlas-product-question-failure-hour', 2, 'SQL',
    $query$select
  date_trunc('hour', created_at at time zone 'UTC') at time zone 'UTC' as hour,
  round(
    100.0 * count(*) filter (where status = 'FAILED') / nullif(count(*), 0),
    2
  ) as failure_rate_pct
from public.generations
where created_at >= (
  date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
)
  and created_at < now()
group by 1
order by 1$query$,
    'line', '{}'::jsonb, '732', 'atlas', CURRENT_TIMESTAMP
  );

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "createdAt", "updatedAt"
)
SELECT
  'atlas-product-question-failed-generations', 67,
  'Failed generations',
  'Every failed generation from the rolling 24-hour window, newest first. Error messages are URL-redacted and truncated; inputs, webhook URLs, media URLs, tokens, and raw payloads are excluded.',
  'METABASE', source."id", 'atlas:failed-generations:24h',
  'platform-reliability', '34', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "dataSource" source
WHERE source."key" = 'metabase:sync';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES (
  'atlas-product-version-failed-generations-v1',
  'atlas-product-question-failed-generations', 1, 'SQL',
  $query$select
  created_at,
  id::text as generation_id,
  coalesce(model_name, 'unknown') as model,
  coalesce(source, 'unknown') as source,
  coalesce(organization_plan, 'unassigned') as organization_plan,
  coalesce(attempts_made, 0) as attempts,
  coalesce(frame_count, 0) as frames,
  round(coalesce(duration, 0), 2) as duration_seconds,
  coalesce(chunker_queued_time_ms, 0)
    + coalesce(inference_queued_time_ms, 0)
    + coalesce(stitcher_queued_time_ms, 0) as queue_time_ms,
  coalesce(chunker_processing_time_ms, 0)
    + coalesce(inference_processing_time_ms, 0)
    + coalesce(stitcher_processing_time_ms, 0) as processing_time_ms,
  coalesce(potential_error->>'errorCode', 'unknown') as error_code,
  left(
    regexp_replace(
      coalesce(potential_error->>'message', ''),
      'https?://[^[:space:]]+',
      '[url]',
      'gi'
    ),
    300
  ) as error_message
from public.generations
where status = 'FAILED'
  and created_at >= now() - interval '24 hours'
order by created_at desc
limit 2000$query$,
  'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
);

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
)
SELECT
  'atlas-product-card-failed-generations', dashboard."id", tab."id", question."id",
  6, 0, 25, 24, 12, 'TABLE'::"VisualizationType",
  '{"timeframe":"Last 24 rolling hours · newest first · UTC","visibleRows":"all"}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "dashboard" dashboard
JOIN "dashboardTab" tab
  ON tab."dashboardId" = dashboard."id" AND tab."number" = 6
JOIN "question" question ON question."number" = 67
WHERE dashboard."number" = 1;

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1;
