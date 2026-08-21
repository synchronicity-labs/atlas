UPDATE "question"
SET
  "name" = 'Signups by first landing section',
  "description" = 'Eligible product signups during the last 90 days grouped by the first Sync section captured before signup: website, blog, docs, product app, support, or another surface.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-question-attribution-surface';

UPDATE "question"
SET
  "description" = 'Eligible product signups during the last 90 days grouped by the first Sync section and page path captured before signup.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-question-attribution-pages';

UPDATE "question"
SET
  "description" = 'Eligible product signups during the last 90 days grouped by first landing section and attribution script version. Missing versions show legacy signups or a section where the current attribution data did not reach signup.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-question-attribution-rollout';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  (
    'atlas-marketing-version-first-touch-v5',
    'atlas-marketing-question-first-touch',
    5,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  coalesce(nullIf(lower(toString(properties.source)), ''), 'missing') as channel,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now('UTC') - interval 2160 hour
  and {{atlas_product_user_eligible}}
group by channel
order by signups desc
limit 20$hog$
    )),
    'bar',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-attribution-surface-v2',
    'atlas-marketing-question-attribution-surface',
    2,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  multiIf(
    lower(toString(properties.landing_subdomain)) = 'app', 'product app',
    lower(toString(properties.landing_subdomain)) = 'support', 'support',
    toString(properties.landing_page) like '/docs%', 'docs',
    toString(properties.landing_page) like '/blog%', 'blog',
    lower(toString(properties.landing_subdomain)) in ('landing', 'www', 'lp'), 'sync.so website',
    toString(properties.landing_subdomain) = '', 'missing',
    lower(toString(properties.landing_subdomain))
  ) as first_landing_section,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now() - interval 90 day
  and {{atlas_product_user_eligible}}
group by first_landing_section
order by signups desc$hog$
    )),
    'bar',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-attribution-pages-v2',
    'atlas-marketing-question-attribution-pages',
    2,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  multiIf(
    lower(toString(properties.landing_subdomain)) = 'app', 'product app',
    lower(toString(properties.landing_subdomain)) = 'support', 'support',
    toString(properties.landing_page) like '/docs%', 'docs',
    toString(properties.landing_page) like '/blog%', 'blog',
    lower(toString(properties.landing_subdomain)) in ('landing', 'www', 'lp'), 'sync.so website',
    toString(properties.landing_subdomain) = '', 'missing',
    lower(toString(properties.landing_subdomain))
  ) as first_landing_section,
  coalesce(nullIf(toString(properties.landing_page), ''), 'missing') as first_landing_page,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now() - interval 90 day
  and {{atlas_product_user_eligible}}
group by first_landing_section, first_landing_page
order by signups desc
limit 50$hog$
    )),
    'table',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-attribution-rollout-v2',
    'atlas-marketing-question-attribution-rollout',
    2,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  multiIf(
    lower(toString(properties.landing_subdomain)) = 'app', 'product app',
    lower(toString(properties.landing_subdomain)) = 'support', 'support',
    toString(properties.landing_page) like '/docs%', 'docs',
    toString(properties.landing_page) like '/blog%', 'blog',
    lower(toString(properties.landing_subdomain)) in ('landing', 'www', 'lp'), 'sync.so website',
    toString(properties.landing_subdomain) = '', 'missing',
    lower(toString(properties.landing_subdomain))
  ) as first_landing_section,
  coalesce(nullIf(toString(properties.snippet_version), ''), 'missing') as snippet_version,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now() - interval 90 day
  and {{atlas_product_user_eligible}}
group by first_landing_section, snippet_version
order by first_landing_section, signups desc$hog$
    )),
    'table',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  );

UPDATE "dashboardCard"
SET
  "displaySettings" = COALESCE("displaySettings", '{}'::jsonb) || jsonb_build_object(
    'timeframe',
    CASE "id"
      WHEN 'atlas-marketing-card-attribution-coverage' THEN 'Last 6 complete UTC months plus current month to date'
      ELSE 'Rolling 90 days through the latest refresh · UTC'
    END
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'atlas-marketing-card-attribution-coverage',
  'atlas-marketing-card-attribution-source',
  'atlas-marketing-card-attribution-surface',
  'atlas-marketing-card-attribution-pages',
  'atlas-marketing-card-attribution-campaigns',
  'atlas-marketing-card-attribution-ctas',
  'atlas-marketing-card-attribution-lag',
  'atlas-marketing-card-attribution-rollout'
);

UPDATE "dashboard"
SET
  "layoutVersion" = "layoutVersion" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-dashboard';
