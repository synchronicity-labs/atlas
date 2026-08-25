ALTER TYPE "IdentityLinkMethod" ADD VALUE 'EXACT_NAME';

CREATE TYPE "ContractTextStatus" AS ENUM ('PENDING', 'EXTRACTED', 'NEEDS_OCR', 'FAILED');
CREATE TYPE "ContractParseStatus" AS ENUM ('PENDING', 'PARSED', 'FAILED');
CREATE TYPE "ContractMappingStatus" AS ENUM ('SUGGESTED', 'VERIFIED', 'REJECTED');

ALTER TABLE "agentTask" ADD COLUMN "sourceRecordId" TEXT;

CREATE TABLE "contractCustomer" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "legalName" TEXT,
    "companyId" TEXT,
    "sourceDeletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractCustomer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contractDocument" (
    "sourceRecordId" TEXT NOT NULL,
    "contractCustomerId" TEXT,
    "revisionKey" TEXT NOT NULL,
    "textStatus" "ContractTextStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT,
    "textHash" TEXT,
    "byteCount" INTEGER,
    "characterCount" INTEGER,
    "pageCount" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "extractionError" TEXT,
    "extractionWarnings" JSONB,
    "extractedAt" TIMESTAMP(3),
    "parseStatus" "ContractParseStatus" NOT NULL DEFAULT 'PENDING',
    "parserVersion" TEXT,
    "parsed" JSONB,
    "parseError" TEXT,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractDocument_pkey" PRIMARY KEY ("sourceRecordId")
);

CREATE TABLE "contractCustomerProductOrganization" (
    "id" TEXT NOT NULL,
    "contractCustomerId" TEXT NOT NULL,
    "productOrganizationId" TEXT NOT NULL,
    "status" "ContractMappingStatus" NOT NULL DEFAULT 'SUGGESTED',
    "method" "IdentityLinkMethod" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractCustomerProductOrganization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contractCustomer_source_external_key" ON "contractCustomer"("sourceId", "externalId");
CREATE INDEX "contractCustomer_company_idx" ON "contractCustomer"("companyId");
CREATE INDEX "contractCustomer_source_deleted_idx" ON "contractCustomer"("sourceId", "sourceDeletedAt");
CREATE INDEX "contractDocument_customer_idx" ON "contractDocument"("contractCustomerId");
CREATE INDEX "contractDocument_status_idx" ON "contractDocument"("textStatus", "parseStatus");
CREATE UNIQUE INDEX "contractCustomerProductOrg_customer_org_key" ON "contractCustomerProductOrganization"("contractCustomerId", "productOrganizationId");
CREATE INDEX "contractCustomerProductOrg_org_idx" ON "contractCustomerProductOrganization"("productOrganizationId");
CREATE INDEX "contractCustomerProductOrg_status_idx" ON "contractCustomerProductOrganization"("status");
CREATE INDEX "agentTask_sourceRecordId_idx" ON "agentTask"("sourceRecordId");

ALTER TABLE "agentTask" ADD CONSTRAINT "agentTask_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "sourceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contractCustomer" ADD CONSTRAINT "contractCustomer_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contractCustomer" ADD CONSTRAINT "contractCustomer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contractDocument" ADD CONSTRAINT "contractDocument_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "sourceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contractDocument" ADD CONSTRAINT "contractDocument_contractCustomerId_fkey" FOREIGN KEY ("contractCustomerId") REFERENCES "contractCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contractCustomerProductOrganization" ADD CONSTRAINT "contractCustomerProductOrganization_customerId_fkey" FOREIGN KEY ("contractCustomerId") REFERENCES "contractCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contractCustomerProductOrganization" ADD CONSTRAINT "contractCustomerProductOrganization_orgId_fkey" FOREIGN KEY ("productOrganizationId") REFERENCES "productOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
