CREATE TYPE "ContractCustomerKind" AS ENUM ('ENTERPRISE', 'PRODUCTION', 'CHANNEL_PARTNER');

ALTER TYPE "ContractFindingKind" ADD VALUE 'NO_STRIPE_ACCOUNT';

ALTER TABLE "contractCustomer"
ADD COLUMN "kind" "ContractCustomerKind" NOT NULL DEFAULT 'ENTERPRISE';

CREATE INDEX "contractCustomer_kind_deleted_idx"
ON "contractCustomer"("kind", "sourceDeletedAt");
