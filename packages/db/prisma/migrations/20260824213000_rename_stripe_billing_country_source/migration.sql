UPDATE "dataSource"
SET
  "key" = 'stripe:billing-country',
  "label" = 'Stripe billing country',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'stripe:metabase-mirror';
