CREATE TABLE "gbrainModelFeedbackSnapshot" (
  "id" TEXT NOT NULL,
  "weekStart" TIMESTAMP(3) NOT NULL,
  "dataThrough" TIMESTAMP(3) NOT NULL,
  "sourceItemCount" INTEGER NOT NULL,
  "rows" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gbrainModelFeedbackSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gbrainModelFeedbackSnapshot_weekStart_contentHash_key"
ON "gbrainModelFeedbackSnapshot"("weekStart", "contentHash");

CREATE INDEX "gbrainModelFeedbackSnapshot_weekStart_capturedAt_idx"
ON "gbrainModelFeedbackSnapshot"("weekStart", "capturedAt");

INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-model-feedback-source',
  'atlas:model-feedback-composite',
  'ATLAS',
  'Product feedback and deidentified gBrain evidence',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "question"
SET
  "name" = 'Model feedback and support quality coverage',
  "description" = 'One complete Monday-Sunday UTC week of product feedback coverage by model plus deidentified support-negative theme counts from gBrain. The two instruments stay separate.',
  "connector" = 'ATLAS',
  "sourceId" = (
    SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:model-feedback-composite'
  ),
  "sourceExternalId" = 'cron:model-feedback:weekly-coverage',
  "sourceDashboardExternalId" = 'atlas:product:model-feedback',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-model-feedback';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-model-feedback-v2',
  'atlas-cron-question-model-feedback',
  2,
  'API',
  '{"source":"model_feedback","report":"weekly-coverage","version":1}',
  'table',
  '{"columns":["week_start","surface","model","completed_generations","rated_generations","feedback_events","positive_feedback","negative_feedback","negative_rate_pct","coverage_pct","support_negative_tickets","support_theme","support_source_items","data_through"]}'::jsonb,
  NULL,
  'atlas-model-feedback-registry',
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
  'atlas-product-tab-model-feedback',
  (SELECT "id" FROM "dashboard" WHERE "number" = 1),
  10,
  'Model feedback',
  9,
  'atlas:product:model-feedback'
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
  'atlas-product-card-model-feedback',
  (SELECT "id" FROM "dashboard" WHERE "number" = 1),
  (
    SELECT "id"
    FROM "dashboardTab"
    WHERE "dashboardId" = (SELECT "id" FROM "dashboard" WHERE "number" = 1)
      AND "number" = 10
  ),
  'atlas-cron-question-model-feedback',
  0,
  0,
  0,
  24,
  14,
  'TABLE',
  '{"compact":true,"separateSurfaces":true}'::jsonb,
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
