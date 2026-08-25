CREATE TYPE "ContractFindingKind" AS ENUM ('NO_PRODUCT_ACCOUNT', 'AMBIGUOUS_ACCOUNT', 'PRICE_MISMATCH', 'POSSIBLE_MISSING_ADDENDUM', 'INACTIVE_COMMITMENT', 'MISSING_OCR');
CREATE TYPE "ContractFindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'RESOLVED');
CREATE TYPE "ContractFindingSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE "contractFinding" (
    "id" TEXT NOT NULL,
    "findingKey" TEXT NOT NULL,
    "contractCustomerId" TEXT NOT NULL,
    "productOrganizationId" TEXT,
    "kind" "ContractFindingKind" NOT NULL,
    "status" "ContractFindingStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "ContractFindingSeverity" NOT NULL DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "dataThrough" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractFinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contractFinding_findingKey_key" ON "contractFinding"("findingKey");
CREATE INDEX "contractFinding_customer_status_idx" ON "contractFinding"("contractCustomerId", "status");
CREATE INDEX "contractFinding_org_idx" ON "contractFinding"("productOrganizationId");
CREATE INDEX "contractFinding_kind_status_idx" ON "contractFinding"("kind", "status");

ALTER TABLE "contractFinding" ADD CONSTRAINT "contractFinding_contractCustomerId_fkey" FOREIGN KEY ("contractCustomerId") REFERENCES "contractCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contractFinding" ADD CONSTRAINT "contractFinding_productOrganizationId_fkey" FOREIGN KEY ("productOrganizationId") REFERENCES "productOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH verified_accounts("folderName", "organizationId", "label", "mappingSource") AS (
  VALUES
    ('Albert Media', 'd113b4b4-1a55-4339-b53f-fc17888d8c15', 'Albert Media', 'Product member identity plus enterprise billing and usage'),
    ('Bullet (ZBullet Enterprises Limited)', 'c4f43274-f7c6-4815-a4a8-bfc33c1cd5e3', 'Bullet', 'Exact Product organization name plus enterprise billing and usage'),
    ('CAMB.AI', 'b0597ab9-4c65-4d0d-8cda-89de748a63ec', 'CAMB.AI', 'Exact member domain plus enterprise billing and usage'),
    ('CentralStudios Post (CentralStudios Post Inc.)', 'f33908bb-7991-4085-80ee-147d26fa5e38', 'CentralStudios Post', 'Exact Product member name plus enterprise billing and usage'),
    ('Chai Shots AI', '8915b830-5965-4650-8100-a2bac4fbea8e', 'Chai Shots AI', 'Exact Product organization and member domain plus enterprise billing and usage'),
    ('Creatorkit', '0150c016-0baa-440c-a2c5-2bfbb9e40a60', 'CreatorKit', 'Exact Product organization and member domain plus enterprise billing and usage'),
    ('Dubly (Dubly AI GmbH)', '28c6f7f4-21e9-432e-b92d-94951daa328a', 'Dubly', 'Exact Product organization and member domain plus enterprise billing'),
    ('Floworks', '826b4ad9-1e47-48c7-86c8-521bda349301', 'Floworks', 'Exact member domain plus enterprise billing and usage'),
    ('Intellemo', '16d082a5-87cd-4225-8f5d-90f12abe169c', 'Intellemo', 'Exact member domain plus enterprise billing and usage'),
    ('Lemon Films', '41045a46-c192-412a-975f-75bca3d04787', 'Lemon Films', 'Exact member domain plus Product usage'),
    ('Lightricks (Lightricks Ltd)', '4ba8feb0-b06e-4429-ac66-0577adc2b76c', 'Lightricks', 'Exact member name and domain plus enterprise billing and usage'),
    ('Lionsgate (Lions Gate Entertainment)', '61bc036a-56a3-4eec-a62d-c54f0879e990', 'Lionsgate', 'Exact member domain plus Product usage'),
    ('Netflix Berlin (Netflix Studios, LLC)', '3d59f17c-842e-478e-ac13-8ded6b4b988e', 'Netflix Berlin', 'Exact member name and domain plus enterprise billing and usage'),
    ('Personate AI (Techboxai Technologies)', 'c9abcf01-a60e-4728-a1ee-3257d6d8317a', 'Personate AI', 'Exact member domain plus enterprise billing and usage'),
    ('PlayAI (PlayAI GmbH)', '065e465d-1317-4c12-9d78-31af9bc89d32', 'PlayAI', 'Exact Product organization and member domain plus enterprise billing and usage'),
    ('REViiZED', 'd508d51b-ac39-417c-a8ef-fde9741547da', 'REViiZED', 'Exact member name and domain plus enterprise billing and usage'),
    ('Sendr (Intro Labs Ltd)', '8b051409-c8ec-4c66-9e2b-cc2549d76082', 'Sendr', 'Exact member domain plus enterprise billing and usage'),
    ('Sendspark', '94330e1a-c9f3-4ae4-9b26-1c6380b19734', 'Sendspark', 'Exact member domain plus enterprise billing and usage'),
    ('Showing Business (Arka SB Media LLP)', '391c148c-f15b-46ea-a0d7-595655aa4896', 'Showing Business', 'Exact member domain plus Product usage'),
    ('Superiorads', 'dec8e27b-dc67-4abf-8629-cb48a54ab800', 'Superiorads', 'Exact member domain plus enterprise billing and usage'),
    ('USC - The Coming', '210277f2-12f3-4dba-ad84-44f3d8607806', 'USC - The Coming', 'Exact university member domain plus Product billing'),
    ('Vasudev Sarvam (Prabhushree)', 'a16881b5-d204-487f-805e-cdcbdb1ef586', 'Vasudev Sarvam', 'Exact member name and legal-entity domain plus enterprise billing and usage'),
    ('Visma (Accountants Academy BV)', 'dc1fb518-8e10-42b5-9aab-7de223cc28a8', 'Visma', 'Exact Product organization and member domain plus enterprise billing and usage'),
    ('Wavemaker (Wavemaker Creative)', '27141749-d8f5-4c6e-b7d0-5350433f1147', 'Wavemaker', 'Exact member domain plus Product usage'),
    ('Whilter (Whilter Technologies Private Limited)', '36243675-1418-49a5-a8cf-846562fa9102', 'Whilter', 'Exact Product member identity plus material billing and usage')
), resolved AS (
  SELECT
    cc.id AS "contractCustomerId",
    po.id AS "productOrganizationId",
    verified_accounts."folderName",
    verified_accounts."organizationId",
    verified_accounts.label,
    verified_accounts."mappingSource",
    po."stripeCustomerId",
    po."stripeSubscriptionId"
  FROM verified_accounts
  JOIN "contractCustomer" cc ON cc."folderName" = verified_accounts."folderName" AND cc."sourceDeletedAt" IS NULL
  JOIN "productOrganization" po ON po."externalId" = verified_accounts."organizationId"
), inserted AS (
  INSERT INTO "contractCustomerProductOrganization" (
    "id", "contractCustomerId", "productOrganizationId", "status", "method",
    "confidence", "evidence", "verifiedAt", "createdAt", "updatedAt"
  )
  SELECT
    'contract-map-' || md5(resolved."contractCustomerId" || ':' || resolved."productOrganizationId"),
    resolved."contractCustomerId",
    resolved."productOrganizationId",
    'VERIFIED',
    'SOURCE_ASSOCIATION',
    1.0,
    jsonb_build_object(
      'source', 'Atlas contract, Product organization, Stripe, and usage reconciliation',
      'mappingSource', resolved."mappingSource",
      'folderName', resolved."folderName",
      'productOrganizationExternalId', resolved."organizationId",
      'stripeCustomerId', resolved."stripeCustomerId",
      'stripeSubscriptionId', resolved."stripeSubscriptionId"
    ),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM resolved
  ON CONFLICT ("contractCustomerId", "productOrganizationId") DO UPDATE SET
    "status" = 'VERIFIED',
    "method" = EXCLUDED."method",
    "confidence" = EXCLUDED."confidence",
    "evidence" = EXCLUDED."evidence",
    "verifiedAt" = EXCLUDED."verifiedAt",
    "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "contractCustomerId"
)
SELECT count(*) FROM inserted;

