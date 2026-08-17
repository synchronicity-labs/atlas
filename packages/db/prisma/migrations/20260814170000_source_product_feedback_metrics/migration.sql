INSERT INTO "ingestion"."dataset" (
  "id", "sourceId", "key", "label", "description", "adapter",
  "eventTimeField", "watermarkField", "cadenceMinutes", "freshnessSlaMinutes",
  "backfillWindowDays", "config", "enabled", "createdAt", "updatedAt"
)
SELECT
  'atlas-product-feedback-sentiment', "id", 'product.feedback.sentiment',
  'Product generation sentiment',
  'Weekly positive feedback share from rated generation events.',
  'metabase-card', 'week_start', NULL, 480, 720, 210,
  '{"questionNumber":42,"breakdowns":["model","workflow"]}'::jsonb,
  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "dataSource"
WHERE "key" = 'metabase:sync'
ON CONFLICT ("sourceId", "key") DO NOTHING;

INSERT INTO "ingestion"."dataset" (
  "id", "sourceId", "key", "label", "description", "adapter",
  "eventTimeField", "watermarkField", "cadenceMinutes", "freshnessSlaMinutes",
  "backfillWindowDays", "config", "enabled", "createdAt", "updatedAt"
)
SELECT
  'atlas-product-feedback-coverage', "id", 'product.feedback.coverage',
  'Product feedback coverage',
  'Weekly rated-generation coverage across completed app generations.',
  'metabase-card', 'week_start', NULL, 480, 720, 210,
  '{"questionNumber":39,"breakdowns":["workflow","model"]}'::jsonb,
  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "dataSource"
WHERE "key" = 'metabase:sync'
ON CONFLICT ("sourceId", "key") DO NOTHING;

