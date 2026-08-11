UPDATE "dashboardTab"
SET "name" = 'Billing version economics'
WHERE "id" = 'atlas-product-tab-billing-operations';

DELETE FROM "dashboardCard"
WHERE "id" IN (
  'atlas-product-card-v3-plan-mix',
  'atlas-product-card-billing-paid-rate'
);

UPDATE "dashboardCard"
SET "y" = "y" - 6,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "tabId" = 'atlas-product-tab-billing-operations';

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1;
