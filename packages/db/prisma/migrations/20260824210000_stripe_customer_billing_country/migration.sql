CREATE TABLE "stripeCustomerBillingCountry" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "evidenceKind" TEXT NOT NULL,
  "sourceExternalId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "dataThrough" TIMESTAMP(3) NOT NULL,
  "contentHash" TEXT NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "stripeCustomerBillingCountry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stripeCustomerBillingCountrySnapshot" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "billingCountryId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "evidenceKind" TEXT NOT NULL,
  "sourceExternalId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "dataThrough" TIMESTAMP(3) NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "contentHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stripeCustomerBillingCountrySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stripeCustomerBillingCountry_sourceId_stripeCustomerId_key"
ON "stripeCustomerBillingCountry"("sourceId", "stripeCustomerId");

CREATE INDEX "stripeCustomerBillingCountry_stripeCustomerId_idx"
ON "stripeCustomerBillingCountry"("stripeCustomerId");

CREATE INDEX "stripeCustomerBillingCountry_countryCode_idx"
ON "stripeCustomerBillingCountry"("countryCode");

CREATE INDEX "stripeCustomerBillingCountry_sourceId_dataThrough_idx"
ON "stripeCustomerBillingCountry"("sourceId", "dataThrough");

CREATE UNIQUE INDEX "stripeCustomerBillingCountrySnapshot_idempotencyKey_key"
ON "stripeCustomerBillingCountrySnapshot"("idempotencyKey");

CREATE INDEX "stripeCustomerBillingCountrySnapshot_billingCountryId_capturedAt_idx"
ON "stripeCustomerBillingCountrySnapshot"("billingCountryId", "capturedAt");

CREATE INDEX "stripeCustomerBillingCountrySnapshot_sourceId_capturedAt_idx"
ON "stripeCustomerBillingCountrySnapshot"("sourceId", "capturedAt");

CREATE INDEX "stripeCustomerBillingCountrySnapshot_stripeCustomerId_observedAt_idx"
ON "stripeCustomerBillingCountrySnapshot"("stripeCustomerId", "observedAt");

ALTER TABLE "stripeCustomerBillingCountry"
ADD CONSTRAINT "stripeCustomerBillingCountry_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stripeCustomerBillingCountrySnapshot"
ADD CONSTRAINT "stripeCustomerBillingCountrySnapshot_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stripeCustomerBillingCountrySnapshot"
ADD CONSTRAINT "stripeCustomerBillingCountrySnapshot_billingCountryId_fkey"
FOREIGN KEY ("billingCountryId") REFERENCES "stripeCustomerBillingCountry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
