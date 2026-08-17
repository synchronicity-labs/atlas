UPDATE "metrics"."metricCatalogEntry"
SET "readiness" = 'NEEDS_EVIDENCE', "updatedAt" = CURRENT_TIMESTAMP
WHERE "kind" = 'ROADMAP_MEASURE'
  AND "readiness" = 'NEEDS_SOURCE'
  AND "missingAt" IS NULL;
