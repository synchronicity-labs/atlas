BEGIN;

CREATE TABLE "public"."qbrPreparation" (
    "questionId" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "preparation" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "qbrPreparation_pkey" PRIMARY KEY ("questionId", "quarter", "version"),
    CONSTRAINT "qbrPreparation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "public"."question"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "public"."qbrPreparation" ("questionId", "quarter", "version", "preparation", "createdAt")
SELECT "questionId", '2026-Q3', "version", "visualization" #> '{qbr,preparation}', "createdAt"
FROM "public"."questionVersion"
WHERE "visualization" #> '{qbr,preparation}' IS NOT NULL;

UPDATE "public"."questionVersion"
SET "visualization" = "visualization" #- '{qbr,preparation}'
WHERE "visualization" #> '{qbr,preparation}' IS NOT NULL;

UPDATE "public"."questionChangeProposal"
SET "visualization" = "visualization" #- '{qbr,preparation}'
WHERE "visualization" #> '{qbr,preparation}' IS NOT NULL;

COMMIT;
