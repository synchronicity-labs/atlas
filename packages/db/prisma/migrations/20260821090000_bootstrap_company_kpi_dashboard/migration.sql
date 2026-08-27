INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion",
  "createdBy", "createdAt", "updatedAt"
) VALUES (
  'atlas-company-kpis', 8, 'Company KPIs',
  'Company KPI catalog. Each card links to its governed Atlas question and current verification state.',
  1, 'atlas', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("number") DO NOTHING;
