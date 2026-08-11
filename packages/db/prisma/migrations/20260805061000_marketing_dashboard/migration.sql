INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-marketing-source', 'atlas:marketing', 'ATLAS',
  'GA4, Search Console, and PostHog', 'UNCONFIGURED',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-marketing-dashboard', 3, 'Marketing acquisition & conversion',
  'Live traffic, search demand, acquisition channels, and behavioral conversion across Sync properties.',
  1, 'atlas', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES
  ('atlas-marketing-tab-acquisition', 'atlas-marketing-dashboard', 1, 'Acquisition', 0, 'atlas:marketing:acquisition'),
  ('atlas-marketing-tab-search', 'atlas-marketing-dashboard', 2, 'Search & GEO', 1, 'atlas:marketing:search'),
  ('atlas-marketing-tab-journey', 'atlas-marketing-dashboard', 3, 'Journey', 2, 'atlas:marketing:journey');

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "status", "createdAt", "updatedAt"
) VALUES
  ('atlas-marketing-question-visitors', 2001, 'Website visitors', 'GA4 total users summed across Sync web properties for six completed months and current month to date.', 'ATLAS', 'atlas-marketing-source', 'marketing:ga4:visitors', 'atlas:marketing:acquisition', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-sessions', 2002, 'Website sessions', 'GA4 sessions summed across Sync web properties for six completed months and current month to date.', 'ATLAS', 'atlas-marketing-source', 'marketing:ga4:sessions', 'atlas:marketing:acquisition', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-pageviews', 2003, 'Page views', 'GA4 screen and page views summed across Sync web properties for six completed months and current month to date.', 'ATLAS', 'atlas-marketing-source', 'marketing:ga4:pageviews', 'atlas:marketing:acquisition', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-signups', 2004, 'Product signups', 'PostHog user_signed_up behavioral events deduplicated by person. Reconcile with product database truth before finance use.', 'ATLAS', 'atlas-marketing-source', 'marketing:posthog:signups', 'atlas:marketing:acquisition', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-sites', 2005, 'Sessions by site', 'GA4 monthly sessions broken out by each Sync web property.', 'ATLAS', 'atlas-marketing-source', 'marketing:ga4:sessions-by-site', 'atlas:marketing:acquisition', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-conversion', 2006, 'Visitor to signup conversion', 'PostHog behavioral visitors and signups within each month. This is a same-source behavioral conversion view, not reconciled product truth.', 'ATLAS', 'atlas-marketing-source', 'marketing:posthog:visitor-signup', 'atlas:marketing:acquisition', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-channels', 2007, 'Acquisition channels', 'GA4 sessions by default channel group across all configured Sync web properties during the last 30 days.', 'ATLAS', 'atlas-marketing-source', 'marketing:ga4:channels', 'atlas:marketing:acquisition', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-engagement', 2008, 'Engagement by site', 'GA4 users, sessions, page views, engagement rate, and average session duration by Sync web property for the last 30 days.', 'ATLAS', 'atlas-marketing-source', 'marketing:ga4:engagement-by-site', 'atlas:marketing:acquisition', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-search-history', 2009, 'Organic search performance', 'Search Console clicks, impressions, CTR, and weighted average position for sync.so by month.', 'ATLAS', 'atlas-marketing-source', 'marketing:gsc:sync-history', 'atlas:marketing:search', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-search-queries', 2010, 'Search demand by query', 'Top sync.so organic search queries from Search Console during the last 90 days.', 'ATLAS', 'atlas-marketing-source', 'marketing:gsc:sync-queries', 'atlas:marketing:search', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-search-pages', 2011, 'Organic landing pages', 'Top sync.so pages from Search Console during the last 90 days.', 'ATLAS', 'atlas-marketing-source', 'marketing:gsc:sync-pages', 'atlas:marketing:search', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-lipsync-search', 2012, 'Lipsync search demand', 'Top lipsync.com organic search queries from Search Console during the last 90 days.', 'ATLAS', 'atlas-marketing-source', 'marketing:gsc:lipsync-queries', 'atlas:marketing:search', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-search-countries', 2013, 'Organic search countries', 'Search Console performance for sync.so grouped by country during the last 90 days.', 'ATLAS', 'atlas-marketing-source', 'marketing:gsc:sync-countries', 'atlas:marketing:search', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-first-touch', 2014, 'Signup first-touch channels', 'PostHog signups grouped by the earliest observed page-view source or referring domain within the prior 180 days.', 'ATLAS', 'atlas-marketing-source', 'marketing:posthog:first-touch-signups', 'atlas:marketing:journey', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-entry-pages', 2015, 'Top signup entry pages', 'Earliest observed page URL for people with a signup event in the last 90 days.', 'ATLAS', 'atlas-marketing-source', 'marketing:posthog:signup-entry-pages', 'atlas:marketing:journey', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-time-to-paid', 2016, 'Time from signup to subscription', 'People with both a signup and later successful subscription payment event during the last 180 days, grouped by elapsed time.', 'ATLAS', 'atlas-marketing-source', 'marketing:posthog:time-to-paid', 'atlas:marketing:journey', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-ai-referrals', 2017, 'AI referral traffic', 'PostHog page views and visitors referred by ChatGPT, Perplexity, Claude, Gemini, or Copilot during the last 90 days.', 'ATLAS', 'atlas-marketing-source', 'marketing:posthog:ai-referrals', 'atlas:marketing:journey', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-pre-signup-sites', 2018, 'Sites touched before signup', 'Observed hostnames touched in the 30 days before a PostHog signup event.', 'ATLAS', 'atlas-marketing-source', 'marketing:posthog:pre-signup-sites', 'atlas:marketing:journey', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  ('atlas-marketing-version-visitors-v1', 'atlas-marketing-question-visitors', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'playground', 'docs', 'lipsync', 'support'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('month'), 'metrics', jsonb_build_array('totalUsers'), 'merge', 'sum', 'limit', 1000)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-sessions-v1', 'atlas-marketing-question-sessions', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'playground', 'docs', 'lipsync', 'support'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('month'), 'metrics', jsonb_build_array('sessions'), 'merge', 'sum', 'limit', 1000)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-pageviews-v1', 'atlas-marketing-question-pageviews', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'playground', 'docs', 'lipsync', 'support'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('month'), 'metrics', jsonb_build_array('screenPageViews'), 'merge', 'sum', 'limit', 1000)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-signups-v1', 'atlas-marketing-question-signups', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select
  toStartOfMonth(timestamp) as month,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= toStartOfMonth(now()) - interval 6 month
