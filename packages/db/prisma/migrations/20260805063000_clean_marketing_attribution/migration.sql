INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  ('atlas-marketing-version-first-touch-v2', 'atlas-marketing-question-first-touch', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$with first_touch as (
  select
    person_id,
    argMin(coalesce(nullIf(toString(properties.$utm_source), ''), nullIf(toString(properties.$referring_domain), ''), 'Direct'), timestamp) as raw_channel
  from events
  where event = '$pageview'
    and timestamp >= now() - interval 180 day
  group by person_id
), signups as (
  select person_id, min(timestamp) as signup_at
  from events
  where event = 'user_signed_up'
    and timestamp >= now() - interval 90 day
  group by person_id
)
select if(first_touch.raw_channel = '$direct', 'Direct', first_touch.raw_channel) as channel, count() as signups
from signups
inner join first_touch on first_touch.person_id = signups.person_id
group by channel
order by signups desc
limit 20$hog$)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-ai-referrals-v2', 'atlas-marketing-question-ai-referrals', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select referrer, uniq(person_id) as visitors, count() as pageviews
from (
  select person_id, lower(toString(properties.$referring_domain)) as referrer
  from events
  where event = '$pageview'
    and timestamp >= now() - interval 90 day
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
order by visitors desc$hog$)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP);
