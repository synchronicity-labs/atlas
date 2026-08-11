INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-metabase-source', 'metabase:sync', 'METABASE', 'Metabase',
  'UNCONFIGURED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-product-dashboard', 1, 'Product 2026 Scoreboard',
  'Governed Product KPI scoreboard imported from Metabase and published through Atlas.',
  1, 'atlas', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("number") DO NOTHING;
