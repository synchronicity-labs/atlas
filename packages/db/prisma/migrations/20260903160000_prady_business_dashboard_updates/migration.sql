ALTER TABLE "contractCustomer"
ADD COLUMN "commercialBaseline" JSONB,
ADD COLUMN "commercialBaselineUpdatedAt" TIMESTAMP(3);

UPDATE "question"
SET
  "description" = 'Total next-month accrued usage from one fixed prior-month self-serve organization cohort divided by that cohort''s total starting accrued usage. This is an aggregate cohort ratio, not an average of customer-level percentages.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1105;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
SELECT
  'atlas-revenue-version-annualized-run-rate-prady-trend',
  q."id",
  COALESCE((SELECT max(v."version") FROM "questionVersion" v WHERE v."questionId" = q."id"), 0) + 1,
  latest."queryLanguage",
  regexp_replace(latest."queryText", ',\s*-2\)', ', -6)', 'g'),
  latest."display",
  latest."visualization",
  latest."sourceCardExternalId",
  'atlas-prady-business-dashboard',
  CURRENT_TIMESTAMP
FROM "question" q
JOIN LATERAL (
  SELECT v.*
  FROM "questionVersion" v
  WHERE v."questionId" = q."id"
  ORDER BY v."version" DESC
  LIMIT 1
) latest ON true
WHERE q."number" = 1011
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "question" (
  "id", "number", "publicNumber", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-contract-question-enterprise-contract-value',
    7510,
    295,
    'Known active enterprise annual contract value (USD)',
    'Sums the annualized active USD commercial baselines selected from parsed enterprise contracts. Non-USD and missing baselines are reported as coverage counts and are not added to the USD total.',
    'ATLAS',
    (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:contracts'),
    'atlas:contracts:enterprise-contract-value',
    'atlas:contracts:finance',
    NULL,
    'ACTIVE',
    'RECONCILIATION',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-enterprise-contract-commitments',
    7511,
    296,
    'Enterprise contract commitments and coverage',
    'Lists every active enterprise customer folder with its selected annual and monthly contract baseline, currency, governing document, current-term state, and data-through time. Missing values remain visible for Finance review.',
    'ATLAS',
    (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:contracts'),
    'atlas:contracts:enterprise-contract-commitments',
    'atlas:contracts:finance',
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
    'atlas-contract-question-enterprise-contract-value-v1',
    'atlas-contract-question-enterprise-contract-value',
    1,
    'API',
    '{"source":"atlas_contracts","report":"enterprise-contract-value","definitionVersion":"contract-reconciliation-v1"}',
    'smartscalar',
    '{"scalar.field":"annual_contract_value_usd","currencyColumns":["annual_contract_value_usd"]}'::jsonb,
    NULL,
    'atlas-contract-reconciliation',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-question-enterprise-contract-commitments-v1',
    'atlas-contract-question-enterprise-contract-commitments',
    1,
    'API',
    '{"source":"atlas_contracts","report":"enterprise-contract-commitments","definitionVersion":"contract-reconciliation-v1"}',
    'table',
    '{"columns":["customer","annual_contract_value","currency","monthly_baseline","basis","source_document","document_date","service_end_date","current","data_through"],"currencyColumns":["annual_contract_value","monthly_baseline"]}'::jsonb,
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

UPDATE "dashboardCard"
SET
  "position" = "position" + 2,
  "y" = "y" + 18,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "tabId" = 'atlas-contract-reconciliation-tab-finance';

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-contract-card-enterprise-contract-value',
    'atlas-contract-reconciliation-dashboard',
    'atlas-contract-reconciliation-tab-finance',
    'atlas-contract-question-enterprise-contract-value',
    0, 0, 0, 8, 4, 'NUMBER', '{"currencyColumns":["annual_contract_value_usd"]}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-contract-card-enterprise-contract-commitments',
    'atlas-contract-reconciliation-dashboard',
    'atlas-contract-reconciliation-tab-finance',
    'atlas-contract-question-enterprise-contract-commitments',
    1, 0, 4, 24, 14, 'TABLE', '{"compact":true,"currencyColumns":["annual_contract_value","monthly_baseline"]}'::jsonb,
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
