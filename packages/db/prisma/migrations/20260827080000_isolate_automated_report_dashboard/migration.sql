UPDATE "dashboard"
SET "number" = 17, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-automated-report-dashboard' AND "number" = 13;

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-automated-report-dashboard', 17, 'Automated governed reports',
  'Reviewed Atlas recipes created for recurring reports.', 1, 'atlas-authoring',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-automated-report-tab', 'atlas-automated-report-dashboard', 1,
  'Recurring reports', 0, 'atlas:automated-reports'
)
ON CONFLICT ("id") DO UPDATE SET
  "dashboardId" = EXCLUDED."dashboardId",
  "number" = EXCLUDED."number",
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

UPDATE "dashboardCard" AS card
SET "dashboardId" = 'atlas-automated-report-dashboard',
    "tabId" = 'atlas-automated-report-tab',
    "updatedAt" = CURRENT_TIMESTAMP
FROM "question" AS question, "dataSource" AS source
WHERE card."questionId" = question."id"
  AND question."sourceId" = source."id"
  AND source."key" = 'atlas:automated-reports';

UPDATE "dashboard"
SET "name" = 'Contract Reconciliation',
    "description" = 'Current enterprise contract price differences, agreement and account gaps, open reconciliation findings, customer coverage, and Drive ingestion health.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-contract-reconciliation-dashboard';

UPDATE "dashboardTab"
SET "name" = 'Finance review', "sourceExternalId" = 'atlas:contracts:finance'
WHERE "id" = 'atlas-contract-reconciliation-tab-finance';
