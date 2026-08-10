UPDATE "question"
SET "description" = CASE "number"
      WHEN 2004 THEN 'PostHog user_signed_up events deduplicated by person after excluding product users marked banned in Atlas.'
      WHEN 2006 THEN 'Monthly PostHog visitors and signups after excluding product users marked banned in Atlas.'
      WHEN 2014 THEN 'Signup first-touch channels for eligible product users; Atlas-banned users are excluded.'
      WHEN 2015 THEN 'Earliest observed page URL for eligible people with a signup event in the last 90 days.'
      WHEN 2016 THEN 'Eligible people with both a signup and later successful subscription payment event during the last 180 days.'
      WHEN 2017 THEN 'PostHog page views and visitors referred by supported AI assistants, excluding Atlas-banned product users.'
      WHEN 2018 THEN 'Observed hostnames touched in the 30 days before an eligible PostHog signup event.'
      WHEN 2019 THEN 'Monthly eligible PostHog signups divided by eligible deduplicated page-view people.'
      ELSE "description"
    END,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" IN (2004, 2006, 2014, 2015, 2016, 2017, 2018, 2019);

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  ('atlas-marketing-version-signups-v2', 'atlas-marketing-question-signups', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select
  toStartOfMonth(timestamp) as month,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= toStartOfMonth(now()) - interval 6 month
  and {{atlas_product_user_eligible}}
group by month
order by month$hog$)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-conversion-v3', 'atlas-marketing-question-conversion', 3, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select
  toStartOfMonth(timestamp) as month,
  uniqIf(person_id, event = '$pageview') as visitors,
  uniqIf(person_id, event = 'user_signed_up') as signups
from events
where timestamp >= toStartOfMonth(now()) - interval 6 month
  and event in ('$pageview', 'user_signed_up')
  and {{atlas_product_user_eligible}}
group by month
order by month$hog$)), 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-conversion-rate-v2', 'atlas-marketing-question-conversion-rate', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select
  month,
  round(signups / nullIf(visitors, 0) * 100, 2) as conversion_rate
from (
  select
    toStartOfMonth(timestamp) as month,
    uniqIf(person_id, event = '$pageview') as visitors,
    uniqIf(person_id, event = 'user_signed_up') as signups
  from events
  where timestamp >= toStartOfMonth(now()) - interval 6 month
    and event in ('$pageview', 'user_signed_up')
    and {{atlas_product_user_eligible}}
  group by month
)
order by month$hog$)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-first-touch-v3', 'atlas-marketing-question-first-touch', 3, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$with first_touch as (
  select
    person_id,
    argMin(coalesce(nullIf(toString(properties.$utm_source), ''), nullIf(toString(properties.$referring_domain), ''), 'Direct'), timestamp) as raw_channel
  from events
  where event = '$pageview'
    and timestamp >= now() - interval 180 day
    and {{atlas_product_user_eligible}}
  group by person_id
), signups as (
  select person_id, min(timestamp) as signup_at
  from events
  where event = 'user_signed_up'
    and timestamp >= now() - interval 90 day
    and {{atlas_product_user_eligible}}
  group by person_id
)
select if(first_touch.raw_channel = '$direct', 'Direct', first_touch.raw_channel) as channel, count() as signups
from signups
inner join first_touch on first_touch.person_id = signups.person_id
group by channel
order by signups desc
limit 20$hog$)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-entry-pages-v2', 'atlas-marketing-question-entry-pages', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$with first_touch as (
  select person_id, argMin(toString(properties.$current_url), timestamp) as landing_url
  from events
  where event = '$pageview'
    and timestamp >= now() - interval 180 day
    and {{atlas_product_user_eligible}}
  group by person_id
), signups as (
  select person_id
  from events
  where event = 'user_signed_up'
    and timestamp >= now() - interval 90 day
    and {{atlas_product_user_eligible}}
  group by person_id
)
select first_touch.landing_url as landing_url, count() as signed_up_people
from signups
inner join first_touch on first_touch.person_id = signups.person_id
where landing_url != ''
group by landing_url
order by signed_up_people desc
limit 20$hog$)), 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-time-to-paid-v2', 'atlas-marketing-question-time-to-paid', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$with signups as (
  select person_id, min(timestamp) as signup_at
  from events
  where event = 'user_signed_up'
    and timestamp >= now() - interval 180 day
    and {{atlas_product_user_eligible}}
  group by person_id
), paid as (
  select person_id, min(timestamp) as paid_at
  from events
  where event = 'subscription_payment_succeeded'
    and timestamp >= now() - interval 180 day
    and {{atlas_product_user_eligible}}
  group by person_id
)
select
  multiIf(
    dateDiff('hour', signup_at, paid_at) < 24, '< 1 day',
    dateDiff('hour', signup_at, paid_at) < 168, '1-7 days',
    dateDiff('hour', signup_at, paid_at) < 720, '8-30 days',
    '31+ days'
  ) as conversion_window,
  count() as converted_people,
  round(avg(dateDiff('hour', signup_at, paid_at)) / 24, 1) as avg_days
from signups
inner join paid on paid.person_id = signups.person_id
where paid_at >= signup_at
group by conversion_window
order by min(dateDiff('hour', signup_at, paid_at))$hog$)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-ai-referrals-v3', 'atlas-marketing-question-ai-referrals', 3, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select referrer, uniq(person_id) as visitors, count() as pageviews
from (
  select person_id, lower(toString(properties.$referring_domain)) as referrer
  from events
  where event = '$pageview'
    and timestamp >= now() - interval 90 day
    and {{atlas_product_user_eligible}}
)
where referrer in (
    'chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'www.perplexity.ai',
    'claude.ai', 'gemini.google.com', 'copilot.microsoft.com'
  )
  or endsWith(referrer, '.openai.com')
  or endsWith(referrer, '.perplexity.ai')
  or endsWith(referrer, '.claude.ai')
  or endsWith(referrer, '.gemini.google.com')
  or endsWith(referrer, '.copilot.microsoft.com')
group by referrer
order by visitors desc$hog$)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-pre-signup-sites-v2', 'atlas-marketing-question-pre-signup-sites', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$with signups as (
  select person_id, min(timestamp) as signup_at
  from events
  where event = 'user_signed_up'
    and timestamp >= now() - interval 90 day
    and {{atlas_product_user_eligible}}
  group by person_id
), touches as (
  select
    events.person_id as person_id,
    domain(toString(events.properties.$current_url)) as site,
    count() as pageviews
  from events
  inner join signups on signups.person_id = events.person_id
  where events.event = '$pageview'
    and events.timestamp <= signups.signup_at
    and events.timestamp >= signups.signup_at - interval 30 day
  group by events.person_id, site
)
select site, uniq(person_id) as signed_up_people, sum(pageviews) as pageviews
from touches
where site != ''
group by site
order by signed_up_people desc
limit 20$hog$)), 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP);
