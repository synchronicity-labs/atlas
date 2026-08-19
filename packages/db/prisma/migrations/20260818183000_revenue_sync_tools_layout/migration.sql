UPDATE "dashboard"
SET
  "description" = 'Monthly revenue and NDR with two views: the original Rudy close for audit, and a governed sync.tools view that excludes enterprise, program, and known channel-partner revenue. The channel-partner registry is still being completed.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 2;

UPDATE "question"
SET
  "description" = 'Self-serve subscription run-rate plus projected current-month usage accrual at one UTC cutoff. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1102;

UPDATE "question"
SET
  "description" = 'Completed-month usage accrual plus current-month actual and projected pace, using generationEndedAt in UTC. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1103;

UPDATE "question"
SET
  "description" = 'Latest active or past-due self-serve Stripe subscriptions multiplied by the current monthly plan price. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed. This is subscription run-rate, not cash collected.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1104;

UPDATE "dashboardCard"
SET "x" = 0, "y" = 0, "width" = 24, "height" = 5, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-sync-tools-card-combined';

UPDATE "dashboardCard"
SET "x" = 0, "y" = 5, "width" = 24, "height" = 9, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-sync-tools-card-usage';

UPDATE "dashboardCard"
SET "x" = 0, "y" = 14, "width" = 24, "height" = 10, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-revenue-sync-tools-card-subscription';
