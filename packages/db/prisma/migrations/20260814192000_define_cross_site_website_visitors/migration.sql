INSERT INTO "metrics"."metricVersion" (
  "id", "metricId", "version", "businessDefinition", "normalizationPolicy",
  "computation", "verificationPolicy", "cadence", "contentHash", "createdBy", "createdAt"
)
SELECT
  'atlas-metric-version-marketing-website-visitors-v2',
  "id",
  2,
  '{"entity":"person","measure":"monthly website visitor","scope":"configured Sync sites","identityRule":"Count one person once across Sync sites whenever a stable shared identity is available.","anonymousRule":"Do not guess that separate anonymous identifiers are the same person."}'::jsonb,
  '{"timeZone":"UTC","grain":"MONTH","identity":"shared_person_id","currentState":"pending_identity_bridge"}'::jsonb,
  '{"currentOperation":"sum GA4 totalUsers by property and month","targetOperation":"count distinct shared person_id by month across all configured Sync sites","knownMismatch":"The current property totals can count the same person more than once."}'::jsonb,
  '{"requiredChecks":["read_only_query","source_snapshot","result_non_empty","approved_cross_property_definition","cross_site_identity_bridge"],"tolerance":0}'::jsonb,
  '{"everyMinutes":480,"timeZone":"UTC","queryWindow":"six completed months plus current month to date"}'::jsonb,
  'marketing.website_visitors.v2.cross_site_person',
  'atlas',
  CURRENT_TIMESTAMP
FROM "metrics"."metricDefinition"
WHERE "key" = 'marketing.website_visitors'
ON CONFLICT ("metricId", "version") DO NOTHING;

INSERT INTO "metrics"."metricInput" (
  "id", "metricVersionId", "datasetId", "alias", "required", "queryLanguage",
  "queryText", "queryHash", "expectedGrain", "maxLagSeconds", "createdAt"
)
SELECT
  'atlas-metric-input-marketing-website-visitors-v2',
  mv."id",
  ds."id",
  'property_scoped_visitors',
  true,
  qv."queryLanguage",
  qv."queryText",
  'marketing.website_visitors.query.v2.property_sum_pending_identity',
  'MONTH',
  43200,
  CURRENT_TIMESTAMP
FROM "metrics"."metricVersion" mv
JOIN "metrics"."metricDefinition" md ON md."id" = mv."metricId"
JOIN "ingestion"."dataset" ds ON ds."key" = 'marketing.ga4.website_visitors'
JOIN "question" q ON q."number" = 2001
JOIN LATERAL (
  SELECT "queryLanguage", "queryText"
  FROM "questionVersion"
  WHERE "questionId" = q."id"
  ORDER BY "version" DESC
  LIMIT 1
) qv ON true
WHERE md."key" = 'marketing.website_visitors' AND mv."version" = 2
ON CONFLICT ("metricVersionId", "alias") DO NOTHING;

UPDATE "question"
SET
  "metricVersionId" = 'atlas-metric-version-marketing-website-visitors-v2',
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 2001;

UPDATE "metrics"."metricDefinition"
SET
  "description" = 'Monthly people who visit Sync sites, deduplicated across sites whenever Atlas has a stable shared identity. The current GA4 property sum remains provisional until the identity bridge is connected.',
  "status" = 'DRAFT',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'marketing.website_visitors';
