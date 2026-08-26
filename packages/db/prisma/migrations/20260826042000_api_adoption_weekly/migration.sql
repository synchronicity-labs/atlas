INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-api-operations-source',
  'atlas:api-operations',
  'ATLAS',
  'Product and BetterStack public API operations',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "question"
SET
  "name" = 'Public API adoption and accrued usage',
  "description" = 'Two complete UTC weeks of public API TTS, API asset uploads, and generations from API-uploaded assets. API-key owners are resolved before aggregation. Revenue is accrued usage value, not cash.',
  "connector" = 'ATLAS',
  "sourceId" = 'atlas-api-operations-source',
  "sourceExternalId" = 'cron:api-endpoints:adoption-revenue',
  "sourceDashboardExternalId" = 'atlas:product:api',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-api-adoption';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-api-adoption-v2',
  'atlas-cron-question-api-adoption',
  2,
  'API',
  '{"source":"api_adoption","report":"weekly-adoption","version":1}',
  'table',
  '{"columns":["week_start","endpoint","requests","successful_jobs","failed_jobs","active_organizations","active_api_keys","usage_amount","accrued_usage_usd","principal_coverage_pct","data_through"]}'::jsonb,
  NULL,
  'atlas-api-adoption-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "sourceCardExternalId" = EXCLUDED."sourceCardExternalId",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-product-tab-api-operations',
  (SELECT "id" FROM "dashboard" WHERE "number" = 1),
  9,
  'API operations',
  8,
  'atlas:product:api'
)
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-product-card-api-adoption',
  (SELECT "id" FROM "dashboard" WHERE "number" = 1),
  (
    SELECT "id"
    FROM "dashboardTab"
    WHERE "dashboardId" = (SELECT "id" FROM "dashboard" WHERE "number" = 1)
      AND "number" = 9
  ),
  'atlas-cron-question-api-adoption',
  0,
  0,
  0,
  24,
  14,
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