WITH verified_accounts("organizationId", "label", "mappingSource") AS (
  VALUES
    ('d113b4b4-1a55-4339-b53f-fc17888d8c15', 'Albert Media', 'Contract and commercial reconciliation'),
    ('c4f43274-f7c6-4815-a4a8-bfc33c1cd5e3', 'Bullet', 'Contract and commercial reconciliation'),
    ('b0597ab9-4c65-4d0d-8cda-89de748a63ec', 'CAMB.AI', 'Contract and commercial reconciliation'),
    ('f33908bb-7991-4085-80ee-147d26fa5e38', 'CentralStudios Post', 'Contract and commercial reconciliation'),
    ('8915b830-5965-4650-8100-a2bac4fbea8e', 'Chai Shots AI', 'Contract and commercial reconciliation'),
    ('0150c016-0baa-440c-a2c5-2bfbb9e40a60', 'CreatorKit', 'Contract and commercial reconciliation'),
    ('28c6f7f4-21e9-432e-b92d-94951daa328a', 'Dubly', 'Contract and commercial reconciliation'),
    ('826b4ad9-1e47-48c7-86c8-521bda349301', 'Floworks', 'Contract and commercial reconciliation'),
    ('16d082a5-87cd-4225-8f5d-90f12abe169c', 'Intellemo', 'Contract and commercial reconciliation'),
    ('41045a46-c192-412a-975f-75bca3d04787', 'Lemon Films', 'Contract and commercial reconciliation'),
    ('4ba8feb0-b06e-4429-ac66-0577adc2b76c', 'Lightricks', 'Contract and commercial reconciliation'),
    ('61bc036a-56a3-4eec-a62d-c54f0879e990', 'Lionsgate', 'Contract and commercial reconciliation'),
    ('3d59f17c-842e-478e-ac13-8ded6b4b988e', 'Netflix Berlin', 'Contract and commercial reconciliation'),
    ('c9abcf01-a60e-4728-a1ee-3257d6d8317a', 'Personate AI', 'Contract and commercial reconciliation'),
    ('065e465d-1317-4c12-9d78-31af9bc89d32', 'PlayAI', 'Contract and commercial reconciliation'),
    ('d508d51b-ac39-417c-a8ef-fde9741547da', 'REViiZED', 'Contract and commercial reconciliation'),
    ('8b051409-c8ec-4c66-9e2b-cc2549d76082', 'Sendr', 'Contract and commercial reconciliation'),
    ('94330e1a-c9f3-4ae4-9b26-1c6380b19734', 'Sendspark', 'Contract and commercial reconciliation'),
    ('391c148c-f15b-46ea-a0d7-595655aa4896', 'Showing Business', 'Contract and commercial reconciliation'),
    ('dec8e27b-dc67-4abf-8629-cb48a54ab800', 'Superiorads', 'Contract and commercial reconciliation'),
    ('210277f2-12f3-4dba-ad84-44f3d8607806', 'USC - The Coming', 'Contract and commercial reconciliation'),
    ('a16881b5-d204-487f-805e-cdcbdb1ef586', 'Vasudev Sarvam', 'Contract and commercial reconciliation'),
    ('dc1fb518-8e10-42b5-9aab-7de223cc28a8', 'Visma', 'Contract and commercial reconciliation'),
    ('27141749-d8f5-4c6e-b7d0-5350433f1147', 'Wavemaker', 'Contract and commercial reconciliation'),
    ('36243675-1418-49a5-a8cf-846562fa9102', 'Whilter', 'Contract and commercial reconciliation')
), resolved AS (
  SELECT
    verified_accounts.*,
    po."stripeCustomerId",
    po."stripeSubscriptionId"
  FROM verified_accounts
  JOIN "productOrganization" po ON po."externalId" = verified_accounts."organizationId"
), rules AS (
  SELECT
    'contract-enterprise-org-' || md5(resolved."organizationId") AS id,
    'ORGANIZATION_ID'::"RevenueDoorMatchKind" AS "matchKind",
    resolved."organizationId" AS "matchValue",
    resolved.label,
    jsonb_build_object(
      'source', resolved."mappingSource",
      'stripeCustomerId', resolved."stripeCustomerId",
      'stripeSubscriptionId', resolved."stripeSubscriptionId"
    ) AS evidence
  FROM resolved
  UNION ALL
  SELECT
    'contract-enterprise-stripe-' || md5(resolved."stripeCustomerId") AS id,
    'STRIPE_CUSTOMER_ID'::"RevenueDoorMatchKind",
    resolved."stripeCustomerId",
    resolved.label,
    jsonb_build_object('source', resolved."mappingSource", 'organizationId', resolved."organizationId")
  FROM resolved
  WHERE resolved."stripeCustomerId" IS NOT NULL
)
INSERT INTO "revenueDoorRule" (
  "id", "policyId", "door", "matchKind", "matchValue", "label", "active",
  "evidence", "createdAt", "updatedAt"
)
SELECT
  rules.id,
  'company-revenue-doors',
  'ENTERPRISE',
  rules."matchKind",
  rules."matchValue",
  rules.label,
  true,
  rules.evidence,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM rules
ON CONFLICT ("policyId", "matchKind", "matchValue") DO UPDATE SET
  "door" = EXCLUDED."door",
  "label" = EXCLUDED."label",
  "active" = EXCLUDED."active",
  "evidence" = EXCLUDED."evidence",
  "updatedAt" = CURRENT_TIMESTAMP;
