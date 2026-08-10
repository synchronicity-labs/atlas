ALTER TYPE "RecordSource" ADD VALUE 'HUBSPOT';
ALTER TYPE "DataSourceKind" ADD VALUE 'POSTHOG';

CREATE TYPE "ExternalRecordKind" AS ENUM ('COMPANY', 'CONTACT', 'PERSON');
CREATE TYPE "IdentityLinkMethod" AS ENUM ('EXACT_EXTERNAL_ID', 'EXACT_EMAIL', 'EXACT_DOMAIN', 'SOURCE_ASSOCIATION', 'MEMBER_DOMAIN');

ALTER TABLE "agentTask" ADD COLUMN "productUserId" TEXT;

CREATE TABLE "sourceRecord" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" "ExternalRecordKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "contentHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sourceCreatedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sourceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sourceRecordSnapshot" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sourceRecordSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "productUserSourceLink" (
    "id" TEXT NOT NULL,
    "productUserId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "method" "IdentityLinkMethod" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "productUserSourceLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "productUserContactLink" (
    "id" TEXT NOT NULL,
    "productUserId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "method" "IdentityLinkMethod" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "productUserContactLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "productUserCompanyLink" (
    "id" TEXT NOT NULL,
    "productUserId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "method" "IdentityLinkMethod" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "productUserCompanyLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "productOrganizationCompanyLink" (
    "id" TEXT NOT NULL,
    "productOrganizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "method" "IdentityLinkMethod" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "productOrganizationCompanyLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agentTask_productUserId_idx" ON "agentTask"("productUserId");
CREATE UNIQUE INDEX "sourceRecord_sourceId_kind_externalId_key" ON "sourceRecord"("sourceId", "kind", "externalId");
CREATE INDEX "sourceRecord_companyId_idx" ON "sourceRecord"("companyId");
CREATE INDEX "sourceRecord_contactId_idx" ON "sourceRecord"("contactId");
CREATE INDEX "sourceRecord_sourceId_syncedAt_idx" ON "sourceRecord"("sourceId", "syncedAt");
CREATE UNIQUE INDEX "sourceRecordSnapshot_idempotencyKey_key" ON "sourceRecordSnapshot"("idempotencyKey");
CREATE INDEX "sourceRecordSnapshot_sourceRecordId_capturedAt_idx" ON "sourceRecordSnapshot"("sourceRecordId", "capturedAt");
CREATE INDEX "sourceRecordSnapshot_sourceId_capturedAt_idx" ON "sourceRecordSnapshot"("sourceId", "capturedAt");
CREATE UNIQUE INDEX "productUserSourceLink_productUserId_sourceRecordId_key" ON "productUserSourceLink"("productUserId", "sourceRecordId");
CREATE INDEX "productUserSourceLink_sourceRecordId_idx" ON "productUserSourceLink"("sourceRecordId");
CREATE UNIQUE INDEX "productUserContactLink_productUserId_contactId_key" ON "productUserContactLink"("productUserId", "contactId");
CREATE INDEX "productUserContactLink_contactId_idx" ON "productUserContactLink"("contactId");
CREATE UNIQUE INDEX "productUserCompanyLink_productUserId_companyId_key" ON "productUserCompanyLink"("productUserId", "companyId");
CREATE INDEX "productUserCompanyLink_companyId_idx" ON "productUserCompanyLink"("companyId");
CREATE UNIQUE INDEX "productOrganizationCompanyLink_productOrganizationId_companyId_key" ON "productOrganizationCompanyLink"("productOrganizationId", "companyId");
CREATE INDEX "productOrganizationCompanyLink_companyId_idx" ON "productOrganizationCompanyLink"("companyId");

ALTER TABLE "agentTask" ADD CONSTRAINT "agentTask_productUserId_fkey" FOREIGN KEY ("productUserId") REFERENCES "productUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sourceRecord" ADD CONSTRAINT "sourceRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sourceRecord" ADD CONSTRAINT "sourceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sourceRecord" ADD CONSTRAINT "sourceRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sourceRecordSnapshot" ADD CONSTRAINT "sourceRecordSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sourceRecordSnapshot" ADD CONSTRAINT "sourceRecordSnapshot_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "sourceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "productUserSourceLink" ADD CONSTRAINT "productUserSourceLink_productUserId_fkey" FOREIGN KEY ("productUserId") REFERENCES "productUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "productUserSourceLink" ADD CONSTRAINT "productUserSourceLink_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "sourceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "productUserContactLink" ADD CONSTRAINT "productUserContactLink_productUserId_fkey" FOREIGN KEY ("productUserId") REFERENCES "productUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "productUserContactLink" ADD CONSTRAINT "productUserContactLink_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "productUserCompanyLink" ADD CONSTRAINT "productUserCompanyLink_productUserId_fkey" FOREIGN KEY ("productUserId") REFERENCES "productUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "productUserCompanyLink" ADD CONSTRAINT "productUserCompanyLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "productOrganizationCompanyLink" ADD CONSTRAINT "productOrganizationCompanyLink_productOrganizationId_fkey" FOREIGN KEY ("productOrganizationId") REFERENCES "productOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "productOrganizationCompanyLink" ADD CONSTRAINT "productOrganizationCompanyLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
