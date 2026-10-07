UPDATE "question"
SET "name" = 'Average cost per 25 fps output minute by model',
    "description" = 'Average mapped Modal cost per completed, non-deleted output minute at the product 25 fps convention by model and month. Modal cost is shown when an aggregate import exists; periods without one use the available per-model rate and are marked as estimates.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-economics-question-cost-per-minute';

UPDATE "dashboardCard"
SET "visualization" = 'BAR',
    "displaySettings" = '{"timeframe":"Previous 6 calendar months + current MTD · UTC","graph.dimensions":["month","model"],"graph.metrics":["cost_per_output_minute_usd"],"graph.status":"cost_status","column_settings":{"[\"name\",\"cost_per_output_minute_usd\"]":{"column_title":"Average cost per 25 fps output minute","decimals":2,"number_style":"currency","suffix":" USD/min"},"[\"name\",\"modal_cost_usd\"]":{"column_title":"Modal cost (actual import)","decimals":2,"number_style":"currency","suffix":" USD"},"[\"name\",\"output_minutes\"]":{"column_title":"Completed output minutes (25 fps equivalent)","decimals":1,"number_style":"number"}}}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-economics-card-cost-per-minute';

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "createdAt", "updatedAt"
)
SELECT
  'atlas-economics-question-output-minutes', COALESCE(
    (
      SELECT MIN(candidate)
      FROM generate_series(5008, 9999) AS candidates(candidate)
      WHERE NOT EXISTS (
        SELECT 1 FROM "question" WHERE "question"."number" = candidate
      )
    ),
    (SELECT COALESCE(MAX("number"), 5007) + 1 FROM "question")
  ),
  'Completed output minutes by month',
  'Completed, non-deleted Product output converted to minutes at the product 25 fps convention, grouped by month.',
  'ATLAS', 'atlas-economics-source', 'economics:output-minutes',
  'atlas:economics:overview', '34', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES (
  'atlas-economics-version-output-minutes-v1',
  'atlas-economics-question-output-minutes', 1, 'API',
  '{"source":"atlas_economics","report":"output-minutes","months":7,"definitionVersion":"inference-economics-v2"}',
  'bar',
  '{"column_settings":{"[\"name\",\"output_minutes\"]":{"column_title":"Completed output minutes (25 fps equivalent)","decimals":1,"number_style":"number"}},"visibleRows":"all"}'::jsonb,
  'atlas', CURRENT_TIMESTAMP
);

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES (
  'atlas-economics-card-output-minutes', 'atlas-economics-dashboard',
  'atlas-economics-tab-overview', 'atlas-economics-question-output-minutes',
  8, 0, 33, 24, 8, 'BAR',
  '{"timeframe":"Previous 6 calendar months + current MTD · UTC","graph.dimensions":["month"],"graph.metrics":["output_minutes"],"column_settings":{"[\"name\",\"output_minutes\"]":{"column_title":"Completed output minutes (25 fps equivalent)","decimals":1,"number_style":"number"}}}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES (
  'atlas-economics-card-cost-per-minute-details', 'atlas-economics-dashboard',
  'atlas-economics-tab-overview', 'atlas-economics-question-cost-per-minute',
  9, 0, 41, 24, 10, 'TABLE',
  '{"timeframe":"Cost coverage details · matched Modal imports and estimated periods","visibleRows":"all","column_settings":{"[\"name\",\"month\"]":{"column_title":"Month"},"[\"name\",\"model\"]":{"column_title":"Model"},"[\"name\",\"modal_cost_usd\"]":{"column_title":"Modal cost (actual import)","decimals":2,"number_style":"currency","suffix":" USD"},"[\"name\",\"output_minutes\"]":{"column_title":"Output minutes (25 fps equivalent)","decimals":1,"number_style":"number"},"[\"name\",\"cost_per_output_minute_usd\"]":{"column_title":"Average cost per output minute","decimals":2,"number_style":"currency","suffix":" USD/min"},"[\"name\",\"cost_status\"]":{"column_title":"Coverage"}}}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

UPDATE "dashboard"
SET "description" = 'Average cost per 25 fps output minute by model over time, with coverage details and completed output minutes by month as supporting views, alongside usage revenue, production inference cost, model mix, and contribution margin.',
    "layoutVersion" = "layoutVersion" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-economics-dashboard';
