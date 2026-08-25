INSERT INTO "question" (
  id,
  number,
  name,
  description,
  connector,
  "sourceId",
  "sourceExternalId",
  "sourceDashboardExternalId",
  status,
  purpose,
  "createdAt",
  "updatedAt"
) VALUES (
  'atlas-cron-question-geo-weekly',
  7017,
  'GEO weekly acquisition and paid conversion',
  'Weekly AI-referral and GEO acquisition from referral visit through signup, first successful generation, subscription, and attributed paid revenue. The funnel uses one identity policy and the oldest complete watermark across traffic, product, and billing sources.',
  'ATLAS',
  'atlas-cron-methodology-source',
  'cron:geo:weekly-funnel',
  'atlas:marketing:geo',
  'ACTIVE',
  'RECONCILIATION',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO "questionVersion" (
  id,
  "questionId",
  version,
  "queryLanguage",
  "queryText",
  display,
  visualization,
  "createdBy",
  "createdAt"
) VALUES (
  'atlas-cron-question-geo-weekly-v1',
  'atlas-cron-question-geo-weekly',
  1,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'atlas-cron-methodology',
    'state', 'requires_source_adapter_and_parity',
    'grain', 'WEEK',
    'timeZone', 'UTC',
    'periodBoundaries', 'half_open',
    'watermarkPolicy', 'oldest_complete_required_source',
    'requiredSources', '["ga4:marketing-properties","posthog:attribution","product:subscriptions","tinybird:paid-usage"]'::jsonb,
    'outputs', '["week_start","referrer","visitors","pageviews","signups","first_successful_generations","subscriptions","attributed_paid_revenue","traffic_to_signup_pct","signup_to_paid_pct","attribution_coverage_pct","data_through"]'::jsonb,
    'requiredVerification', '["ai_referrer_registry_review","cross_site_identity_coverage","first_touch_parity","subscription_parity","revenue_door_policy","oldest_complete_watermark"]'::jsonb
  )),
  'table',
  '{}'::jsonb,
  'atlas-cron-migration',
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;
