INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES (
  'atlas-customer-economics-gross-logo-retention', 6027,
  'Gross logo retention by plan',
  'The share of paid self-serve organizations that remain subscribed at month end.',
  'METABASE', 'atlas-revenue-source', 'customer-economics:gross-logo-retention',
  'atlas:customer-lifecycle:economics', '166', 'ACTIVE', 'RECONCILIATION',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("number") DO NOTHING;
