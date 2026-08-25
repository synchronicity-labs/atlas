WITH specs (id, source_external_id) AS (
  VALUES
    ('atlas-cron-question-studio-bookings', 'cron:studio:bookings-pipeline'),
    ('atlas-cron-question-enterprise-pipeline', 'cron:enterprise:bookings-pipeline')
)
UPDATE "question" q
SET
  "connector" = 'HUBSPOT',
  "sourceId" = (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'),
  "sourceExternalId" = specs.source_external_id,
  "sourceDashboardExternalId" = '15158250',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
FROM specs
WHERE q."id" = specs.id;

WITH versions (id, question_id, query_text, visualization) AS (
  VALUES
    (
      'atlas-cron-question-studio-bookings-v2',
      'atlas-cron-question-studio-bookings',
      '{"source":"hubspot","report":"studio-bookings","months":6,"pipelines":["1984250589"]}',
      '{"presentation":"bookings-detail","scope":"crm-closed-won-only"}'::jsonb
    ),
    (
      'atlas-cron-question-enterprise-pipeline-v2',
      'atlas-cron-question-enterprise-pipeline',
      '{"source":"hubspot","report":"enterprise-bookings","months":6,"pipelines":["989457121"]}',
      '{"presentation":"bookings-periods","scope":"crm-amounts-only"}'::jsonb
    )
)
INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
)
SELECT
  versions.id,
  versions.question_id,
  2,
  'API',
  versions.query_text,
  'table',
  versions.visualization,
  'atlas-sales-registry',
  CURRENT_TIMESTAMP
FROM versions
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

WITH cards (id, tab_id, question_id, position, y) AS (
  VALUES
    (
      'atlas-sales-card-studio-bookings',
      'atlas-sales-tab-studios',
      'atlas-cron-question-studio-bookings',
      6,
      23
    ),
    (
      'atlas-sales-card-enterprise-bookings',
      'atlas-sales-tab-enterprise',
      'atlas-cron-question-enterprise-pipeline',
      6,
      23
    )
)
INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
)
SELECT
  cards.id,
  'atlas-sales-dashboard',
  cards.tab_id,
  cards.question_id,
  cards.position,
  0,
  cards.y,
  24,
  10,
  'TABLE',
  '{"scope":"crm-only","contractAndDeliveryFields":"unavailable"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM cards
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
