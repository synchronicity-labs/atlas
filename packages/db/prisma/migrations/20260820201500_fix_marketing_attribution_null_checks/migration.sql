INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  (
    'atlas-marketing-version-attribution-coverage-v2',
    'atlas-marketing-question-attribution-coverage',
    2,
    'API',
    jsonb_pretty(jsonb_build_object(
      'source', 'posthog',
      'query', $hog$select
  toStartOfMonth(timestamp) as month,
  uniq(person_id) as total_signups,
  uniqIf(person_id, properties.source is not null and length(toString(properties.source)) > 0) as captured_signups,
  round(uniqIf(person_id, properties.source is not null and length(toString(properties.source)) > 0) / nullIf(uniq(person_id), 0) * 100, 2) as coverage_pct,
  uniqIf(person_id, lower(toString(properties.source)) = 'direct') as direct_signups,
  uniqIf(person_id, properties.source is null or length(toString(properties.source)) = 0) as missing_signups
from events
where event = 'user_signed_up'
  and timestamp >= toStartOfMonth(now() - interval 6 month)
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
    'atlas-marketing-version-attribution-campaigns-v2',
    'atlas-marketing-question-attribution-campaigns',
    2,
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
  and properties.utm_campaign is not null
  and length(toString(properties.utm_campaign)) > 0
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
    'atlas-marketing-version-attribution-ctas-v2',
    'atlas-marketing-question-attribution-ctas',
    2,
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
  and properties.cta_label is not null
  and length(toString(properties.cta_label)) > 0
  and {{atlas_product_user_eligible}}
group by converting_cta, cta_page
order by signups desc
limit 50$hog$
    )),
    'table',
    '{}'::jsonb,
    'atlas',
    CURRENT_TIMESTAMP
  );

UPDATE "question"
SET
  "description" = 'Monthly eligible product signups with a first-touch source captured at signup by sync.so/s/boot.js or the matching product implementation. Direct is a captured visit with no external source. Missing means no attribution reached the signup event.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-question-attribution-coverage';
