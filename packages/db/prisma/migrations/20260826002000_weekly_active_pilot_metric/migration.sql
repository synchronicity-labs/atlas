UPDATE "question"
SET
  "connector" = 'HUBSPOT',
  "sourceId" = (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'),
  "sourceExternalId" = 'cron:sales:weekly-active-pilots',
  "sourceDashboardExternalId" = '15158250',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-weekly-active-pilots';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-weekly-active-pilots-v2',
  'atlas-cron-question-weekly-active-pilots',
  2,
  'API',
  '{"source":"hubspot","report":"active-pilot-summary","months":1,"pipelines":["989457121","1984250589"]}',
  'table',
  '{"presentation":"metric-strip","periodLabel":"Current UTC week"}'::jsonb,
  'atlas-sales-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-sales-card-weekly-active-pilots',
  'atlas-sales-dashboard',
  'atlas-sales-tab-overview',
  'atlas-cron-question-weekly-active-pilots',
  6,
  0,
  27,
  24,
  8,
  'TABLE',
  '{"presentation":"metric-strip","periodLabel":"Current UTC week"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "questionId" = EXCLUDED."questionId",
  "position" = EXCLUDED."position",
  "x" = EXCLUDED."x",
  "y" = EXCLUDED."y",
  "width" = EXCLUDED."width",
  "height" = EXCLUDED."height",
  "visualization" = EXCLUDED."visualization",
  "displaySettings" = EXCLUDED."displaySettings",
  "updatedAt" = CURRENT_TIMESTAMP;
