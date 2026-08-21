INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES (
  'atlas-marketing-version-attribution-lag-v2',
  'atlas-marketing-question-attribution-lag',
  2,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'posthog',
    'query', $hog$with attributed_signups as (
  select
    person_id,
    timestamp as signup_at,
    properties.first_touch_at as first_touch_at
  from events
  where event = 'user_signed_up'
    and timestamp >= now() - interval 90 day
    and properties.first_touch_at is not null
    and {{atlas_product_user_eligible}}
)
select
  multiIf(
    dateDiff('hour', first_touch_at, signup_at) < 1, 'under 1 hour',
    dateDiff('hour', first_touch_at, signup_at) < 24, '1 to 24 hours',
    dateDiff('hour', first_touch_at, signup_at) < 168, '1 to 7 days',
    dateDiff('hour', first_touch_at, signup_at) < 720, '8 to 30 days',
    'over 30 days'
  ) as time_to_signup,
  uniq(person_id) as signups,
  round(avg(dateDiff('minute', first_touch_at, signup_at)) / 60, 1) as average_hours
from attributed_signups
where signup_at >= first_touch_at
group by time_to_signup
order by min(dateDiff('hour', first_touch_at, signup_at))$hog$
  )),
  'bar',
  '{}'::jsonb,
  'atlas',
  CURRENT_TIMESTAMP
);
