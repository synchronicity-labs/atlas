UPDATE "question"
SET
  "name" = 'Adobe plugin adoption, retention, and NPS',
  "description" = 'Complete UTC-week Adobe Premiere plugin installs, activation, mature recurring retention, post-generation actions, and de-identified NPS aggregates. Each rate includes its numerator and denominator. Raw NPS comments remain outside the governed result.',
  "connector" = 'ATLAS',
  "sourceId" = 'atlas-marketing-source',
  "sourceExternalId" = 'cron:adobe-plugin:weekly-kpis',
  "sourceDashboardExternalId" = 'atlas:product:adobe-plugin',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-adobe-plugin-pack';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-adobe-plugin-pack-v2',
  'atlas-cron-question-adobe-plugin-pack',
  2,
  'API',
  '{"source":"adobe_plugin","report":"weekly-kpis","version":1}',
  'table',
  '{"columns":["section","period_start","metric","dimension","numerator","denominator","value","rate_pct","data_through"]}'::jsonb,
  NULL,
  'atlas-adobe-plugin-registry',
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
  'atlas-marketing-card-adobe-plugin-kpis',
  'atlas-marketing-dashboard',
  'atlas-marketing-tab-acquisition',
  'atlas-cron-question-adobe-plugin-pack',
  8,
  0,
  24,
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