group by month
order by month$hog$)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-sites-v1', 'atlas-marketing-question-sites', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'playground', 'docs', 'lipsync', 'support'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('month'), 'metrics', jsonb_build_array('sessions'), 'merge', 'series', 'limit', 1000)), 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-conversion-v1', 'atlas-marketing-question-conversion', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select
  month,
  visitors,
  signups,
  round(signups / nullIf(visitors, 0) * 100, 2) as conversion_rate
from (
  select
    toStartOfMonth(timestamp) as month,
    uniqIf(person_id, event = '$pageview') as visitors,
    uniqIf(person_id, event = 'user_signed_up') as signups
  from events
  where timestamp >= toStartOfMonth(now()) - interval 6 month
    and event in ('$pageview', 'user_signed_up')
  group by month
)
order by month$hog$)), 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-channels-v1', 'atlas-marketing-question-channels', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'playground', 'docs', 'lipsync', 'support'), 'dateRange', '30_days', 'dimensions', jsonb_build_array('sessionDefaultChannelGroup'), 'metrics', jsonb_build_array('sessions'), 'merge', 'sum', 'limit', 1000)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-engagement-v1', 'atlas-marketing-question-engagement', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'playground', 'docs', 'lipsync', 'support'), 'dateRange', '30_days', 'dimensions', jsonb_build_array(), 'metrics', jsonb_build_array('totalUsers', 'sessions', 'screenPageViews', 'engagementRate', 'averageSessionDuration'), 'merge', 'rows', 'limit', 1000)), 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-search-history-v1', 'atlas-marketing-question-search-history', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'search_console', 'site', 'sync', 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('date'), 'aggregate', 'month', 'limit', 25000)), 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-search-queries-v1', 'atlas-marketing-question-search-queries', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'search_console', 'site', 'sync', 'dateRange', '90_days', 'dimensions', jsonb_build_array('query'), 'aggregate', 'none', 'limit', 100)), 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-search-pages-v1', 'atlas-marketing-question-search-pages', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'search_console', 'site', 'sync', 'dateRange', '90_days', 'dimensions', jsonb_build_array('page'), 'aggregate', 'none', 'limit', 100)), 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-lipsync-search-v1', 'atlas-marketing-question-lipsync-search', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'search_console', 'site', 'lipsync', 'dateRange', '90_days', 'dimensions', jsonb_build_array('query'), 'aggregate', 'none', 'limit', 100)), 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-search-countries-v1', 'atlas-marketing-question-search-countries', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'search_console', 'site', 'sync', 'dateRange', '90_days', 'dimensions', jsonb_build_array('country'), 'aggregate', 'none', 'limit', 100)), 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-first-touch-v1', 'atlas-marketing-question-first-touch', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$with first_touch as (
  select
    person_id,
    argMin(coalesce(nullIf(toString(properties.$utm_source), ''), nullIf(toString(properties.$referring_domain), ''), 'Direct / unknown'), timestamp) as channel
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
select first_touch.channel as channel, count() as signups
from signups
inner join first_touch on first_touch.person_id = signups.person_id
group by channel
order by signups desc
limit 20$hog$)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-entry-pages-v1', 'atlas-marketing-question-entry-pages', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$with first_touch as (
  select person_id, argMin(toString(properties.$current_url), timestamp) as landing_url
  from events
  where event = '$pageview'
    and timestamp >= now() - interval 180 day
  group by person_id
), signups as (
  select person_id
  from events
  where event = 'user_signed_up'
    and timestamp >= now() - interval 90 day
  group by person_id
)
select first_touch.landing_url as landing_url, count() as signed_up_people
from signups
inner join first_touch on first_touch.person_id = signups.person_id
where landing_url != ''
group by landing_url
order by signed_up_people desc
limit 20$hog$)), 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-time-to-paid-v1', 'atlas-marketing-question-time-to-paid', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$with signups as (
  select person_id, min(timestamp) as signup_at
  from events
  where event = 'user_signed_up'
    and timestamp >= now() - interval 180 day
  group by person_id
), paid as (
  select person_id, min(timestamp) as paid_at
  from events
  where event = 'subscription_payment_succeeded'
    and timestamp >= now() - interval 180 day
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
  ('atlas-marketing-version-ai-referrals-v1', 'atlas-marketing-question-ai-referrals', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select
  coalesce(nullIf(toString(properties.$referring_domain), ''), 'Unknown') as referrer,
  uniq(person_id) as visitors,
  count() as pageviews
from events
where event = '$pageview'
  and timestamp >= now() - interval 90 day
  and (
    lower(toString(properties.$referring_domain)) like '%chatgpt%'
    or lower(toString(properties.$referring_domain)) like '%perplexity%'
    or lower(toString(properties.$referring_domain)) like '%claude%'
    or lower(toString(properties.$referring_domain)) like '%gemini%'
    or lower(toString(properties.$referring_domain)) like '%copilot%'
  )
group by referrer
order by visitors desc$hog$)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-pre-signup-sites-v1', 'atlas-marketing-question-pre-signup-sites', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$with signups as (
  select person_id, min(timestamp) as signup_at
  from events
  where event = 'user_signed_up'
    and timestamp >= now() - interval 90 day
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

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES
  ('atlas-marketing-card-visitors', 'atlas-marketing-dashboard', 'atlas-marketing-tab-acquisition', 'atlas-marketing-question-visitors', 0, 0, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-sessions', 'atlas-marketing-dashboard', 'atlas-marketing-tab-acquisition', 'atlas-marketing-question-sessions', 1, 6, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-pageviews', 'atlas-marketing-dashboard', 'atlas-marketing-tab-acquisition', 'atlas-marketing-question-pageviews', 2, 12, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-signups', 'atlas-marketing-dashboard', 'atlas-marketing-tab-acquisition', 'atlas-marketing-question-signups', 3, 18, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-sites', 'atlas-marketing-dashboard', 'atlas-marketing-tab-acquisition', 'atlas-marketing-question-sites', 4, 0, 5, 12, 8, 'LINE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-conversion', 'atlas-marketing-dashboard', 'atlas-marketing-tab-acquisition', 'atlas-marketing-question-conversion', 5, 12, 5, 12, 8, 'LINE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-channels', 'atlas-marketing-dashboard', 'atlas-marketing-tab-acquisition', 'atlas-marketing-question-channels', 6, 0, 13, 12, 7, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-engagement', 'atlas-marketing-dashboard', 'atlas-marketing-tab-acquisition', 'atlas-marketing-question-engagement', 7, 12, 13, 12, 7, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-search-kpi', 'atlas-marketing-dashboard', 'atlas-marketing-tab-search', 'atlas-marketing-question-search-history', 0, 0, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-search-history', 'atlas-marketing-dashboard', 'atlas-marketing-tab-search', 'atlas-marketing-question-search-history', 1, 6, 0, 18, 8, 'LINE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-search-queries', 'atlas-marketing-dashboard', 'atlas-marketing-tab-search', 'atlas-marketing-question-search-queries', 2, 0, 8, 12, 8, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-search-pages', 'atlas-marketing-dashboard', 'atlas-marketing-tab-search', 'atlas-marketing-question-search-pages', 3, 12, 8, 12, 8, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-lipsync-search', 'atlas-marketing-dashboard', 'atlas-marketing-tab-search', 'atlas-marketing-question-lipsync-search', 4, 0, 16, 12, 8, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-search-countries', 'atlas-marketing-dashboard', 'atlas-marketing-tab-search', 'atlas-marketing-question-search-countries', 5, 12, 16, 12, 8, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-first-touch', 'atlas-marketing-dashboard', 'atlas-marketing-tab-journey', 'atlas-marketing-question-first-touch', 0, 0, 0, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-entry-pages', 'atlas-marketing-dashboard', 'atlas-marketing-tab-journey', 'atlas-marketing-question-entry-pages', 1, 12, 0, 12, 8, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-time-to-paid', 'atlas-marketing-dashboard', 'atlas-marketing-tab-journey', 'atlas-marketing-question-time-to-paid', 2, 0, 8, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-ai-referrals', 'atlas-marketing-dashboard', 'atlas-marketing-tab-journey', 'atlas-marketing-question-ai-referrals', 3, 12, 8, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-pre-signup-sites', 'atlas-marketing-dashboard', 'atlas-marketing-tab-journey', 'atlas-marketing-question-pre-signup-sites', 4, 0, 16, 24, 7, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
