INSERT INTO "questionVersion" (
  "id",
  "questionId",
  "version",
  "queryLanguage",
  "queryText",
  "display",
  "visualization",
  "sourceCardExternalId",
  "createdBy",
  "createdAt"
)
SELECT
  'atlas-product-analytics-failure-rejection-v3',
  "questionId",
  3,
  "queryLanguage",
  replace(
    replace(
      "queryText",
      'OVER population',
      'OVER (PARTITION BY period_start, model, surface, app_mode, workflow, generation_position, organization_segment, billing_version)'
    ),
    E'\n  WINDOW population AS (\n    PARTITION BY period_start, model, surface, app_mode, workflow, generation_position, organization_segment, billing_version\n  )',
    ''
  ),
  "display",
  "visualization",
  "sourceCardExternalId",
  'atlas-product-analytics-materialization',
  CURRENT_TIMESTAMP
FROM "questionVersion"
WHERE "id" = 'atlas-product-analytics-failure-rejection-v2';
