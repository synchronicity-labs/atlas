INSERT INTO "ingestion"."dataset" (
  "id", "sourceId", "key", "label", "description", "adapter",
  "eventTimeField", "watermarkField", "cadenceMinutes", "freshnessSlaMinutes",
  "backfillWindowDays", "config", "enabled", "createdAt", "updatedAt"
)
SELECT
  'atlas-marketing-dataset-ga4-visitors', "id", 'marketing.ga4.website_visitors',
  'GA4 website visitors',
  'Monthly GA4 totalUsers summed across configured Sync web properties.',
  'marketing-ga4', 'month', NULL, 480, 720, 210,
  '{"properties":["landing","blog","playground","docs","lipsync","support"],"merge":"sum"}'::jsonb,
  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "dataSource"
WHERE "key" = 'atlas:marketing'
ON CONFLICT ("sourceId", "key") DO NOTHING;

INSERT INTO "metrics"."metricDefinition" (
  "id", "key", "name", "description", "ownerTeam", "status", "createdAt", "updatedAt"
) VALUES (
  'atlas-metric-marketing-website-visitors',
  'marketing.website_visitors',
  'Website visitors',
  'GA4 total users summed across configured Sync web properties. This is not a deduplicated count of people across sites.',
  'Marketing',
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
  'atlas-metric-version-marketing-website-visitors-v1',
  "id",
  1,
  '{"entity":"GA4 property user","measure":"totalUsers","scope":"configured Sync web properties","warning":"People who visit more than one property can be counted more than once."}'::jsonb,
  '{"timeZone":"UTC","grain":"MONTH","merge":"sum_by_month","identity":"property_scoped_not_cross_property_deduplicated"}'::jsonb,
  '{"operation":"sum","measure":"totalUsers","groupBy":["yearMonth"],"properties":["landing","blog","playground","docs","lipsync","support"]}'::jsonb,
  '{"requiredChecks":["read_only_query","source_snapshot","result_non_empty","approved_cross_property_definition"],"tolerance":0}'::jsonb,
  '{"everyMinutes":480,"timeZone":"UTC","workbookRequestedCadence":"weekly","queryWindow":"six completed months plus current month to date"}'::jsonb,
  'marketing.website_visitors.v1',
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
  'atlas-metric-input-marketing-website-visitors-v1',
  mv."id",
  ds."id",
  'ga4_total_users',
  true,
  qv."queryLanguage",
  qv."queryText",
  'marketing.website_visitors.query.v1',
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
WHERE md."key" = 'marketing.website_visitors' AND mv."version" = 1
ON CONFLICT ("metricVersionId", "alias") DO NOTHING;

UPDATE "question"
SET
  "metricVersionId" = 'atlas-metric-version-marketing-website-visitors-v1',
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 2001;

UPDATE "metrics"."metricCatalogEntry"
SET
  "metricId" = 'atlas-metric-marketing-website-visitors',
  "readiness" = 'IMPLEMENTING',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE lower("title") = 'website visitors' AND "missingAt" IS NULL;

UPDATE "metrics"."metricCatalogEntry"
SET "readiness" = 'NEEDS_SOURCE', "updatedAt" = CURRENT_TIMESTAMP
WHERE lower("title") IN (
  'net burn + runway',
  'enterprise inbound volume',
  'social media growth'
) AND "missingAt" IS NULL;
