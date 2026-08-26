INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-automated-report-source',
  'atlas:automated-reports',
  'ATLAS',
  'Atlas reviewed automated reports',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "kind" = EXCLUDED."kind",
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-automated-report-dashboard',
  13,
  'Automated governed reports',
  'Reviewed Atlas recipes created for recurring reports.',
  1,
  'atlas-authoring',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-automated-report-tab',
  (SELECT "id" FROM "dashboard" WHERE "number" = 13),
  1,
  'Recurring reports',
  0,
  'atlas:automated-reports'
)
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";
