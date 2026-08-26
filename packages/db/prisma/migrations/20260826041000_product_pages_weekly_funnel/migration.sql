UPDATE "question"
SET
  "name" = 'Product-page acquisition and paid conversion',
  "description" = 'Complete UTC-week traffic and first-touch signup-to-paid conversion for the approved Sync product-page registry. Paid conversion is paid organizations divided by attributed organizations, not a cross-system sessions-to-paid rate.',
  "connector" = 'ATLAS',
  "sourceId" = 'atlas-marketing-source',
  "sourceExternalId" = 'cron:product-pages:weekly-funnel',
  "sourceDashboardExternalId" = 'atlas:marketing:product-pages',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-product-page-funnel';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-product-page-funnel-v2',
  'atlas-cron-question-product-page-funnel',
  2,
  'API',
  '{"source":"product_pages","report":"weekly-funnel","version":1}',
  'table',
  '{"columns":["period_start","page","users","sessions","engagement_rate_pct","signups","attributed_organizations","paid_organizations","subscriptions","paid_conversion_pct","attribution_coverage_pct","data_through"]}'::jsonb,
  NULL,
  'atlas-product-pages-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "sourceCardExternalId" = EXCLUDED."sourceCardExternalId",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-marketing-card-product-pages-funnel',
  'atlas-marketing-dashboard',
  'atlas-marketing-tab-acquisition',
  'atlas-cron-question-product-page-funnel',
  9,
  0,
  36,
  24,
  12,
  'TABLE',
  '{"compact":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "dashboardId" = EXCLUDED."dashboardId",
  "tabId" = EXCLUDED."tabId",
  "questionId" = EXCLUDED."questionId",
  "position" = EXCLUDED."position",
  "x" = EXCLUDED."x",
  "y" = EXCLUDED."y",
  "width" = EXCLUDED."width",
  "height" = EXCLUDED."height",
  "visualization" = EXCLUDED."visualization",
  "displaySettings" = EXCLUDED."displaySettings",
  "updatedAt" = CURRENT_TIMESTAMP;
