UPDATE "question"
SET "name" = 'Cash per paid-org month · live',
    "description" = 'Current PostHog-assigned control versus treatment cash, normalized by each eligible organization''s paid tenure. The sample includes paying organizations with at least 14 days of paid tenure.',
    "sourceExternalId" = 'billing-experiment:live:cash',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 60;

UPDATE "question"
SET "name" = '30-day churn · live',
    "description" = 'Current fixed-window churn for PostHog-assigned control and treatment organizations. Only paying organizations with a fully matured 30-day observation window enter the denominator.',
    "sourceExternalId" = 'billing-experiment:live:churn',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 61;

UPDATE "question"
SET "name" = 'Implied cash LTV · live',
    "description" = 'Current cash per paid-org month multiplied by the constant-hazard lifetime shorthand of one divided by matured 30-day churn. This is directional implied LTV, not observed lifetime value.',
    "sourceExternalId" = 'billing-experiment:live:ltv',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 62;

UPDATE "question"
SET "name" = 'Current experiment read · methodology detail',
    "description" = 'Current Tair-method control/treatment read with raw cash, paid-time denominator, fixed-window churn counts, Wilson uncertainty interval, implied lifetime, and implied cash LTV.',
    "sourceExternalId" = 'billing-experiment:live:summary',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 63;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  (
    'atlas-billing-experiment-version-live-cash-v2',
    'atlas-billing-experiment-question-published-cash', 2, 'API',
    '{"source":"billing_experiment","report":"live-cash"}',
    'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-version-live-churn-v2',
    'atlas-billing-experiment-question-published-churn', 2, 'API',
    '{"source":"billing_experiment","report":"live-churn"}',
    'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-version-live-ltv-v2',
    'atlas-billing-experiment-question-published-ltv', 2, 'API',
    '{"source":"billing_experiment","report":"live-ltv"}',
    'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-billing-experiment-version-live-summary-v2',
    'atlas-billing-experiment-question-published-summary', 2, 'API',
    '{"source":"billing_experiment","report":"live-summary"}',
    'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
  );

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1;
