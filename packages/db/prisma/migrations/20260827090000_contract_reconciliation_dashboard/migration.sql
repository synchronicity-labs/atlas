INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-contracts-source',
  'atlas:contracts',
  'ATLAS',
  'Contract reconciliation',
  'STALE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-contract-reconciliation-dashboard',
  13,
  'Contract Reconciliation',
  'Current enterprise contract price differences, agreement and account gaps, open reconciliation findings, customer coverage, and Drive ingestion health.',
  1,
  'atlas',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES
  (
    'atlas-contract-reconciliation-tab-finance',
    'atlas-contract-reconciliation-dashboard',
    1,
    'Finance review',
    0,
    'atlas:contracts:finance'
  ),
  (
    'atlas-contract-reconciliation-tab-operations',
    'atlas-contract-reconciliation-dashboard',
    2,
    'Operations',
    1,
    'atlas:contracts:operations'
  )
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

INSERT INTO "question" (
  "id", "number", "publicNumber", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-contract-question-action-summary',
    7500,
    284,
    'Contract reconciliation action summary',
    'Current open and critical contract findings, direct price mismatches, possible missing addendums, account gaps, OCR work, and documents still waiting for processing.',
    'ATLAS',
    (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:contracts'),
    'atlas:contracts:action-summary',
    'atlas:contracts:finance',
    NULL,
    'ACTIVE',
    'RECONCILIATION',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-price-mismatches',
    7501,
    285,
    'Enterprise contract price mismatches',
    'Open enterprise per-frame differences between the latest filed contract price and the current Product usage price, with Product and Stripe identity evidence.',
    'ATLAS',
    (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:contracts'),
    'atlas:contracts:price-mismatches',
    'atlas:contracts:finance',
    NULL,
    'ACTIVE',
    'RECONCILIATION',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-contract-account-gaps',
    7502,
    286,
    'Contract folders missing Product or Stripe accounts',
    'Enterprise contract folders with no verified Product organization, an ambiguous Product match, or no Stripe customer ID.',
    'ATLAS',
    (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:contracts'),
    'atlas:contracts:contract-account-gaps',
    'atlas:contracts:finance',
    NULL,
    'ACTIVE',
    'RECONCILIATION',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-product-account-gaps',
    7503,
    287,
    'Enterprise Product accounts without a filed contract link',
    'Product organizations marked enterprise that have no verified active Enterprise or Channel Partner contract link. Internal sync.so-only organizations are excluded.',
    'ATLAS',
    (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:contracts'),
    'atlas:contracts:product-account-gaps',
    'atlas:contracts:finance',
    NULL,
    'ACTIVE',
    'RECONCILIATION',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-open-findings',
    7504,
    288,
    'Open contract reconciliation findings',
    'The complete open and acknowledged contract review queue across Enterprise, Production, and Channel Partner customers.',
    'ATLAS',
    (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:contracts'),
    'atlas:contracts:open-findings',
    'atlas:contracts:operations',
    NULL,
    'ACTIVE',
    'RECONCILIATION',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-customer-coverage',
    7505,
    289,
    'Contract customer identity and document coverage',
    'Every active contract customer folder with customer class, document count, parsed count, verified Product organizations, Stripe customer IDs, and open finding counts.',
    'ATLAS',
    (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:contracts'),
    'atlas:contracts:customer-coverage',
    'atlas:contracts:operations',
    NULL,
    'ACTIVE',
    'RECONCILIATION',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-ingestion-health',
    7506,
    290,
    'Contract ingestion health by customer class',
    'Drive customer and document counts by Enterprise, Production, and Channel Partner class, including extraction, parsing, OCR, failure, and pending states.',
    'ATLAS',
    (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:contracts'),
    'atlas:contracts:ingestion-health',
    'atlas:contracts:operations',
    NULL,
    'ACTIVE',
    'RECONCILIATION',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "connector" = EXCLUDED."connector",
  "sourceId" = EXCLUDED."sourceId",
  "sourceExternalId" = EXCLUDED."sourceExternalId",
  "sourceDashboardExternalId" = EXCLUDED."sourceDashboardExternalId",
  "databaseExternalId" = EXCLUDED."databaseExternalId",
  "status" = EXCLUDED."status",
  "purpose" = EXCLUDED."purpose",
  "updatedAt" = CURRENT_TIMESTAMP;

SELECT setval(
  '"public"."question_publicNumber_seq"',
  (SELECT max("publicNumber") FROM "question"),
  true
);

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-contract-question-action-summary-v1',
    'atlas-contract-question-action-summary',
    1,
    'API',
    '{"source":"atlas_contracts","report":"action-summary","definitionVersion":"contract-reconciliation-v1"}',
    'table',
    '{"columns":["data_through","open_findings","critical_findings","price_mismatches","missing_addendums","contract_account_gaps","product_account_gaps","documents_needing_ocr","pending_documents"]}'::jsonb,
    NULL,
    'atlas-contract-reconciliation',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-price-mismatches-v1',
    'atlas-contract-question-price-mismatches',
    1,
    'API',
    '{"source":"atlas_contracts","report":"price-mismatches","definitionVersion":"contract-reconciliation-v1"}',
    'table',
    '{"columns":["customer","product_organization","stripe_customer_id","contract_usd_per_frame","product_usd_per_frame","difference_usd","difference_percent","last_usage_at","data_through","summary"]}'::jsonb,
    NULL,
    'atlas-contract-reconciliation',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-contract-account-gaps-v1',
    'atlas-contract-question-contract-account-gaps',
    1,
    'API',
    '{"source":"atlas_contracts","report":"contract-account-gaps","definitionVersion":"contract-reconciliation-v1"}',
    'table',
    '{"columns":["customer","issue","product_organization","stripe_customer_id","suggested_product_ids","summary","data_through"]}'::jsonb,
    NULL,
    'atlas-contract-reconciliation',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-product-account-gaps-v1',
    'atlas-contract-question-product-account-gaps',
    1,
    'API',
    '{"source":"atlas_contracts","report":"product-account-gaps","definitionVersion":"contract-reconciliation-v1"}',
    'table',
    '{"columns":["product_organization","product_organization_id","plan","stripe_customer_id","stripe_subscription_id","payment_status","member_domains","review_reason"]}'::jsonb,
    NULL,
    'atlas-contract-reconciliation',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-open-findings-v1',
    'atlas-contract-question-open-findings',
    1,
    'API',
    '{"source":"atlas_contracts","report":"open-findings","definitionVersion":"contract-reconciliation-v1"}',
    'table',
    '{"columns":["customer","customer_class","severity","finding_type","status","product_organization","title","summary","first_seen_at","data_through"]}'::jsonb,
    NULL,
    'atlas-contract-reconciliation',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-customer-coverage-v1',
    'atlas-contract-question-customer-coverage',
    1,
    'API',
    '{"source":"atlas_contracts","report":"customer-coverage","definitionVersion":"contract-reconciliation-v1"}',
    'table',
    '{"columns":["customer","customer_class","documents","parsed_documents","product_organizations","stripe_customer_ids","open_findings","critical_findings","drive_synced_at"]}'::jsonb,
    NULL,
    'atlas-contract-reconciliation',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-ingestion-health-v1',
    'atlas-contract-question-ingestion-health',
    1,
    'API',
    '{"source":"atlas_contracts","report":"ingestion-health","definitionVersion":"contract-reconciliation-v1"}',
    'table',
    '{"columns":["customer_class","customers","documents","extracted","parsed","needs_ocr","text_failed","parse_failed","pending"]}'::jsonb,
    NULL,
    'atlas-contract-reconciliation',
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
) VALUES
  (
    'atlas-contract-card-action-summary',
    'atlas-contract-reconciliation-dashboard',
    'atlas-contract-reconciliation-tab-finance',
    'atlas-contract-question-action-summary',
    0, 0, 0, 24, 8, 'TABLE', '{"compact":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-card-price-mismatches',
    'atlas-contract-reconciliation-dashboard',
    'atlas-contract-reconciliation-tab-finance',
    'atlas-contract-question-price-mismatches',
    1, 0, 8, 24, 12, 'TABLE', '{"compact":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-card-contract-account-gaps',
    'atlas-contract-reconciliation-dashboard',
    'atlas-contract-reconciliation-tab-finance',
    'atlas-contract-question-contract-account-gaps',
    2, 0, 20, 12, 14, 'TABLE', '{"compact":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-card-product-account-gaps',
    'atlas-contract-reconciliation-dashboard',
    'atlas-contract-reconciliation-tab-finance',
    'atlas-contract-question-product-account-gaps',
    3, 12, 20, 12, 14, 'TABLE', '{"compact":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-card-open-findings',
    'atlas-contract-reconciliation-dashboard',
    'atlas-contract-reconciliation-tab-operations',
    'atlas-contract-question-open-findings',
    0, 0, 0, 24, 18, 'TABLE', '{"compact":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-card-customer-coverage',
    'atlas-contract-reconciliation-dashboard',
    'atlas-contract-reconciliation-tab-operations',
    'atlas-contract-question-customer-coverage',
    1, 0, 18, 24, 18, 'TABLE', '{"compact":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-card-ingestion-health',
    'atlas-contract-reconciliation-dashboard',
    'atlas-contract-reconciliation-tab-operations',
    'atlas-contract-question-ingestion-health',
    2, 0, 36, 24, 12, 'TABLE', '{"compact":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
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
