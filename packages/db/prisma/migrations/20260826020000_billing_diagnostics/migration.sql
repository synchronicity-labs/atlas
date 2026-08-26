UPDATE "question"
SET
  "name" = 'Billing V3 tier, top-up, cancellation, and renewal diagnostics',
  "description" = 'Current Billing V3 diagnostics by persisted experiment arm and paid tier. It reports paid converters, successful V3 top-ups, structured cancellation reasons, pending cancellations, 30-day renewal maturity, paid renewals, and failed or unpaid invoice amounts. Raw customer comments and identifiers are excluded.',
  "connector" = 'ATLAS',
  "sourceId" = 'atlas-billing-experiment-source',
  "sourceExternalId" = 'cron:billing-v3:diagnostics',
  "sourceDashboardExternalId" = 'atlas:product:billing-v3',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-billing-diagnostics';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-billing-diagnostics-v2',
  'atlas-cron-question-billing-diagnostics',
  2,
  'API',
  '{"source":"billing_experiment","report":"live-diagnostics"}',
  'table',
  '{"columns":["section","arm","tier","assigned","paid_converters","topup_users","topup_revenue_usd","repeat_topup_orgs","canceled","pending_cancel","renewal_eligible","renewed","failed_invoice_count","failed_invoice_amount_usd","cancellation_reason","cancellation_reason_count","data_through"]}'::jsonb,
  NULL,
  'atlas-billing-diagnostics-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
)
SELECT
  'atlas-billing-experiment-card-diagnostics',
  dashboard."id",
  tab."id",
  'atlas-cron-question-billing-diagnostics',
  8,
  0,
  29,
  24,
  10,
  'TABLE',
  '{"compact":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "dashboard" dashboard
JOIN "dashboardTab" tab
  ON tab."dashboardId" = dashboard."id" AND tab."number" = 5
WHERE dashboard."number" = 1
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
