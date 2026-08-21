UPDATE "question"
SET
  "description" = 'Monthly partner usage incurred and Stripe invoices raised, shown together by partner. Invoices raised are the current booked-revenue view. Stripe cash collected is reference-only until DualEntry is ready. These views must not be added together.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1116;
