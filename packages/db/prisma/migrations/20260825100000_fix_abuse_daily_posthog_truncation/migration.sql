INSERT INTO "questionVersion" (
  id,
  "questionId",
  version,
  "queryLanguage",
  "queryText",
  display,
  visualization,
  "createdBy",
  "createdAt"
)
SELECT
  'atlas-abuse-version-blocked-history-limit-v1',
  q.id,
  COALESCE(MAX(v.version), 0) + 1,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'posthog',
    'personPolicy', 'all_events',
    'query', $hog$select
  day,
  blocked_attempts,
  successful_signups,
  round(blocked_attempts / nullIf(blocked_attempts + successful_signups, 0) * 100, 2) as block_rate_pct
from (
  select
    toStartOfDay(toTimeZone(timestamp, 'UTC')) as day,
    countIf(event = 'signup_blocked') as blocked_attempts,
    countIf(event = 'user_signed_up') as successful_signups
  from events
  where event in ('signup_blocked', 'user_signed_up')
    and timestamp >= toStartOfDay(toTimeZone(now(), 'UTC')) - interval 4320 hour
  group by day
)
order by day
limit 1000$hog$
  )),
  'LINE',
  '{}'::jsonb,
  'atlas',
  CURRENT_TIMESTAMP
FROM "question" q
LEFT JOIN "questionVersion" v ON v."questionId" = q.id
WHERE q."sourceExternalId" = 'abuse:signup-blocked:daily'
GROUP BY q.id
ON CONFLICT (id) DO NOTHING;

UPDATE "question"
SET "updatedAt" = CURRENT_TIMESTAMP
WHERE "sourceExternalId" = 'abuse:signup-blocked:daily';
