INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-product-eligibility-source',
  'atlas:product-eligibility',
  'ATLAS',
  'Atlas product eligibility join',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "kind" = EXCLUDED."kind",
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "status", "purpose", "createdAt", "updatedAt"
) SELECT
  'atlas-product-question-qualified-then-deleted',
  6001,
  'Professional orgs with a user who deleted their account after qualifying',
  'Six complete UTC months. Counts professional organizations that met the full monthly professional threshold before an eligible contributing user initiated account deletion. Deleted organizations remain in the historical professional KPI.',
  'ATLAS',
  "dataSource"."id",
  'atlas:product:qualified-then-deleted',
  'ACTIVE',
  'CERTIFIED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "dataSource"
WHERE "dataSource"."key" = 'atlas:product-eligibility'
ON CONFLICT ("number") DO NOTHING;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES (
  'atlas-product-version-qualified-then-deleted-v1',
  'atlas-product-question-qualified-then-deleted',
  1,
  'API',
  '{"source":"atlas-product-eligibility","report":"qualified-then-deleted","months":6,"timeZone":"UTC"}',
  'bar',
  '{"periodLabel":"Last 6 complete UTC months"}'::jsonb,
  'atlas',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
)
SELECT
  'atlas-product-card-qualified-then-deleted',
  dashboard."id",
  tab."id",
  question."id",
  23,
  0,
  28,
  12,
  8,
  'BAR',
  '{"periodLabel":"Last 6 complete UTC months"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "dashboard" AS dashboard
JOIN "dashboardTab" AS tab
  ON tab."dashboardId" = dashboard."id" AND tab."number" = 1
JOIN "question" AS question
  ON question."number" = 6001
WHERE dashboard."number" = 1
ON CONFLICT ("id") DO NOTHING;

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1;
