CREATE TABLE "metrics"."metricCatalogEvidence" (
    "id" TEXT NOT NULL,
    "catalogEntryId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CANDIDATE_RESULT',
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metricCatalogEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "metricCatalogEvidence_catalogEntryId_questionId_kind_key"
ON "metrics"."metricCatalogEvidence"("catalogEntryId", "questionId", "kind");

CREATE INDEX "metricCatalogEvidence_questionId_idx"
ON "metrics"."metricCatalogEvidence"("questionId");

ALTER TABLE "metrics"."metricCatalogEvidence"
ADD CONSTRAINT "metricCatalogEvidence_catalogEntryId_fkey"
FOREIGN KEY ("catalogEntryId") REFERENCES "metrics"."metricCatalogEntry"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "metrics"."metricCatalogEvidence"
ADD CONSTRAINT "metricCatalogEvidence_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "question"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
