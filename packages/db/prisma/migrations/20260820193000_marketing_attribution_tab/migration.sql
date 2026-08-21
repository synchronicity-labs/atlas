UPDATE "dashboardTab"
SET "position" = "position" + 1
WHERE "dashboardId" = 'atlas-marketing-dashboard'
  AND "position" >= 2;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-marketing-tab-attribution',
  'atlas-marketing-dashboard',
  5,
  'Attribution',
  2,
  'atlas:marketing:attribution'
);

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "status", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-marketing-question-attribution-coverage',
    6040,
    'Signup attribution coverage',
    'Monthly product signups with first-touch attribution captured by sync.so/s/boot.js or the matching product implementation. One person is counted once. Direct means the visit was captured with no external source; missing means no attribution reached the signup event.',
    'POSTHOG',
    'atlas-marketing-source',
    'marketing:posthog:attribution-coverage',
    'atlas:marketing:attribution',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-question-attribution-source',
    6041,
    'Signups by first-touch source',
    'Eligible product signups during the last 90 days grouped by the first-touch source stored at signup. The source is classified as GEO, organic, paid, social, referral, or direct by the shared attribution script.',
    'POSTHOG',
    'atlas-marketing-source',
    'marketing:posthog:attribution-source',
    'atlas:marketing:attribution',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-question-attribution-surface',
    6042,
    'Signups by first landing surface',
    'Eligible product signups during the last 90 days grouped by the Sync surface where the first attributed visit happened, such as the website, blog, docs, or product app.',
    'POSTHOG',
    'atlas-marketing-source',
    'marketing:posthog:attribution-surface',
    'atlas:marketing:attribution',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-question-attribution-pages',
    6043,
    'First landing pages that lead to signup',
    'Eligible product signups during the last 90 days grouped by the first Sync surface and page path captured before signup.',
    'POSTHOG',
    'atlas-marketing-source',
    'marketing:posthog:attribution-pages',
    'atlas:marketing:attribution',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-question-attribution-campaigns',
    6044,
    'Campaigns that lead to signup',
    'Eligible product signups during the last 90 days with UTM tags, grouped by source, medium, and campaign. Untagged traffic is not included in this table.',
    'POSTHOG',
    'atlas-marketing-source',
    'marketing:posthog:attribution-campaigns',
    'atlas:marketing:attribution',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-question-attribution-ctas',
    6045,
    'Calls to action that lead to signup',
    'Eligible product signups during the last 90 days grouped by the last signup-bound call to action captured before signup. This is the converting CTA, not the first CTA a person clicked.',
    'POSTHOG',
    'atlas-marketing-source',
    'marketing:posthog:attribution-ctas',
    'atlas:marketing:attribution',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-question-attribution-lag',
    6046,
    'Time from first visit to signup',
    'Eligible product signups during the last 90 days grouped by elapsed time from the first attributed visit to signup. Only signups with a valid first-touch timestamp are included.',
    'POSTHOG',
    'atlas-marketing-source',
    'marketing:posthog:attribution-lag',
    'atlas:marketing:attribution',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-question-attribution-rollout',
    6047,
    'Attribution script coverage by surface',
    'Eligible product signups during the last 90 days grouped by first landing surface and attribution snippet version. Missing versions show legacy signups or a surface where the current attribution data did not reach signup.',
    'POSTHOG',
    'atlas-marketing-source',
    'marketing:posthog:attribution-rollout',
    'atlas:marketing:attribution',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  (
    'atlas-marketing-version-attribution-coverage-v1',
    'atlas-marketing-question-attribution-coverage',
    1,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  toStartOfMonth(timestamp) as month,
  uniq(person_id) as total_signups,
  uniqIf(person_id, toString(properties.source) != '') as captured_signups,
  round(uniqIf(person_id, toString(properties.source) != '') / nullIf(uniq(person_id), 0) * 100, 2) as coverage_pct,
  uniqIf(person_id, lower(toString(properties.source)) = 'direct') as direct_signups,
  uniqIf(person_id, toString(properties.source) = '') as missing_signups
from events
where event = 'user_signed_up'
  and timestamp >= toStartOfMonth(now()) - interval 6 month
  and {{atlas_product_user_eligible}}
group by month
order by month$hog$
    )),
    'line',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-attribution-source-v1',
    'atlas-marketing-question-attribution-source',
    1,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  coalesce(nullIf(lower(toString(properties.source)), ''), 'missing') as first_touch_source,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now() - interval 90 day
  and {{atlas_product_user_eligible}}
group by first_touch_source
order by signups desc$hog$
    )),
    'bar',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-attribution-surface-v1',
    'atlas-marketing-question-attribution-surface',
    1,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  coalesce(nullIf(lower(toString(properties.landing_subdomain)), ''), 'missing') as first_landing_surface,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now() - interval 90 day
  and {{atlas_product_user_eligible}}
