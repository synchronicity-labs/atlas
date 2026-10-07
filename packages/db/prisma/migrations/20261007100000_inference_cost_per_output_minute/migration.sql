INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "createdAt", "updatedAt"
)
SELECT
  'atlas-economics-question-cost-per-minute', COALESCE(
    (
      SELECT MIN(candidate)
      FROM generate_series(5008, 9999) AS candidates(candidate)
      WHERE NOT EXISTS (
        SELECT 1 FROM "question" WHERE "question"."number" = candidate
      )
    ),
    (SELECT COALESCE(MAX("number"), 5007) + 1 FROM "question")
  ),
  'Cost per completed output minute by model',
  'Aggregate mapped Modal cost divided by completed, non-deleted output minutes for each model. Periods without a matching Modal export use the available per-model cost-per-minute rate and are marked as estimates.',
  'ATLAS', 'atlas-economics-source', 'economics:cost-per-minute',
  'atlas:economics:overview', '34', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES (
  'atlas-economics-version-cost-per-minute-v1',
  'atlas-economics-question-cost-per-minute', 1, 'API',
  '{"source":"atlas_economics","report":"cost-per-minute","months":7,"definitionVersion":"inference-economics-v1"}',
  'table',
  '{"column_settings":{"[\"name\",\"modal_cost_usd\"]":{"column_title":"Modal cost (USD)","decimals":2,"number_style":"number","suffix":" USD"},"[\"name\",\"output_minutes\"]":{"column_title":"Completed output minutes","decimals":1,"number_style":"number"},"[\"name\",\"cost_per_output_minute_usd\"]":{"column_title":"Cost per output minute (USD)","decimals":4,"number_style":"number","suffix":" USD/min"}},"visibleRows":"all"}'::jsonb,
  'atlas', CURRENT_TIMESTAMP
);

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES (
  'atlas-economics-card-cost-per-minute', 'atlas-economics-dashboard',
  'atlas-economics-tab-overview', 'atlas-economics-question-cost-per-minute',
  7, 0, 23, 24, 10, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1,
    "description" = 'Usage revenue, production inference cost, model mix, cost per completed output minute by model, and an explicitly scoped inference contribution margin from canonical TinyBird usage, completed outputs, and aggregate Modal billing.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-economics-dashboard';
