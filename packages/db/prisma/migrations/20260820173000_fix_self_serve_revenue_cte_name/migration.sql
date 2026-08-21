UPDATE "questionVersion"
SET "queryText" = replace("queryText", 'values', 'revenue_values')
WHERE "id" IN (
  'atlas-weekly-revenue-version-run-rate-v4',
  'atlas-weekly-revenue-version-variable-run-rate-v1'
);
