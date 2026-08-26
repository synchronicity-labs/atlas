CREATE TABLE "q3InboundSnapshot" (
  "id" TEXT NOT NULL,
  "quarterStart" TIMESTAMP(3) NOT NULL,
  "dataThrough" TIMESTAMP(3) NOT NULL,
  "sourceItemCount" INTEGER NOT NULL,
  "rows" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "q3InboundSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "q3InboundSnapshot_quarterStart_contentHash_key"
ON "q3InboundSnapshot"("quarterStart", "contentHash");

CREATE INDEX "q3InboundSnapshot_quarterStart_capturedAt_idx"
ON "q3InboundSnapshot"("quarterStart", "capturedAt");

INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-q3-gtm-composite-source',
  'atlas:q3-gtm-composite',
  'ATLAS',
  'Governed Q3 GTM evidence',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "question"
SET
  "name" = 'Q3 enterprise inbound and lifecycle funnel',
  "description" = 'Q3 enterprise inbound and MQL, PQL, and SQL lifecycle transitions by UTC reporting period. Inbound counts come from deidentified Rudy Slack source-thread aggregates. Positive closed-won Enterprise deals are classified by the exact HubSpot deal type. Parsed paid SOW and order-form documents remain separate from signature-verified SOWs, which are unavailable until signature evidence is captured. Unknown deal classifications remain visible.',
  "connector" = 'ATLAS',
  "sourceId" = (
    SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:q3-gtm-composite'
  ),
  "sourceExternalId" = 'cron:q3-gtm:lifecycle-funnel',
  "sourceDashboardExternalId" = 'atlas:sales:q3-gtm',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-q3-gtm-funnel';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-q3-gtm-funnel-v2',
  'atlas-cron-question-q3-gtm-funnel',
  2,
  'API',
  '{"source":"hubspot","report":"q3-lifecycle-funnel","months":3,"pipelines":["989457121"]}',
  'table',
  '{"columns":["week_start","period_end","enterprise_inbound","mql","pql","sql","crm_paid_closed_won","paid_sow_documents","paid_order_form_documents","signed_paid_sows","net_new_logos","renewals","unmapped_deals","data_through"],"signatureBoundary":"signed_paid_sows_unavailable"}'::jsonb,
  NULL,
  'atlas-q3-gtm-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-sales-card-q3-lifecycle-funnel',
  'atlas-sales-dashboard',
  'atlas-sales-tab-enterprise',
  'atlas-cron-question-q3-gtm-funnel',
  7,
  0,
  35,
  24,
  10,
  'TABLE',
  '{"compact":true,"signatureBoundary":"unavailable","unmappedVisible":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "questionId" = EXCLUDED."questionId",
  "position" = EXCLUDED."position",
  "x" = EXCLUDED."x",
  "y" = EXCLUDED."y",
  "width" = EXCLUDED."width",
  "height" = EXCLUDED."height",
  "visualization" = EXCLUDED."visualization",
  "displaySettings" = EXCLUDED."displaySettings",
  "updatedAt" = CURRENT_TIMESTAMP;