group by first_landing_surface
order by signups desc$hog$
    )),
    'bar',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-attribution-pages-v1',
    'atlas-marketing-question-attribution-pages',
    1,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  coalesce(nullIf(lower(toString(properties.landing_subdomain)), ''), 'missing') as first_landing_surface,
  coalesce(nullIf(toString(properties.landing_page), ''), 'missing') as first_landing_page,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now() - interval 90 day
  and {{atlas_product_user_eligible}}
group by first_landing_surface, first_landing_page
order by signups desc
limit 50$hog$
    )),
    'table',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-attribution-campaigns-v1',
    'atlas-marketing-question-attribution-campaigns',
    1,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  toString(properties.utm_source) as utm_source,
  toString(properties.utm_medium) as utm_medium,
  toString(properties.utm_campaign) as utm_campaign,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now() - interval 90 day
  and toString(properties.utm_campaign) != ''
  and {{atlas_product_user_eligible}}
group by utm_source, utm_medium, utm_campaign
order by signups desc
limit 50$hog$
    )),
    'table',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-attribution-ctas-v1',
    'atlas-marketing-question-attribution-ctas',
    1,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  toString(properties.cta_label) as converting_cta,
  coalesce(nullIf(toString(properties.cta_page), ''), 'missing') as cta_page,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now() - interval 90 day
  and toString(properties.cta_label) != ''
  and {{atlas_product_user_eligible}}
group by converting_cta, cta_page
order by signups desc
limit 50$hog$
    )),
    'table',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-attribution-lag-v1',
    'atlas-marketing-question-attribution-lag',
    1,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$with attributed_signups as (
  select
    person_id,
    timestamp as signup_at,
    parseDateTimeBestEffortOrNull(toString(properties.first_touch_at)) as first_touch_at
  from events
  where event = 'user_signed_up'
    and timestamp >= now() - interval 90 day
    and toString(properties.first_touch_at) != ''
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
where first_touch_at is not null
  and signup_at >= first_touch_at
group by time_to_signup
order by min(dateDiff('hour', first_touch_at, signup_at))$hog$
    )),
    'bar',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-marketing-version-attribution-rollout-v1',
    'atlas-marketing-question-attribution-rollout',
    1,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  coalesce(nullIf(lower(toString(properties.landing_subdomain)), ''), 'missing') as first_landing_surface,
  coalesce(nullIf(toString(properties.snippet_version), ''), 'missing') as snippet_version,
  uniq(person_id) as signups
from events
where event = 'user_signed_up'
  and timestamp >= now() - interval 90 day
  and {{atlas_product_user_eligible}}
group by first_landing_surface, snippet_version
order by first_landing_surface, signups desc$hog$
    )),
    'table',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  );

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES
  ('atlas-marketing-card-attribution-coverage', 'atlas-marketing-dashboard', 'atlas-marketing-tab-attribution', 'atlas-marketing-question-attribution-coverage', 0, 0, 0, 24, 8, 'LINE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-attribution-source', 'atlas-marketing-dashboard', 'atlas-marketing-tab-attribution', 'atlas-marketing-question-attribution-source', 1, 0, 8, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-attribution-surface', 'atlas-marketing-dashboard', 'atlas-marketing-tab-attribution', 'atlas-marketing-question-attribution-surface', 2, 12, 8, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-attribution-pages', 'atlas-marketing-dashboard', 'atlas-marketing-tab-attribution', 'atlas-marketing-question-attribution-pages', 3, 0, 16, 12, 9, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-attribution-campaigns', 'atlas-marketing-dashboard', 'atlas-marketing-tab-attribution', 'atlas-marketing-question-attribution-campaigns', 4, 12, 16, 12, 9, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-attribution-ctas', 'atlas-marketing-dashboard', 'atlas-marketing-tab-attribution', 'atlas-marketing-question-attribution-ctas', 5, 0, 25, 12, 9, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-attribution-lag', 'atlas-marketing-dashboard', 'atlas-marketing-tab-attribution', 'atlas-marketing-question-attribution-lag', 6, 12, 25, 12, 9, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-marketing-card-attribution-rollout', 'atlas-marketing-dashboard', 'atlas-marketing-tab-attribution', 'atlas-marketing-question-attribution-rollout', 7, 0, 34, 24, 8, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE "dashboard"
SET
  "description" = 'Live traffic, search demand, signup attribution, acquisition channels, and behavioral conversion across Sync properties. Attribution uses server-side signup fields captured by sync.so/s/boot.js and the matching product implementation.',
  "layoutVersion" = "layoutVersion" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-dashboard';
