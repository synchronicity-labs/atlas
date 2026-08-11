INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
SELECT
  'atlas-economics-version-' || "question"."number"::text || '-v2',
  "question"."id",
  2,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'atlas_economics',
    'report', CASE "question"."number"
      WHEN 5001 THEN 'modal-spend'
      WHEN 5002 THEN 'prod-inference-cost'
      WHEN 5003 THEN 'usage-revenue'
      WHEN 5004 THEN 'margin-pct'
      WHEN 5005 THEN 'margin-history'
      WHEN 5006 THEN 'model-costs'
      WHEN 5007 THEN 'frames-by-tier'
    END,
    'months', 7,
    'definitionVersion', 'inference-economics-v1',
    'warehouseSql', $query$select
  toStartOfMonth("generationEndedAt") as month,
  ifNull(nullIf(model, ''), 'unknown') as model,
  sumIf("frameCount", "organizationPlanType" is null or "organizationPlanType" = '') as free_frames,
  sumIf("frameCount", "organizationPlanType" is not null and "organizationPlanType" <> '') as paid_frames,
  sumIf("generationCostMillicents", "organizationPlanType" is not null and "organizationPlanType" <> '') / 100000.0 as usage_revenue_usd
from sync_prod.sync_usage3
where "generationEndedAt" >= addMonths(toStartOfMonth(today()), -6)
  and "generationEndedAt" < now()
group by month, model
order by month, model$query$
  )),
  "latest"."display",
  "latest"."visualization",
  NULL,
  'atlas',
  CURRENT_TIMESTAMP
FROM "question"
JOIN "questionVersion" AS "latest"
  ON "latest"."questionId" = "question"."id"
  AND "latest"."version" = 1
WHERE "question"."number" BETWEEN 5001 AND 5007;
