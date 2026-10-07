CREATE TABLE "productOrganizationStatusEvent" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "productOrganizationId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "plan" TEXT,
  "pilotType" TEXT,
  "pilotAcceptedAt" TIMESTAMP(3),
  "pilotExpiresAt" TIMESTAMP(3),
  "paymentStatus" JSONB,
  "stripeSubscriptionId" TEXT,
  "stripeCustomerId" TEXT,
  "contentHash" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "productOrganizationStatusEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "productOrganizationStatusEvent_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "productOrganizationStatusEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "productOrganizationStatusEvent_productOrganizationId_fkey" FOREIGN KEY ("productOrganizationId") REFERENCES "productOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "productOrganizationStatusEvent_productOrganizationId_effectiveAt_idx" ON "productOrganizationStatusEvent"("productOrganizationId", "effectiveAt");
CREATE INDEX "productOrganizationStatusEvent_sourceId_observedAt_idx" ON "productOrganizationStatusEvent"("sourceId", "observedAt");
CREATE INDEX "productOrganizationStatusEvent_stripeCustomerId_effectiveAt_idx" ON "productOrganizationStatusEvent"("stripeCustomerId", "effectiveAt");
