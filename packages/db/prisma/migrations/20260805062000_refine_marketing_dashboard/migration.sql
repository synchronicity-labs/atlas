UPDATE "question"
SET "description" = 'PostHog behavioral visitors and signups within each month. Conversion is shown as its own question so the two count series remain legible.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 2006;

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "status", "createdAt", "updatedAt"
) VALUES
  ('atlas-marketing-question-conversion-rate', 2019, 'Visitor to signup conversion rate', 'Monthly PostHog behavioral signups divided by deduplicated page-view people. This is a same-source behavioral proxy.', 'ATLAS', 'atlas-marketing-source', 'marketing:posthog:visitor-signup-rate', 'atlas:marketing:acquisition', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-question-search-efficiency', 2020, 'Search CTR & position', 'Search Console click-through rate and weighted average position for sync.so by month.', 'ATLAS', 'atlas-marketing-source', 'marketing:gsc:sync-efficiency', 'atlas:marketing:search', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  ('atlas-marketing-version-visitors-v2', 'atlas-marketing-question-visitors', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'playground', 'docs', 'lipsync', 'support'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('yearMonth'), 'metrics', jsonb_build_array('totalUsers'), 'merge', 'sum', 'limit', 1000)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-sessions-v2', 'atlas-marketing-question-sessions', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'playground', 'docs', 'lipsync', 'support'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('yearMonth'), 'metrics', jsonb_build_array('sessions'), 'merge', 'sum', 'limit', 1000)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-pageviews-v2', 'atlas-marketing-question-pageviews', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'playground', 'docs', 'lipsync', 'support'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('yearMonth'), 'metrics', jsonb_build_array('screenPageViews'), 'merge', 'sum', 'limit', 1000)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-sites-v2', 'atlas-marketing-question-sites', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'ga4', 'properties', jsonb_build_array('landing', 'blog', 'playground', 'docs', 'lipsync', 'support'), 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('yearMonth'), 'metrics', jsonb_build_array('sessions'), 'merge', 'series', 'limit', 1000)), 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-conversion-v2', 'atlas-marketing-question-conversion', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select
  toStartOfMonth(timestamp) as month,
  uniqIf(person_id, event = '$pageview') as visitors,
  uniqIf(person_id, event = 'user_signed_up') as signups
from events
where timestamp >= toStartOfMonth(now()) - interval 6 month
  and event in ('$pageview', 'user_signed_up')
group by month
order by month$hog$)), 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-search-history-v2', 'atlas-marketing-question-search-history', 2, 'API', jsonb_pretty(jsonb_build_object('source', 'search_console', 'site', 'sync', 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('date'), 'aggregate', 'month', 'metrics', jsonb_build_array('clicks', 'impressions'), 'limit', 25000)), 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-conversion-rate-v1', 'atlas-marketing-question-conversion-rate', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'query', $hog$select
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
  group by month
)
order by month$hog$)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-marketing-version-search-efficiency-v1', 'atlas-marketing-question-search-efficiency', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'search_console', 'site', 'sync', 'dateRange', '6_months_and_mtd', 'dimensions', jsonb_build_array('date'), 'aggregate', 'month', 'metrics', jsonb_build_array('ctr_pct', 'position'), 'limit', 25000)), 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP);

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES
  ('atlas-marketing-card-conversion-rate', 'atlas-marketing-dashboard', 'atlas-marketing-tab-acquisition', 'atlas-marketing-question-conversion-rate', 6, 0, 13, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-search-efficiency', 'atlas-marketing-dashboard', 'atlas-marketing-tab-search', 'atlas-marketing-question-search-efficiency', 2, 0, 8, 24, 8, 'LINE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE "dashboardCard"
SET "position" = "position" + 1,
    "x" = CASE WHEN "id" = 'atlas-marketing-card-channels' THEN 6 ELSE 0 END,
    "y" = CASE WHEN "id" = 'atlas-marketing-card-channels' THEN 13 ELSE 20 END,
    "width" = CASE WHEN "id" = 'atlas-marketing-card-channels' THEN 18 ELSE 24 END,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN ('atlas-marketing-card-channels', 'atlas-marketing-card-engagement');

UPDATE "dashboardCard"
SET "position" = "position" + 1,
    "y" = "y" + 8,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "tabId" = 'atlas-marketing-tab-search'
  AND "id" IN (
    'atlas-marketing-card-search-queries',
    'atlas-marketing-card-search-pages',
    'atlas-marketing-card-lipsync-search',
    'atlas-marketing-card-search-countries'
  );

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-dashboard';
