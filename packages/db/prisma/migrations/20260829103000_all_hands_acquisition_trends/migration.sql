UPDATE "question"
SET "description" = CASE "number"
  WHEN 2002 THEN 'Sessions during each of the six latest complete UTC months on the approved Sync Marketing surfaces: the main website, use-case, product, model, pricing, blog, and docs pages. Product app, support, and lipsync.com traffic are outside this view.'
  WHEN 2004 THEN 'People who successfully created a Product account during each of the six latest complete UTC months. Email verification and first login are not required. Atlas counts one person once and excludes internal identities and banned people who never subscribed.'
  WHEN 2017 THEN 'For each of the six latest complete UTC months, eligible people with a page view referred by a supported AI assistant, the subset who created a Product account after that visit in the same month, and the resulting visitor-to-signup conversion rate.'
  ELSE "description"
END,
"updatedAt" = CURRENT_TIMESTAMP
WHERE "number" IN (2002, 2004, 2017);

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  (
    'atlas-marketing-version-sessions-v4',
    'atlas-marketing-question-sessions',
    4,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'ga4',
      'properties', jsonb_build_array('landing', 'blog', 'docs'),
      'dateRange', '6_months_and_mtd',
      'completeMonthsOnly', true,
      'dimensions', jsonb_build_array('yearMonth'),
      'metrics', jsonb_build_array('sessions'),
      'merge', 'sum',
      'limit', 1000
    )),
    'line',
    '{"graph.dimensions":["month"],"graph.metrics":["sessions"]}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-signups-v6',
    'atlas-marketing-question-signups',
    6,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  toStartOfMonth(toTimeZone(timestamp, 'UTC')) as month,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -6)
  and timestamp < toStartOfMonth(toTimeZone(now(), 'UTC'))
  and {{atlas_product_user_eligible}}
group by month
order by month$hog$
    )),
    'line',
    '{"graph.dimensions":["month"],"graph.metrics":["signups"]}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-ai-referrals-v5',
    'atlas-marketing-question-ai-referrals',
    5,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$with ai_visits as (
  select
    person_id,
    toStartOfMonth(toTimeZone(timestamp, 'UTC')) as month,
    min(toTimeZone(timestamp, 'UTC')) as first_ai_visit_at
  from events
  where event = '$pageview'
    and timestamp >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -6)
    and timestamp < toStartOfMonth(toTimeZone(now(), 'UTC'))
    and (
      lower(toString(properties.$referring_domain)) in (
        'chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'www.perplexity.ai',
        'claude.ai', 'gemini.google.com', 'copilot.microsoft.com'
      )
      or endsWith(lower(toString(properties.$referring_domain)), '.openai.com')
      or endsWith(lower(toString(properties.$referring_domain)), '.perplexity.ai')
      or endsWith(lower(toString(properties.$referring_domain)), '.claude.ai')
      or endsWith(lower(toString(properties.$referring_domain)), '.gemini.google.com')
      or endsWith(lower(toString(properties.$referring_domain)), '.copilot.microsoft.com')
    )
    and {{atlas_product_user_eligible}}
  group by person_id, month
), signups as (
  select
    person_id,
    min(toTimeZone(timestamp, 'UTC')) as signup_at
  from events
  where event = 'user_signed_up'
    and timestamp >= addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -6)
    and timestamp < toStartOfMonth(toTimeZone(now(), 'UTC'))
    and {{atlas_product_user_eligible}}
  group by person_id
), monthly as (
  select
    ai_visits.month as month,
    count() as ai_visitors,
    countIf(
      signups.signup_at >= ai_visits.first_ai_visit_at
      and signups.signup_at < addMonths(ai_visits.month, 1)
    ) as ai_signups
  from ai_visits
  left join signups on signups.person_id = ai_visits.person_id
  group by ai_visits.month
)
select
  month,
  ai_visitors,
  ai_signups,
  round(ai_signups / nullIf(ai_visitors, 0) * 100, 2) as ai_visitor_to_signup_conversion_pct
from monthly
order by month$hog$
    )),
    'line',
    '{"graph.dimensions":["month"],"graph.metrics":["ai_visitors","ai_signups","ai_visitor_to_signup_conversion_pct"]}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  );
