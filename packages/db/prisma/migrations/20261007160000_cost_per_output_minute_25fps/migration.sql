UPDATE "question"
SET "name" = 'Cost per 25 fps output minute by model',
    "description" = 'Aggregate mapped Modal cost divided by completed, non-deleted output minutes at the product 25 fps convention. Periods without a matching Modal export use the available per-model cost-per-minute rate and are marked as estimates.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-economics-question-cost-per-minute';

WITH next_version AS (
  SELECT
    q."id" AS "questionId",
    COALESCE(MAX(v."version"), 0) + 1 AS "version"
  FROM "question" q
  LEFT JOIN "questionVersion" v ON v."questionId" = q."id"
  WHERE q."id" = 'atlas-economics-question-cost-per-minute'
  GROUP BY q."id"
)
INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
)
SELECT
  'atlas-economics-version-cost-per-minute-v' || "version",
  "questionId",
  "version",
  'API',
  '{"source":"atlas_economics","report":"cost-per-minute","months":7,"definitionVersion":"inference-economics-v2"}',
  'table',
  '{"column_settings":{"[\"name\",\"modal_cost_usd\"]":{"column_title":"Modal cost (USD)","decimals":2,"number_style":"number","suffix":" USD"},"[\"name\",\"output_minutes\"]":{"column_title":"Completed output minutes (25 fps equivalent)","decimals":1,"number_style":"number"},"[\"name\",\"cost_per_output_minute_usd\"]":{"column_title":"Cost per output minute (25 fps equivalent) (USD)","decimals":4,"number_style":"number","suffix":" USD/min"}},"visibleRows":"all"}'::jsonb,
  'atlas', CURRENT_TIMESTAMP
FROM next_version;

UPDATE "dashboard"
SET "description" = 'Usage revenue, production inference cost, model mix, cost per completed output minute at the product 25 fps convention by model, and an explicitly scoped inference contribution margin from canonical TinyBird usage, completed outputs, and aggregate Modal billing.',
    "layoutVersion" = "layoutVersion" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-economics-dashboard';
