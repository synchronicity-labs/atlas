UPDATE "question"
SET
  "description" = CASE "id"
    WHEN 'atlas-marketing-question-visitors' THEN 'Monthly people who visit the approved Sync Marketing surfaces: the main website, use-case, product, model, pricing, blog, and docs pages. Atlas should count one known person once across these surfaces. The current GA4 preview sums site totals and can count the same person more than once, so this result remains provisional.'
    WHEN 'atlas-marketing-question-sessions' THEN 'Monthly sessions on the approved Sync Marketing surfaces: the main website, use-case, product, model, pricing, blog, and docs pages. Product app, support, and lipsync.com traffic are outside this view.'
    WHEN 'atlas-marketing-question-pageviews' THEN 'Monthly page views on the approved Sync Marketing surfaces. Repeat views count because this measures content consumption, not unique people. Product app, support, and lipsync.com traffic are outside this view.'
    WHEN 'atlas-marketing-question-sites' THEN 'Monthly sessions by Marketing site. Docs and blog remain visible as separate series while also contributing to the total Marketing view.'
    WHEN 'atlas-marketing-question-channels' THEN 'Sessions during the last 30 days grouped by the GA4 channel that brought the visit to the approved Sync Marketing surfaces.'
    WHEN 'atlas-marketing-question-engagement' THEN 'Visitors, sessions, page views, engagement rate, and average session duration by approved Sync Marketing site during the last 30 days.'
    WHEN 'atlas-marketing-question-signups' THEN 'People who successfully created a Product account during each UTC month. Email verification and first login are not required. Atlas counts one person once and excludes internal identities and banned people who never subscribed.'
    WHEN 'atlas-marketing-question-conversion' THEN 'People grouped by the UTC month of their first observed Marketing visit. A conversion means that the same known person created a Product account within the next 7 days. Visits that are less than 7 days old are not included yet. The rule is approved, but this result remains provisional until PostHog covers every approved Marketing surface.'
    WHEN 'atlas-marketing-question-conversion-rate' THEN 'The share of people who created a Product account within 7 days of their first observed Marketing visit. One known person counts once. Visits that are less than 7 days old are not included yet. The rule is approved, but this result remains provisional until PostHog covers every approved Marketing surface.'
    WHEN 'atlas-marketing-question-attribution-source' THEN 'Product signups during the last 90 days credited to the source of their first recorded Sync visit. A signup receives channel credit only when it happened within 7 days of that first visit. First touch is the headline attribution model.'
    WHEN 'atlas-marketing-question-first-touch' THEN 'All eligible Product signups during the last 90 days grouped by their first recorded acquisition source. This supporting view includes journeys longer than 7 days, which are shown for context but do not count in the headline 7-day attribution result.'
    WHEN 'atlas-marketing-question-attribution-lag' THEN 'Eligible Product signups during the last 90 days grouped by the time from first recorded visit to account creation. Journeys longer than 7 days are shown here for context but do not receive channel credit in the headline attribution result.'
    WHEN 'cmsxi0zzd008s05jr2k8ylmtf' THEN 'Follower growth is the headline social result for Sync Labs on X, Instagram, LinkedIn, and YouTube. Impressions, engagements, website visits, and attributed signups are supporting results. Atlas still needs read access to each platform analytics source.'
    WHEN 'cmsxi100x009105jrtciwwk7q' THEN 'Warm inbound counts known people who show clear buying intent through an enterprise form submission, a booked meeting, or a qualified inbound HubSpot contact. Atlas should count one known person once during the reporting period. The definition is approved; a runnable HubSpot source is still needed.'
    WHEN 'cmsxi0zu9008105jr4p3cuk8y' THEN 'Known people who submit the enterprise form at sync.so/enterprise during the reporting period. Account creation is not required. Atlas still needs HubSpot form-submission read access for this source.'
    ELSE "description"
  END,
  "name" = CASE "id"
    WHEN 'atlas-marketing-question-attribution-source' THEN '7-day signups by first-touch source'
    WHEN 'atlas-marketing-question-first-touch' THEN 'All signup first-touch channels'
    WHEN 'cmsxi100x009105jrtciwwk7q' THEN 'Warm inbound'
    ELSE "name"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'atlas-marketing-question-visitors',
  'atlas-marketing-question-sessions',
  'atlas-marketing-question-pageviews',
  'atlas-marketing-question-sites',
  'atlas-marketing-question-channels',
  'atlas-marketing-question-engagement',
  'atlas-marketing-question-signups',
  'atlas-marketing-question-conversion',
  'atlas-marketing-question-conversion-rate',
  'atlas-marketing-question-attribution-source',
  'atlas-marketing-question-first-touch',
  'atlas-marketing-question-attribution-lag',
  'cmsxi0zzd008s05jr2k8ylmtf',
  'cmsxi100x009105jrtciwwk7q',
  'cmsxi0zu9008105jr4p3cuk8y'
);

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  ('atlas-marketing-version-visitors-v3', 'atlas-marketing-question-visitors', 3, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'docs'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('yearMonth'), 'metrics', jsonb_build_array('totalUsers'), 'merge', 'sum', 'limit', 1000)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-sessions-v3', 'atlas-marketing-question-sessions', 3, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'docs'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('yearMonth'), 'metrics', jsonb_build_array('sessions'), 'merge', 'sum', 'limit', 1000)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-pageviews-v3', 'atlas-marketing-question-pageviews', 3, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'docs'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('yearMonth'), 'metrics', jsonb_build_array('screenPageViews'), 'merge', 'sum', 'limit', 1000)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-sites-v3', 'atlas-marketing-question-sites', 3, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'docs'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('yearMonth'), 'metrics', jsonb_build_array('sessions'), 'merge', 'series', 'limit', 1000)), 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-channels-v2', 'atlas-marketing-question-channels', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'docs'), 'dateRange', '30_days', 'dimensions', jsonb_build_array('sessionDefaultChannelGroup'), 'metrics', jsonb_build_array('sessions'), 'merge', 'sum', 'limit', 1000)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-engagement-v2', 'atlas-marketing-question-engagement', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'docs'), 'dateRange', '30_days', 'dimensions', jsonb_build_array(), 'metrics', jsonb_build_array('totalUsers', 'sessions', 'screenPageViews', 'engagementRate', 'averageSessionDuration'), 'merge', 'rows', 'limit', 1000)), 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-signups-v5', 'atlas-marketing-question-signups', 5, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select
  toStartOfMonth(toTimeZone(timestamp, 'UTC')) as month,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= toStartOfMonth(toTimeZone(now(), 'UTC')) - interval 6 month
  and {{atlas_product_user_eligible}}
