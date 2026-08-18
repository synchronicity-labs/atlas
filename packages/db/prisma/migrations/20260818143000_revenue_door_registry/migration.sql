CREATE TYPE "RevenueDoor" AS ENUM (
  'TOOLS',
  'PARTNERS',
  'PRODUCTIONS',
  'ENTERPRISE',
  'PROGRAM'
);

CREATE TYPE "RevenueDoorMatchKind" AS ENUM (
  'PLAN',
  'EMAIL_DOMAIN',
  'ORGANIZATION_ID',
  'STRIPE_CUSTOMER_ID'
);

CREATE TYPE "RevenueDoorPolicyStatus" AS ENUM ('PARTIAL', 'COMPLETE');

CREATE TABLE "revenueDoorPolicy" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "RevenueDoorPolicyStatus" NOT NULL DEFAULT 'PARTIAL',
  "notes" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "revenueDoorPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "revenueDoorRule" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "door" "RevenueDoor" NOT NULL,
  "matchKind" "RevenueDoorMatchKind" NOT NULL,
  "matchValue" TEXT NOT NULL,
  "label" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "revenueDoorRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "revenueDoorRule_policyId_matchKind_matchValue_key"
ON "revenueDoorRule"("policyId", "matchKind", "matchValue");

CREATE INDEX "revenueDoorRule_policyId_door_active_idx"
ON "revenueDoorRule"("policyId", "door", "active");

ALTER TABLE "revenueDoorRule"
ADD CONSTRAINT "revenueDoorRule_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "revenueDoorPolicy"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "revenueDoorPolicy" (
  "id",
  "name",
  "status",
  "notes",
  "createdAt",
  "updatedAt"
) VALUES (
  'company-revenue-doors',
  'Company revenue doors',
  'PARTIAL',
  'The channel-partner list is incomplete. Sync Tools results must remain pending until the registry is reviewed and marked complete.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO "revenueDoorRule" (
  "id",
  "policyId",
  "door",
  "matchKind",
  "matchValue",
  "label",
  "active",
  "evidence",
  "createdAt",
  "updatedAt"
) VALUES
  ('revenue-rule-plan-enterprise', 'company-revenue-doors', 'ENTERPRISE', 'PLAN', 'enterprise', 'Enterprise plan', true, '{"source":"Prady revenue-door definition"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-plan-program', 'company-revenue-doors', 'PROGRAM', 'PLAN', 'program', 'Program plan', true, '{"source":"Prady revenue-door definition"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-plan-partner', 'company-revenue-doors', 'PARTNERS', 'PLAN', 'partner', 'Partner plan', true, '{"source":"Existing product plan"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-fal', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'fal.ai', 'fal.ai', true, '{"source":"Nacho partial channel-partner list","complete":false}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-higgsfield', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'higgsfield.ai', 'higgsfield.ai', true, '{"source":"Nacho partial channel-partner list","complete":false}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-replicate', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'replicate.com', 'replicate.com', true, '{"source":"Nacho partial channel-partner list","complete":false}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('revenue-rule-domain-magichour', 'company-revenue-doors', 'PARTNERS', 'EMAIL_DOMAIN', 'magichour.ai', 'magichour.ai', true, '{"source":"Nacho partial channel-partner list","complete":false}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
