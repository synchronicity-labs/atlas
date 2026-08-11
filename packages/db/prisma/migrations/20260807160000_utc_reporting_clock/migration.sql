UPDATE "dashboardCard"
SET "displaySettings" = coalesce("displaySettings", '{}'::jsonb) || values.settings::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
FROM (
  VALUES
    ('atlas-product-card-success-today', '{"timeframe":"Today so far · UTC"}'),
    ('atlas-product-card-success-week', '{"timeframe":"Current calendar week · Mon–now · UTC"}'),
    ('atlas-product-card-success-history', '{"timeframe":"10 calendar weeks incl. current partial · weekly · UTC"}'),
    ('atlas-product-card-success-model', '{"timeframe":"Rolling 7 days · 168h · by model · UTC"}'),
    ('atlas-product-card-success-input', '{"timeframe":"Rolling 7 days · 168h · by input type · UTC"}'),
    ('atlas-product-card-failure-hour', '{"timeframe":"Today so far · hourly buckets · UTC"}'),
    ('atlas-product-card-failed-generations', '{"timeframe":"Created in rolling 24 hours · newest first · max 2,000 · UTC","visibleRows":"all"}')
) AS values(id, settings)
WHERE "dashboardCard"."id" = values.id;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
VALUES
  (
    'atlas-product-version-success-today-v4',
    'atlas-product-question-success-today', 4, 'SQL',
    $query$with clock as (
  select statement_timestamp() as end_utc
)
select
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct
from public.generations
cross join clock
where created_at >= (
  date_trunc('day', end_utc at time zone 'UTC') at time zone 'UTC'
)
  and created_at < end_utc$query$,
    'smartscalar', '{}'::jsonb, '696', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-week-v4',
    'atlas-product-question-success-week', 4, 'SQL',
    $query$with clock as (
  select statement_timestamp() as end_utc
)
select
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct
from public.generations
cross join clock
where created_at >= (
  date_trunc('week', end_utc at time zone 'UTC') at time zone 'UTC'
)
  and created_at < end_utc$query$,
    'smartscalar', '{}'::jsonb, '697', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-history-v4',
    'atlas-product-question-success-history', 4, 'SQL',
    $query$with clock as (
  select statement_timestamp() as end_utc
)
select
  date_trunc('week', created_at at time zone 'UTC')::date as week,
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct
from public.generations
cross join clock
where created_at >= (
  (date_trunc('week', end_utc at time zone 'UTC') - interval '9 weeks')
    at time zone 'UTC'
)
  and created_at < end_utc
group by 1
order by 1$query$,
    'line', '{}'::jsonb, '2676', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-model-v3',
    'atlas-product-question-success-model', 3, 'SQL',
    $query$with clock as (
  select statement_timestamp() as end_utc
)
select
  coalesce(model_name, 'unknown') as model,
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct,
  count(*) as generations
from public.generations
cross join clock
where created_at >= end_utc - interval '168 hours'
  and created_at < end_utc
group by 1
order by generations desc$query$,
    'table', '{}'::jsonb, '991', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-input-v3',
    'atlas-product-question-success-input', 3, 'SQL',
    $query$with clock as (
  select statement_timestamp() as end_utc
), typed as (
  select
    status,
    frame_count,
    case
      when inputs @> '[{"type": "image"}]' then 'image'
      when inputs @> '[{"type": "video"}]' then 'video'
      else 'other'
    end as input_type
  from public.generations
  cross join clock
  where created_at >= end_utc - interval '168 hours'
    and created_at < end_utc
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
    'atlas-product-version-failure-hour-v3',
    'atlas-product-question-failure-hour', 3, 'SQL',
    $query$with clock as (
  select statement_timestamp() as end_utc
)
select
  date_trunc('hour', created_at at time zone 'UTC') at time zone 'UTC' as hour,
  round(
    100.0 * count(*) filter (where status = 'FAILED') / nullif(count(*), 0),
    2
  ) as failure_rate_pct
from public.generations
cross join clock
where created_at >= (
  date_trunc('day', end_utc at time zone 'UTC') at time zone 'UTC'
)
  and created_at < end_utc
group by 1
order by 1$query$,
    'line', '{}'::jsonb, '732', 'atlas', CURRENT_TIMESTAMP
  );

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES (
  'atlas-product-version-failed-generations-v4',
  'atlas-product-question-failed-generations', 4, 'SQL',
  $query$with clock as (
  select statement_timestamp() as end_utc
)
select
  created_at,
  finished_at as failed_at,
  id::text as generation_id,
  coalesce(model_name, 'unknown') as model,
  coalesce(source, 'unknown') as source,
  case
    when inputs @> '[{"type": "image"}]' then 'image'
    when inputs @> '[{"type": "video"}]' then 'video'
    else 'other'
  end as input_type,
  coalesce(organization_plan, 'unassigned') as organization_plan,
  attempts_made as attempts,
  round(duration, 2) as duration_seconds,
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
cross join clock
where status = 'FAILED'
  and deleted_at is null
  and created_at >= end_utc - interval '24 hours'
  and created_at < end_utc
order by created_at desc, id desc
limit 2000$query$,
  'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
);
