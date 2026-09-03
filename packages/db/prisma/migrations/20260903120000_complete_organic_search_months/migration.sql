UPDATE "question"
SET
  "description" = 'Google Search Console clicks and impressions for sync.so during each of the six latest complete UTC months. The current partial month is excluded.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-question-search-history';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES (
  'atlas-marketing-version-search-history-v3',
  'atlas-marketing-question-search-history',
  3,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'search_console',
    'site', 'sync',
    'dateRange', '6_months_and_mtd',
    'completeMonthsOnly', true,
    'dimensions', jsonb_build_array('date'),
    'aggregate', 'month',
    'metrics', jsonb_build_array('clicks', 'impressions'),
    'limit', 25000
  )),
  'line',
  '{"graph.dimensions":["month"],"graph.metrics":["clicks","impressions"]}'::jsonb,
  'atlas',
  CURRENT_TIMESTAMP
);
