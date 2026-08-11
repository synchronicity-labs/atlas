UPDATE "dashboardCard"
SET
  "x" = CASE "id"
    WHEN 'atlas-revenue-card-annualized-run-rate' THEN 0
    WHEN 'atlas-revenue-card-paid-usage-organizations' THEN 12
    WHEN 'atlas-revenue-card-ndr-starting-spend' THEN 0
    WHEN 'atlas-revenue-card-ndr-retained-spend' THEN 12
    ELSE "x"
  END,
  "y" = CASE "id"
    WHEN 'atlas-revenue-card-annualized-run-rate' THEN 15
    WHEN 'atlas-revenue-card-paid-usage-organizations' THEN 15
    WHEN 'atlas-revenue-card-ndr-starting-spend' THEN 20
    WHEN 'atlas-revenue-card-ndr-retained-spend' THEN 20
    ELSE "y"
  END,
  "width" = 12,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'atlas-revenue-card-annualized-run-rate',
  'atlas-revenue-card-paid-usage-organizations',
  'atlas-revenue-card-ndr-starting-spend',
  'atlas-revenue-card-ndr-retained-spend'
);

UPDATE "dashboardCard"
SET
  "y" = CASE
    WHEN "id" IN ('atlas-revenue-card-run-rate-history', 'atlas-revenue-card-reconciliation-history') THEN 25
    WHEN "id" = 'atlas-revenue-card-ndr-history' THEN 34
    ELSE "y"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'atlas-revenue-card-run-rate-history',
  'atlas-revenue-card-reconciliation-history',
  'atlas-revenue-card-ndr-history'
);
