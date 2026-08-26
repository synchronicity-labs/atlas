UPDATE "question"
SET
  "name" = 'Public API endpoint reliability',
  "description" = 'Two complete UTC weeks of production API requests, latency, and classified 4xx and 5xx errors. All traffic and API-key traffic remain separate.',
  "connector" = 'ATLAS',
  "sourceId" = 'atlas-api-operations-source',
  "sourceExternalId" = 'cron:api-endpoints:reliability',
  "sourceDashboardExternalId" = 'atlas:product:api',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-api-reliability';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-api-reliability-v2',
  'atlas-cron-question-api-reliability',
  2,
  'API',
  '{"source":"api_reliability","report":"weekly-reliability","version":1}',
  'table',
  '{"columns":["week_start","endpoint","traffic_scope","requests","errors","client_errors","server_errors","error_rate_pct","p50_latency_ms","p95_latency_ms","top_error_class","asset_patch_5xx","asset_project_not_found_422","asset_auth_abuse_errors","tts_voice_errors","invalid_asset_generation_errors","cors_5xx","data_through"]}'::jsonb,
  NULL,
  'atlas-api-reliability-registry',
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
  'atlas-product-card-api-reliability',
  (SELECT "id" FROM "dashboard" WHERE "number" = 1),
  (
    SELECT "id"
    FROM "dashboardTab"
    WHERE "dashboardId" = (SELECT "id" FROM "dashboard" WHERE "number" = 1)
      AND "number" = 9
  ),
  'atlas-cron-question-api-reliability',
  1,
  0,
  14,
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
