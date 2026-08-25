INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-customer-support-dashboard', 12, 'Customer Support',
  'Customer support request volume, issue categories, response and resolution time, Customer Satisfaction, and Remi performance. Atlas stores monthly aggregates only, not ticket text or customer identities.',
  1, 'atlas', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-customer-support-tab-operations',
  'atlas-customer-support-dashboard',
  1,
  'Support operations',
  0,
  'atlas:customer-support:operations'
)
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

UPDATE "dashboardCard"
SET
  "dashboardId" = 'atlas-customer-support-dashboard',
  "tabId" = 'atlas-customer-support-tab-operations',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'atlas-support-card-issue-volume',
  'atlas-support-card-top-categories',
  'atlas-support-card-response-resolution',
  'atlas-support-card-channel-volume',
  'atlas-support-card-csat',
  'atlas-support-card-remi-performance'
);

UPDATE "question"
SET
  "sourceDashboardExternalId" = 'atlas:customer-support:operations',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" BETWEEN 7030 AND 7035;

DELETE FROM "dashboardTab"
WHERE "id" = 'atlas-customer-lifecycle-tab-support';

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" IN (9, 12);
