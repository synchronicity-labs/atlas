INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-billing-experiment-source', 'atlas:billing-experiment', 'ATLAS',
  'PostHog billing assignment + product and Stripe outcomes', 'UNCONFIGURED',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

UPDATE "dashboardTab"
SET "name" = 'Billing v3 experiment',
    "sourceExternalId" = 'posthog:flag:726996'
WHERE "id" = 'atlas-product-tab-billing';

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
)
SELECT
  'atlas-product-tab-billing-operations', "id", 7, 'Billing operations', 6,
  'metabase:collection:billing-v2-vs-v3'
FROM "dashboard"
WHERE "number" = 1;

UPDATE "dashboardCard"
SET "tabId" = 'atlas-product-tab-billing-operations',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'atlas-product-card-billing-org-mix',
  'atlas-product-card-v3-plan-mix',
  'atlas-product-card-billing-paid-rate',
  'atlas-product-card-billing-subscription-revenue',
  'atlas-product-card-v3-topups',
  'atlas-product-card-billing-frames',
  'atlas-product-card-billing-dubbing',
  'atlas-product-card-billing-tts'
);

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "status",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-billing-experiment-question-published-cash', 60,
    'Cash per paid-org month · Jul 27 read',
    'Immutable published read from the PostHog-assigned experiment. Cash uses organizations with at least 14 days of paid tenure; v2 control and v3 treatment have separate denominators.',
    'ATLAS', 'atlas-billing-experiment-source',
    'billing-experiment:published:cash', 'posthog:flag:726996', 'ACTIVE',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-question-published-churn', 61,
    'Month-one churn · Jul 27 read',
    'Immutable fixed-window churn result for PostHog-assigned arms. The denominator contains only paying organizations mature for a full 30-day observation window.',
    'ATLAS', 'atlas-billing-experiment-source',
    'billing-experiment:published:churn', 'posthog:flag:726996', 'ACTIVE',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-question-published-ltv', 62,
    'Implied cash LTV · Jul 27 read',
    'Cash per paid-org month multiplied by the constant-hazard lifetime shorthand of one divided by month-one churn. This is an implied directional LTV, not observed lifetime value.',
    'ATLAS', 'atlas-billing-experiment-source',
    'billing-experiment:published:ltv', 'posthog:flag:726996', 'ACTIVE',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-question-published-summary', 63,
    'Published experiment read · source detail',
    'The source-backed July 27 experiment artifact with each metric''s own denominator, paid-tenure rule, and calculated lifetime and LTV.',
    'ATLAS', 'atlas-billing-experiment-source',
    'billing-experiment:published:summary', 'posthog:flag:726996', 'ACTIVE',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-question-live-funnel', 64,
    'Live experiment enrollment funnel',
    'Current valid external signup assignments, paid converters, 14-day cash sample, and fixed 30/60-day maturity by persisted PostHog arm. Banned, disabled, and sync.so owners are excluded.',
    'ATLAS', 'atlas-billing-experiment-source',
    'billing-experiment:live:funnel', 'posthog:flag:726996', 'ACTIVE',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-question-live-readout', 65,
    'Live cash, churn & implied LTV',
    'Versioned live reconstruction across the persisted PostHog assignment spine and deduplicated Stripe outcomes. The published July result above remains immutable when late warehouse events arrive.',
    'ATLAS', 'atlas-billing-experiment-source',
    'billing-experiment:live:readout', 'posthog:flag:726996', 'ACTIVE',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-question-milestones', 66,
    'Experiment maturity milestones',
    'Planned maturity checkpoints from the source analysis, including the first credit-expiry wave and the 30/60-day hundred-organization reads.',
    'ATLAS', 'atlas-billing-experiment-source',
    'billing-experiment:milestones', 'posthog:flag:726996', 'ACTIVE',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  (
    'atlas-billing-experiment-version-published-cash-v1',
    'atlas-billing-experiment-question-published-cash', 1, 'API',
    '{"source":"billing_experiment","report":"published-cash"}',
    'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-version-published-churn-v1',
    'atlas-billing-experiment-question-published-churn', 1, 'API',
    '{"source":"billing_experiment","report":"published-churn"}',
    'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-version-published-ltv-v1',
    'atlas-billing-experiment-question-published-ltv', 1, 'API',
    '{"source":"billing_experiment","report":"published-ltv"}',
    'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-version-published-summary-v1',
    'atlas-billing-experiment-question-published-summary', 1, 'API',
    '{"source":"billing_experiment","report":"published-summary"}',
    'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-version-live-funnel-v1',
    'atlas-billing-experiment-question-live-funnel', 1, 'API',
    '{"source":"billing_experiment","report":"live-funnel"}',
    'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-version-live-readout-v1',
    'atlas-billing-experiment-question-live-readout', 1, 'API',
    '{"source":"billing_experiment","report":"live-readout"}',
    'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-version-milestones-v1',
    'atlas-billing-experiment-question-milestones', 1, 'API',
    '{"source":"billing_experiment","report":"milestones"}',
    'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
  );

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
)
SELECT
  values."id", dashboard."id", tab."id", question."id", values."position",
  values."x", values."y", values."width", values."height",
  values."visualization"::"VisualizationType", '{}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  VALUES
    ('atlas-billing-experiment-card-published-cash', 60, 0, 0, 0, 8, 6, 'BAR'),
    ('atlas-billing-experiment-card-published-churn', 61, 1, 8, 0, 8, 6, 'BAR'),
    ('atlas-billing-experiment-card-published-ltv', 62, 2, 16, 0, 8, 6, 'BAR'),
    ('atlas-billing-experiment-card-published-summary', 63, 3, 0, 6, 24, 7, 'TABLE'),
    ('atlas-billing-experiment-card-live-funnel', 64, 4, 0, 13, 12, 8, 'TABLE'),
    ('atlas-billing-experiment-card-live-readout', 65, 5, 12, 13, 12, 8, 'TABLE'),
    ('atlas-billing-experiment-card-milestones', 66, 6, 0, 21, 24, 8, 'TABLE')
) AS values(
  "id", "questionNumber", "position", "x", "y", "width", "height", "visualization"
)
CROSS JOIN "dashboard" dashboard
JOIN "dashboardTab" tab
  ON tab."dashboardId" = dashboard."id" AND tab."number" = 5
JOIN "question" question ON question."number" = values."questionNumber"
WHERE dashboard."number" = 1;

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1;
