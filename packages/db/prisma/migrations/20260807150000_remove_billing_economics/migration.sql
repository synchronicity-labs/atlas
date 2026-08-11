DELETE FROM "dashboardTab"
WHERE "id" = 'atlas-product-tab-billing-operations';

UPDATE "question"
SET "status" = 'ARCHIVED',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" BETWEEN 46 AND 53;

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1;
