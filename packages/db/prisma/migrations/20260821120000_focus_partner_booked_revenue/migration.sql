UPDATE "dashboardCard"
SET
  "displaySettings" = COALESCE("displaySettings", '{}'::jsonb)
    || '{"hiddenColumns":["cash_collected"]}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'cmsxi10c200ay05jrjw6np83r',
  'atlas-company-kpis-card-partner-reconciliation'
);