group by month
order by month$hog$)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-conversion-v6', 'atlas-marketing-question-conversion', 6, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$with first_visits as (
  select person_id, min(toTimeZone(timestamp, 'UTC')) as first_visit_at
  from events
  where event = '$pageview'
    and domain(toString(properties.$current_url)) in ('sync.so', 'www.sync.so', 'blog.sync.so', 'docs.sync.so')
  group by person_id
), signups as (
  select person_id, min(toTimeZone(timestamp, 'UTC')) as signup_at
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
where first_visit_at >= toStartOfMonth(now('UTC') - interval 6 month)
  and first_visit_at < now('UTC') - interval 7 day
group by visit_month
order by visit_month$hog$)), 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-conversion-rate-v5', 'atlas-marketing-question-conversion-rate', 5, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$with first_visits as (
  select person_id, min(toTimeZone(timestamp, 'UTC')) as first_visit_at
  from events
  where event = '$pageview'
    and domain(toString(properties.$current_url)) in ('sync.so', 'www.sync.so', 'blog.sync.so', 'docs.sync.so')
  group by person_id
), signups as (
  select person_id, min(toTimeZone(timestamp, 'UTC')) as signup_at
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
where first_visit_at >= toStartOfMonth(now('UTC') - interval 6 month)
  and first_visit_at < now('UTC') - interval 7 day
group by visit_month
order by visit_month$hog$)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-attribution-source-v2', 'atlas-marketing-question-attribution-source', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select
  coalesce(nullIf(lower(toString(properties.source)), ''), 'missing') as first_touch_source,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now('UTC') - interval 90 day
  and properties.first_touch_at is not null
  and timestamp >= properties.first_touch_at
  and timestamp < properties.first_touch_at + interval 7 day
  and {{atlas_product_user_eligible}}
