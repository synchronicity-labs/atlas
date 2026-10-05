BEGIN;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
)
SELECT
  'atlas-marketing-version-conversion-v8',
  q."id",
  8,
  'API',
  jsonb_pretty(jsonb_build_object('source', 'posthog', 'personPolicy', 'exclude_banned_product_users', 'query', $hog$
with first_visits as (
  select
    person_id,
    min(toTimeZone(timestamp, 'UTC')) as first_visit_at
  from events
  where event = '$pageview'
    and (
      domain(toString(properties.$current_url)) in ('blog.sync.so', 'docs.sync.so')
      or (
        domain(toString(properties.$current_url)) in ('sync.so', 'www.sync.so')
        and (
        toString(properties.$pathname) in ('/', '/pricing', '/try', '/try/', '/sync-3', '/enterprise', '/lipsync-2-pro', '/dialogue-editing', '/plugins', '/studios', '/careers', '/privacy', '/vision', '/download', '/about', '/react-1', '/terms', '/creators')
        or startsWith(toString(properties.$pathname), '/product/')
        or startsWith(toString(properties.$pathname), '/use-cases/')
        or startsWith(toString(properties.$pathname), '/models/')
        or startsWith(toString(properties.$pathname), '/plugins/')
        or startsWith(toString(properties.$pathname), '/download/')
      )
      )
    )
    and {{atlas_product_user_eligible}}
  group by person_id
), signups as (
  select
    person_id,
    min(toTimeZone(timestamp, 'UTC')) as signup_at
  from events
  where event = 'user_signed_up'
    and {{atlas_product_user_eligible}}
  group by person_id
)
select
  toStartOfMonth(first_visit_at) as visit_month,
  uniq(first_visits.person_id) as visitors,
  uniqIf(first_visits.person_id, signup_at >= first_visit_at and signup_at < first_visit_at + interval 7 day) as signups_within_7_days,
  round(signups_within_7_days / nullIf(visitors, 0) * 100, 2) as conversion_rate_pct
from first_visits
left join signups on signups.person_id = first_visits.person_id
where first_visit_at >= toStartOfMonth(toTimeZone(now(), 'UTC')) - interval 6 month
  and first_visit_at < toTimeZone(now(), 'UTC') - interval 7 day
group by visit_month
order by visit_month$hog$)),
  'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
FROM "question" q
WHERE q."number" = 2006
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
)
SELECT
  'atlas-marketing-version-conversion-rate-v7',
  q."id",
  7,
  'API',
  jsonb_pretty(jsonb_build_object('source', 'posthog', 'personPolicy', 'exclude_banned_product_users', 'query', $hog$
with first_visits as (
  select
    person_id,
    min(toTimeZone(timestamp, 'UTC')) as first_visit_at
  from events
  where event = '$pageview'
    and (
      domain(toString(properties.$current_url)) in ('blog.sync.so', 'docs.sync.so')
      or (
        domain(toString(properties.$current_url)) in ('sync.so', 'www.sync.so')
        and (
        toString(properties.$pathname) in ('/', '/pricing', '/try', '/try/', '/sync-3', '/enterprise', '/lipsync-2-pro', '/dialogue-editing', '/plugins', '/studios', '/careers', '/privacy', '/vision', '/download', '/about', '/react-1', '/terms', '/creators')
        or startsWith(toString(properties.$pathname), '/product/')
        or startsWith(toString(properties.$pathname), '/use-cases/')
        or startsWith(toString(properties.$pathname), '/models/')
        or startsWith(toString(properties.$pathname), '/plugins/')
        or startsWith(toString(properties.$pathname), '/download/')
      )
      )
    )
    and {{atlas_product_user_eligible}}
  group by person_id
), signups as (
  select
    person_id,
    min(toTimeZone(timestamp, 'UTC')) as signup_at
  from events
  where event = 'user_signed_up'
    and {{atlas_product_user_eligible}}
  group by person_id
)
select
  toStartOfMonth(first_visit_at) as visit_month,
  round(uniqIf(first_visits.person_id, signup_at >= first_visit_at and signup_at < first_visit_at + interval 7 day) / nullIf(uniq(first_visits.person_id), 0) * 100, 2) as conversion_rate_pct
from first_visits
left join signups on signups.person_id = first_visits.person_id
where first_visit_at >= toStartOfMonth(toTimeZone(now(), 'UTC')) - interval 6 month
  and first_visit_at < toTimeZone(now(), 'UTC') - interval 7 day
group by visit_month
order by visit_month$hog$)),
  'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
FROM "question" q
WHERE q."number" = 2019
ON CONFLICT ("questionId", "version") DO NOTHING;

COMMIT;