INSERT INTO "metrics"."metricDefinition" (
  "id", "key", "name", "description", "ownerTeam", "status", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-metric-product-generation-upvote-rate',
    'product.generation_upvote_rate',
    'Generation upvote rate',
    'Positive ratings divided by all rated generations, with model and workflow breakdowns.',
    'Engineering',
    'DRAFT',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-metric-product-feedback-coverage-rate',
    'product.feedback_coverage_rate',
    'Feedback coverage rate',
    'Rated completed app generations divided by completed app generations.',
    'Engineering',
    'DRAFT',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "ownerTeam" = EXCLUDED."ownerTeam",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "metrics"."metricVersion" (
  "id", "metricId", "version", "businessDefinition", "normalizationPolicy",
  "computation", "verificationPolicy", "cadence", "contentHash", "createdBy", "createdAt"
)
SELECT
  'atlas-metric-version-product-generation-upvote-rate-v1',
  "id",
  1,
  '{"entity":"generation","numerator":"positive rated generations","denominator":"all rated generations","breakdowns":["model","workflow"]}'::jsonb,
  '{"timeZone":"UTC","grain":"WEEK","eligibility":"rated generations only","rounding":"sum before display rounding"}'::jsonb,
  '{"operation":"ratio","numerator":"positive_rated_generations","denominator":"rated_generations"}'::jsonb,
  '{"requiredChecks":["read_only_query","source_snapshot","denominator_positive","rate_between_zero_and_one","approved_rating_definition"],"tolerance":0}'::jsonb,
  '{"everyMinutes":480,"timeZone":"UTC","queryWindow":"six completed months plus current week to date"}'::jsonb,
  'product.generation_upvote_rate.v1',
  'atlas',
  CURRENT_TIMESTAMP
FROM "metrics"."metricDefinition"
WHERE "key" = 'product.generation_upvote_rate'
ON CONFLICT ("metricId", "version") DO NOTHING;

INSERT INTO "metrics"."metricVersion" (
  "id", "metricId", "version", "businessDefinition", "normalizationPolicy",
  "computation", "verificationPolicy", "cadence", "contentHash", "createdBy", "createdAt"
)
SELECT
  'atlas-metric-version-product-feedback-coverage-rate-v1',
  "id",
  1,
  '{"entity":"completed app generation","numerator":"rated completed app generations","denominator":"completed app generations","breakdowns":["workflow","model"]}'::jsonb,
  '{"timeZone":"UTC","grain":"WEEK","surface":"apps","rounding":"sum before display rounding"}'::jsonb,
  '{"operation":"ratio","numerator":"rated_completed_generations","denominator":"completed_app_generations"}'::jsonb,
  '{"requiredChecks":["read_only_query","source_snapshot","denominator_positive","rate_between_zero_and_one","approved_completed_status"],"tolerance":0}'::jsonb,
  '{"everyMinutes":480,"timeZone":"UTC","queryWindow":"six completed months plus current week to date"}'::jsonb,
  'product.feedback_coverage_rate.v1',
  'atlas',
  CURRENT_TIMESTAMP
FROM "metrics"."metricDefinition"
WHERE "key" = 'product.feedback_coverage_rate'
ON CONFLICT ("metricId", "version") DO NOTHING;

INSERT INTO "metrics"."metricInput" (
  "id", "metricVersionId", "datasetId", "alias", "required", "queryLanguage",
  "queryText", "queryHash", "expectedGrain", "maxLagSeconds", "createdAt"
)
SELECT
  'atlas-metric-input-product-generation-upvote-rate-v1',
  mv."id",
  ds."id",
  'generation_sentiment',
  true,
  qv."queryLanguage",
  qv."queryText",
  'product.generation_upvote_rate.query.v1',
  'WEEK',
  43200,
  CURRENT_TIMESTAMP
FROM "metrics"."metricVersion" mv
JOIN "metrics"."metricDefinition" md ON md."id" = mv."metricId"
JOIN "ingestion"."dataset" ds ON ds."key" = 'product.feedback.sentiment'
JOIN "question" q ON q."number" = 42
JOIN LATERAL (
  SELECT "queryLanguage", "queryText"
  FROM "questionVersion"
  WHERE "questionId" = q."id"
  ORDER BY "version" DESC
  LIMIT 1
) qv ON true
WHERE md."key" = 'product.generation_upvote_rate' AND mv."version" = 1
ON CONFLICT ("metricVersionId", "alias") DO NOTHING;

INSERT INTO "metrics"."metricInput" (
  "id", "metricVersionId", "datasetId", "alias", "required", "queryLanguage",
  "queryText", "queryHash", "expectedGrain", "maxLagSeconds", "createdAt"
)
SELECT
  'atlas-metric-input-product-feedback-coverage-rate-v1',
  mv."id",
  ds."id",
  'feedback_coverage',
  true,
  qv."queryLanguage",
  qv."queryText",
  'product.feedback_coverage_rate.query.v1',
  'WEEK',
  43200,
  CURRENT_TIMESTAMP
FROM "metrics"."metricVersion" mv
JOIN "metrics"."metricDefinition" md ON md."id" = mv."metricId"
JOIN "ingestion"."dataset" ds ON ds."key" = 'product.feedback.coverage'
JOIN "question" q ON q."number" = 39
JOIN LATERAL (
  SELECT "queryLanguage", "queryText"
  FROM "questionVersion"
  WHERE "questionId" = q."id"
  ORDER BY "version" DESC
  LIMIT 1
) qv ON true
WHERE md."key" = 'product.feedback_coverage_rate' AND mv."version" = 1
ON CONFLICT ("metricVersionId", "alias") DO NOTHING;

UPDATE "question"
SET
  "metricVersionId" = 'atlas-metric-version-product-generation-upvote-rate-v1',
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 42;

UPDATE "question"
SET
  "metricVersionId" = 'atlas-metric-version-product-feedback-coverage-rate-v1',
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 39;

UPDATE "metrics"."metricCatalogEntry"
SET
  "metricId" = 'atlas-metric-product-generation-upvote-rate',
  "readiness" = 'IMPLEMENTING',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE lower("title") LIKE 'generation upvote rate%' AND "missingAt" IS NULL;

UPDATE "metrics"."metricCatalogEntry"
SET
  "metricId" = 'atlas-metric-product-feedback-coverage-rate',
  "readiness" = 'IMPLEMENTING',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE lower("title") = 'feedback coverage rate' AND "missingAt" IS NULL;

UPDATE "metrics"."metricCatalogEntry"
SET "readiness" = 'NEEDS_DEFINITION', "updatedAt" = CURRENT_TIMESTAMP
WHERE "missingAt" IS NULL AND (
  lower("title") IN (
    'sows/ msa''s signed',
    'mql / pql / sql breakdown',
    'new logos closed (by segment)',
    'seo / geo breakdown',
    'enterprise usage',
    'manual health check',
    'failure case – what went wrong?',
    'content type – what kind of workload broke?',
    'pipeline failure – where the failure likely occurred'
  )
);