group by first_touch_source
order by signups desc$hog$)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-first-touch-v6', 'atlas-marketing-question-first-touch', 6, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select
  coalesce(nullIf(lower(toString(properties.source)), ''), 'missing') as channel,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now('UTC') - interval 90 day
  and {{atlas_product_user_eligible}}
group by channel
order by signups desc
limit 20$hog$)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP);

UPDATE "dashboardCard"
SET
  "displaySettings" = COALESCE("displaySettings", '{}'::jsonb) || jsonb_build_object(
    'timeframe',
    CASE "id"
      WHEN 'atlas-marketing-card-conversion' THEN 'First-visit cohorts with a full 7-day signup window · UTC'
      WHEN 'atlas-marketing-card-conversion-rate' THEN 'First-visit cohorts with a full 7-day signup window · UTC'
      WHEN 'atlas-marketing-card-attribution-source' THEN 'Rolling 90 days · signup within 7 days of first touch · UTC'
      WHEN 'atlas-marketing-card-first-touch' THEN 'Rolling 90 days · all signup journeys · UTC'
      ELSE COALESCE("displaySettings"->>'timeframe', 'Current reporting window · UTC')
    END
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'atlas-marketing-card-visitors',
  'atlas-marketing-card-sessions',
  'atlas-marketing-card-pageviews',
  'atlas-marketing-card-sites',
  'atlas-marketing-card-conversion',
  'atlas-marketing-card-conversion-rate',
  'atlas-marketing-card-channels',
  'atlas-marketing-card-engagement',
  'atlas-marketing-card-attribution-source',
  'atlas-marketing-card-first-touch',
  'atlas-marketing-card-attribution-lag'
);

UPDATE "metrics"."metricCatalogEntry"
SET
  "readiness" = 'NEEDS_SOURCE',
  "sourceHint" = 'HubSpot enterprise form submissions, booked meetings, and qualified inbound contacts',
  "ambiguities" = '[]'::jsonb,
  "description" = 'Count one known person once when they submit the enterprise form, book a meeting, or become a qualified inbound HubSpot contact during the reporting period.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'cmssvojyd000u04l4k2i7c3c9';

UPDATE "metrics"."metricCatalogEntry"
SET
  "sourceHint" = 'Follower and post analytics for x.com/synclabs, instagram.com/syncdotso, linkedin.com/company/synclabs-ai, and youtube.com/@synclabs_so',
  "description" = 'Follower growth is the headline result. Impressions, engagements, website visits, and attributed signups are supporting results.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'cmssvojy2000s04l48kicyfo8';

UPDATE "metrics"."metricCatalogEntry"
SET
  "sourceHint" = 'HubSpot form submissions for sync.so/enterprise',
  "description" = 'Count known people who submit the enterprise form during the reporting period.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'cmssvojvj000g04l4rtuk5ka1';

UPDATE "dashboard"
SET
  "description" = 'Marketing traffic, acquisition, search, attribution, and signup journeys. The headline attribution model gives credit to the first recorded source when account creation happens within 7 days. Docs and blog are included in Marketing totals and remain visible by site. Product app, support, and lipsync.com are outside this view.',
  "layoutVersion" = "layoutVersion" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-dashboard';
