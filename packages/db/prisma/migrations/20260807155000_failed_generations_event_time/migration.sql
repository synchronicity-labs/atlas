UPDATE "question"
SET "description" = 'Every non-deleted failed generation created in the rolling 24-hour window, newest first, capped at 2,000 rows. Error messages are URL-redacted and truncated; raw inputs, webhook URLs, media URLs, tokens, and payloads are excluded.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 67;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES (
  'atlas-product-version-failed-generations-v3',
  'atlas-product-question-failed-generations', 3, 'SQL',
  $query$select
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
where status = 'FAILED'
  and deleted_at is null
  and created_at >= now() - interval '24 hours'
  and created_at < now()
order by created_at desc, id desc
limit 2000$query$,
  'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
);

UPDATE "dashboardCard"
SET "displaySettings" = coalesce("displaySettings", '{}'::jsonb)
      || '{"timeframe":"Created in last 24 rolling hours · newest first · max 2,000 · UTC","visibleRows":"all"}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-card-failed-generations';
