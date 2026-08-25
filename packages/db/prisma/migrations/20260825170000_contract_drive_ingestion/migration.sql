ALTER TYPE "DataSourceKind" ADD VALUE 'GOOGLE_DRIVE';
ALTER TYPE "ExternalRecordKind" ADD VALUE 'DOCUMENT';

ALTER TABLE "sourceRecord" ADD COLUMN "sourceDeletedAt" TIMESTAMP(3);

CREATE INDEX "sourceRecord_sourceId_sourceDeletedAt_idx" ON "sourceRecord"("sourceId", "sourceDeletedAt");
