UPDATE "dashboard"
SET
  "description" = 'Monthly revenue and NDR with two views: the original Rudy close for audit, and a governed sync.tools view that excludes enterprise, program, and channel-partner revenue.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 2;

UPDATE "question"
SET
  "name" = 'Self-serve combined run-rate',
  "description" = 'Self-serve subscription run-rate plus projected current-month usage accrual at one UTC cutoff. Excludes enterprise and program plans, plus channel partners in the governed revenue-door registry.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1102;

UPDATE "question"
SET
  "name" = 'Self-serve usage accrual and MTD pace',
  "description" = 'Completed-month usage accrual plus current-month actual and projected pace, using generationEndedAt in UTC. Excludes enterprise and program plans, plus channel partners in the governed revenue-door registry.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1103;

UPDATE "question"
SET
  "name" = 'Self-serve subscription run-rate by plan',
  "description" = 'Latest active or past-due self-serve Stripe subscriptions multiplied by the current monthly plan price. Excludes enterprise and program plans, plus channel partners in the governed revenue-door registry. This is subscription run-rate, not cash collected.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1104;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-revenue-dashboard-tab-sync-tools',
  (SELECT "id" FROM "dashboard" WHERE "number" = 2),
  2,
  'sync.tools',
  1,
  'atlas:revenue:sync-tools'
)
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-revenue-sync-tools-card-combined',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-tools',
    (SELECT "id" FROM "question" WHERE "number" = 1102),
    0, 0, 0, 24, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-tools-card-usage',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-tools',
    (SELECT "id" FROM "question" WHERE "number" = 1103),
    1, 0, 5, 16, 9, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-revenue-sync-tools-card-subscription',
    (SELECT "id" FROM "dashboard" WHERE "number" = 2),
    'atlas-revenue-dashboard-tab-sync-tools',
    (SELECT "id" FROM "question" WHERE "number" = 1104),
    2, 16, 5, 8, 9, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE SET
  "dashboardId" = EXCLUDED."dashboardId",
  "tabId" = EXCLUDED."tabId",
  "questionId" = EXCLUDED."questionId",
  "position" = EXCLUDED."position",
  "x" = EXCLUDED."x",
  "y" = EXCLUDED."y",
  "width" = EXCLUDED."width",
  "height" = EXCLUDED."height",
  "visualization" = EXCLUDED."visualization",
  "displaySettings" = EXCLUDED."displaySettings",
  "updatedAt" = CURRENT_TIMESTAMP;
