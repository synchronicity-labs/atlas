CREATE TYPE "metrics"."MetricCatalogAttemptOutcome" AS ENUM (
  'DATA_FOUND',
  'NO_ROWS',
  'QUERY_FAILED',
  'QUERY_NOT_BUILT',
  'SOURCE_MISSING',
  'SOURCE_ERROR',
  'SOURCE_UNKNOWN'
);

ALTER TYPE "public"."QuestionStatus" ADD VALUE IF NOT EXISTS 'DRAFT';

ALTER TABLE "metrics"."metricCatalogEntry"
  ADD COLUMN "canonicalQuestionId" TEXT;

CREATE INDEX "metricCatalogEntry_canonicalQuestionId_idx"
  ON "metrics"."metricCatalogEntry"("canonicalQuestionId");

ALTER TABLE "metrics"."metricCatalogEntry"
  ADD CONSTRAINT "metricCatalogEntry_canonicalQuestionId_fkey"
  FOREIGN KEY ("canonicalQuestionId") REFERENCES "public"."question"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "metrics"."metricCatalogAttempt" (
  "id" TEXT NOT NULL,
  "catalogEntryId" TEXT NOT NULL,
  "runKey" TEXT NOT NULL,
  "outcome" "metrics"."MetricCatalogAttemptOutcome" NOT NULL,
  "trustStatus" "metrics"."MetricTrustStatus" NOT NULL,
  "detail" TEXT NOT NULL,
  "observations" JSONB NOT NULL,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "metricCatalogAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "metricCatalogAttempt_catalogEntryId_runKey_key"
  ON "metrics"."metricCatalogAttempt"("catalogEntryId", "runKey");

CREATE INDEX "metricCatalogAttempt_catalogEntryId_attemptedAt_idx"
  ON "metrics"."metricCatalogAttempt"("catalogEntryId", "attemptedAt");

CREATE INDEX "metricCatalogAttempt_outcome_trustStatus_idx"
  ON "metrics"."metricCatalogAttempt"("outcome", "trustStatus");

ALTER TABLE "metrics"."metricCatalogAttempt"
  ADD CONSTRAINT "metricCatalogAttempt_catalogEntryId_fkey"
  FOREIGN KEY ("catalogEntryId") REFERENCES "metrics"."metricCatalogEntry"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
