UPDATE "question"
SET
  "description" = 'Monthly people who visit Sync sites, counted once across sites whenever Atlas has a stable shared identity. The current preview still sums GA4 property totals and remains provisional until the cross-site identity bridge is connected.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 2001;
