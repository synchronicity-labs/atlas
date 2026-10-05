BEGIN;

INSERT INTO "ingestion"."dataset" (
  "id", "sourceId", "key", "label", "description", "adapter",
  "eventTimeField", "watermarkField", "cadenceMinutes", "freshnessSlaMinutes",
  "backfillWindowDays", "config", "enabled", "createdAt", "updatedAt"
)
SELECT
  'atlas-marketing-dataset-posthog-visitors', "id", 'marketing.posthog.website_visitors',
  'PostHog public marketing visitors',
  'Monthly distinct PostHog people on the approved public Sync Marketing pages.',
  'marketing-posthog', 'month', NULL, 480, 720, 210,
  '{"source":"posthog","identity":"person_id","scope":"approved_public_marketing_pages"}'::jsonb,
  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "dataSource"
WHERE "key" = 'atlas:marketing'
ON CONFLICT ("sourceId", "key") DO NOTHING;

UPDATE "question"
SET
  "sourceExternalId" = CASE "number"
    WHEN 2001 THEN 'marketing:posthog:visitors'
    ELSE "sourceExternalId"
  END,
  "description" = CASE "number"
    WHEN 2001 THEN 'Monthly distinct PostHog people who visit an approved public Sync Marketing page. The denominator excludes /home, /login, /signup, onboarding, billing, projects, settings, and other product-app routes. Atlas counts one PostHog person once per month; coverage remains provisional until all approved public surfaces are instrumented.'
    WHEN 2006 THEN 'People grouped by the UTC month of their first observed approved public Marketing visit. A conversion means that the same eligible PostHog person created a Product account within the next 7 days. Direct visits to /login or /signup are outside the Marketing visitor denominator.'
    WHEN 2019 THEN 'The share of eligible PostHog people who created a Product account within 7 days of their first observed approved public Marketing visit. Direct visits to /login or /signup are outside the Marketing visitor denominator.'
    ELSE "description"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" IN (2001, 2006, 2019);

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
)
SELECT
  'atlas-marketing-version-visitors-v4',
  q."id",
  4,
  'API',
  jsonb_pretty(jsonb_build_object('source', 'posthog', 'personPolicy', 'exclude_banned_product_users', 'query', $hog$
select
  toStartOfMonth(toTimeZone(timestamp, 'UTC')) as month,
  uniq(person_id) as visitors
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
  and timestamp >= toStartOfMonth(toTimeZone(now(), 'UTC')) - interval 6 month
  and {{atlas_product_user_eligible}}
group by month
order by month$hog$)),
  'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
FROM "question" q
WHERE q."number" = 2001
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
)
SELECT
  'atlas-marketing-version-conversion-v7',
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
    and timestamp >= toStartOfMonth(toTimeZone(now(), 'UTC')) - interval 6 month
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
  'atlas-marketing-version-conversion-rate-v6',
  q."id",
  6,
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
    and timestamp >= toStartOfMonth(toTimeZone(now(), 'UTC')) - interval 6 month
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

INSERT INTO "metrics"."metricVersion" (
  "id", "metricId", "version", "businessDefinition", "normalizationPolicy",
  "computation", "verificationPolicy", "cadence", "contentHash", "createdBy", "createdAt"
)
SELECT
  'atlas-metric-version-marketing-website-visitors-v3',
  md."id",
  3,
  '{"entity":"PostHog person","measure":"monthly unique public marketing visitor","scope":"approved public Sync Marketing pages","identityRule":"Count one PostHog person once per UTC month.","excludedRoutes":["/home","/login","/signup","/onboarding","/billing","/projects","/settings"]}'::jsonb,
  '{"timeZone":"UTC","grain":"MONTH","identity":"posthog_person_id","currentState":"pending_marketing_pageview_coverage"}'::jsonb,
  '{"currentOperation":"count distinct person_id by month after the approved public marketing path filter","knownMismatch":"PostHog pageview coverage for blog and docs is not yet complete enough for certification."}'::jsonb,
  '{"requiredChecks":["read_only_query","source_snapshot","result_non_empty","approved_marketing_scope","complete_marketing_pageview_coverage"],"tolerance":0}'::jsonb,
  '{"everyMinutes":480,"timeZone":"UTC","queryWindow":"six completed months plus current month to date"}'::jsonb,
  'marketing.website_visitors.v3.posthog_public_person',
  'atlas',
  CURRENT_TIMESTAMP
FROM "metrics"."metricDefinition" md
WHERE md."key" = 'marketing.website_visitors'
ON CONFLICT ("metricId", "version") DO NOTHING;

INSERT INTO "metrics"."metricInput" (
  "id", "metricVersionId", "datasetId", "alias", "required", "queryLanguage",
  "queryText", "queryHash", "expectedGrain", "maxLagSeconds", "createdAt"
)
SELECT
  'atlas-metric-input-marketing-website-visitors-v3',
  mv."id",
  ds."id",
  'posthog_public_marketing_visitors',
  true,
  qv."queryLanguage",
  qv."queryText",
  'marketing.website_visitors.query.v3.posthog_public_person',
  'MONTH',
  43200,
  CURRENT_TIMESTAMP
FROM "metrics"."metricVersion" mv
JOIN "metrics"."metricDefinition" md ON md."id" = mv."metricId"
JOIN "ingestion"."dataset" ds ON ds."key" = 'marketing.posthog.website_visitors'
JOIN "question" q ON q."number" = 2001
JOIN LATERAL (
  SELECT "queryLanguage", "queryText"
  FROM "questionVersion"
  WHERE "questionId" = q."id" AND "version" = 4
) qv ON true
WHERE md."key" = 'marketing.website_visitors' AND mv."version" = 3
ON CONFLICT ("metricVersionId", "alias") DO NOTHING;

UPDATE "metrics"."metricDefinition"
SET
  "description" = 'Monthly distinct PostHog people who visit approved public Sync Marketing pages. Product-app and direct-auth routes are excluded. The result remains provisional until all approved public surfaces have complete PostHog pageview coverage.',
  "status" = 'DRAFT',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'marketing.website_visitors';

UPDATE "question"
SET
  "metricVersionId" = 'atlas-metric-version-marketing-website-visitors-v3',
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 2001;

COMMIT;
