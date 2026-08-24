UPDATE "dashboardCard"
SET
  "displaySettings" = COALESCE("displaySettings", '{}'::jsonb) || '{"seriesOrder":"total-desc"}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "dashboardId" = (SELECT "id" FROM "dashboard" WHERE "number" = 2)
  AND "questionId" = (SELECT "id" FROM "question" WHERE "number" = 1115);
