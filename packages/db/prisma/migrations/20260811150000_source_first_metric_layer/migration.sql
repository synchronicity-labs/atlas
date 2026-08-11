CREATE SCHEMA IF NOT EXISTS "core";

CREATE SCHEMA IF NOT EXISTS "atlas_app";

CREATE SCHEMA IF NOT EXISTS "ingestion";

CREATE SCHEMA IF NOT EXISTS "metrics";

CREATE TYPE "QuestionPurpose" AS ENUM ('CERTIFIED', 'EXPLORATORY', 'RECONCILIATION');

CREATE TYPE "core"."FactGrain" AS ENUM ('EVENT', 'DAY', 'WEEK', 'MONTH', 'QUARTER');

CREATE TYPE "metrics"."MetricLifecycleStatus" AS ENUM ('DRAFT', 'CERTIFIED', 'DEPRECATED');

CREATE TYPE "metrics"."MetricRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'VALIDATING', 'PUBLISHED', 'FAILED');

CREATE TYPE "metrics"."MetricTrustStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'STALE');

CREATE TYPE "metrics"."VerificationStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'WAIVED');

ALTER TYPE "DataSourceKind" ADD VALUE 'POSTGRES';
ALTER TYPE "DataSourceKind" ADD VALUE 'TINYBIRD';
ALTER TYPE "DataSourceKind" ADD VALUE 'GOOGLE_ANALYTICS';
ALTER TYPE "DataSourceKind" ADD VALUE 'GOOGLE_SEARCH_CONSOLE';

ALTER TABLE "question" ADD COLUMN     "metricVersionId" TEXT,
ADD COLUMN     "purpose" "QuestionPurpose" NOT NULL DEFAULT 'EXPLORATORY';

ALTER TABLE "syncCursor" ADD COLUMN     "checkpoint" JSONB,
ADD COLUMN     "dataThrough" TIMESTAMP(3),
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3);

ALTER TABLE "syncRun" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "dataThrough" TIMESTAMP(3),
ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "leasedAt" TIMESTAMP(3),
ADD COLUMN     "nextRetryAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "ingestion"."dataset" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "adapter" TEXT NOT NULL,
    "eventTimeField" TEXT NOT NULL,
    "watermarkField" TEXT,
    "cadenceMinutes" INTEGER NOT NULL,
    "freshnessSlaMinutes" INTEGER NOT NULL,
    "backfillWindowDays" INTEGER,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dataset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ingestion"."sourceWatermark" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "syncRunId" TEXT,
    "dataThrough" TIMESTAMP(3) NOT NULL,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "rowCount" INTEGER,
    "contentHash" TEXT,
    "checkpoint" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sourceWatermark_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "core"."normalizedFact" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "syncRunId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "grain" "core"."FactGrain" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "eventTime" TIMESTAMP(3),
    "dataThrough" TIMESTAMP(3) NOT NULL,
    "dimensions" JSONB NOT NULL,
    "measures" JSONB NOT NULL,
    "eligibility" JSONB,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "normalizedFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "metrics"."metricDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerTeam" TEXT NOT NULL,
    "status" "metrics"."MetricLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metricDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "metrics"."metricVersion" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "businessDefinition" JSONB NOT NULL,
    "normalizationPolicy" JSONB NOT NULL,
    "computation" JSONB NOT NULL,
    "verificationPolicy" JSONB NOT NULL,
    "cadence" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metricVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "metrics"."metricInput" (
    "id" TEXT NOT NULL,
    "metricVersionId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "queryLanguage" "QueryLanguage" NOT NULL,
    "queryText" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "expectedGrain" "core"."FactGrain" NOT NULL,
    "maxLagSeconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metricInput_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "metrics"."metricRun" (
    "id" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "metricVersionId" TEXT NOT NULL,
    "status" "metrics"."MetricRunStatus" NOT NULL DEFAULT 'QUEUED',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dataThrough" TIMESTAMP(3),
    "sourceWatermarks" JSONB NOT NULL,
    "inputHash" TEXT,
    "outputHash" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "validation" JSONB,
    "error" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "metricRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "metrics"."metricSnapshot" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metricVersionId" TEXT NOT NULL,
    "metricRunId" TEXT NOT NULL,
    "reportingPeriod" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dataThrough" TIMESTAMP(3) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "trustStatus" "metrics"."MetricTrustStatus" NOT NULL DEFAULT 'PENDING',
    "contentHash" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "metrics"."metricVerification" (
    "id" TEXT NOT NULL,
    "metricRunId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "metrics"."VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "referenceType" TEXT NOT NULL,
    "referenceValue" JSONB,
    "actualValue" JSONB,
    "tolerance" JSONB,
    "evidence" JSONB,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metricVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dataset_enabled_cadenceMinutes_idx" ON "ingestion"."dataset"("enabled", "cadenceMinutes");

CREATE UNIQUE INDEX "dataset_sourceId_key_key" ON "ingestion"."dataset"("sourceId", "key");

CREATE UNIQUE INDEX "sourceWatermark_idempotencyKey_key" ON "ingestion"."sourceWatermark"("idempotencyKey");

CREATE INDEX "sourceWatermark_datasetId_dataThrough_idx" ON "ingestion"."sourceWatermark"("datasetId", "dataThrough");

CREATE INDEX "sourceWatermark_sourceId_observedAt_idx" ON "ingestion"."sourceWatermark"("sourceId", "observedAt");

CREATE INDEX "sourceWatermark_syncRunId_idx" ON "ingestion"."sourceWatermark"("syncRunId");

CREATE UNIQUE INDEX "normalizedFact_idempotencyKey_key" ON "core"."normalizedFact"("idempotencyKey");

CREATE INDEX "normalizedFact_datasetId_periodStart_periodEnd_idx" ON "core"."normalizedFact"("datasetId", "periodStart", "periodEnd");

CREATE INDEX "normalizedFact_entityType_entityId_periodStart_idx" ON "core"."normalizedFact"("entityType", "entityId", "periodStart");

CREATE INDEX "normalizedFact_sourceId_dataThrough_idx" ON "core"."normalizedFact"("sourceId", "dataThrough");

CREATE INDEX "normalizedFact_syncRunId_idx" ON "core"."normalizedFact"("syncRunId");

CREATE UNIQUE INDEX "metricDefinition_key_key" ON "metrics"."metricDefinition"("key");

CREATE INDEX "metricDefinition_status_ownerTeam_idx" ON "metrics"."metricDefinition"("status", "ownerTeam");

CREATE INDEX "metricVersion_metricId_approvedAt_idx" ON "metrics"."metricVersion"("metricId", "approvedAt");

CREATE UNIQUE INDEX "metricVersion_metricId_version_key" ON "metrics"."metricVersion"("metricId", "version");

CREATE INDEX "metricInput_datasetId_metricVersionId_idx" ON "metrics"."metricInput"("datasetId", "metricVersionId");

CREATE UNIQUE INDEX "metricInput_metricVersionId_alias_key" ON "metrics"."metricInput"("metricVersionId", "alias");

CREATE UNIQUE INDEX "metricRun_runKey_key" ON "metrics"."metricRun"("runKey");

CREATE INDEX "metricRun_metricVersionId_periodStart_periodEnd_idx" ON "metrics"."metricRun"("metricVersionId", "periodStart", "periodEnd");

CREATE INDEX "metricRun_status_requestedAt_idx" ON "metrics"."metricRun"("status", "requestedAt");

CREATE UNIQUE INDEX "metricSnapshot_idempotencyKey_key" ON "metrics"."metricSnapshot"("idempotencyKey");

CREATE UNIQUE INDEX "metricSnapshot_metricRunId_key" ON "metrics"."metricSnapshot"("metricRunId");

CREATE INDEX "metricSnapshot_metricVersionId_reportingPeriod_computedAt_idx" ON "metrics"."metricSnapshot"("metricVersionId", "reportingPeriod", "computedAt");

CREATE INDEX "metricSnapshot_trustStatus_dataThrough_idx" ON "metrics"."metricSnapshot"("trustStatus", "dataThrough");

CREATE INDEX "metricVerification_status_createdAt_idx" ON "metrics"."metricVerification"("status", "createdAt");

CREATE UNIQUE INDEX "metricVerification_metricRunId_name_key" ON "metrics"."metricVerification"("metricRunId", "name");

CREATE INDEX "question_metricVersionId_purpose_idx" ON "question"("metricVersionId", "purpose");

CREATE INDEX "syncRun_status_nextRetryAt_idx" ON "syncRun"("status", "nextRetryAt");

CREATE INDEX "syncRun_leaseOwner_leasedAt_idx" ON "syncRun"("leaseOwner", "leasedAt");

ALTER TABLE "ingestion"."dataset" ADD CONSTRAINT "dataset_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ingestion"."sourceWatermark" ADD CONSTRAINT "sourceWatermark_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ingestion"."dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ingestion"."sourceWatermark" ADD CONSTRAINT "sourceWatermark_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ingestion"."sourceWatermark" ADD CONSTRAINT "sourceWatermark_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "syncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "core"."normalizedFact" ADD CONSTRAINT "normalizedFact_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ingestion"."dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "core"."normalizedFact" ADD CONSTRAINT "normalizedFact_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "core"."normalizedFact" ADD CONSTRAINT "normalizedFact_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "syncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "metrics"."metricVersion" ADD CONSTRAINT "metricVersion_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"."metricDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "metrics"."metricInput" ADD CONSTRAINT "metricInput_metricVersionId_fkey" FOREIGN KEY ("metricVersionId") REFERENCES "metrics"."metricVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "metrics"."metricInput" ADD CONSTRAINT "metricInput_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ingestion"."dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "metrics"."metricRun" ADD CONSTRAINT "metricRun_metricVersionId_fkey" FOREIGN KEY ("metricVersionId") REFERENCES "metrics"."metricVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "metrics"."metricSnapshot" ADD CONSTRAINT "metricSnapshot_metricVersionId_fkey" FOREIGN KEY ("metricVersionId") REFERENCES "metrics"."metricVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "metrics"."metricSnapshot" ADD CONSTRAINT "metricSnapshot_metricRunId_fkey" FOREIGN KEY ("metricRunId") REFERENCES "metrics"."metricRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "metrics"."metricVerification" ADD CONSTRAINT "metricVerification_metricRunId_fkey" FOREIGN KEY ("metricRunId") REFERENCES "metrics"."metricRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "question" ADD CONSTRAINT "question_metricVersionId_fkey" FOREIGN KEY ("metricVersionId") REFERENCES "metrics"."metricVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER INDEX "agentConversation_atlasContextKind_atlasContextId_lastMessageAt" RENAME TO "agentConversation_atlasContextKind_atlasContextId_lastMessa_idx";

ALTER INDEX "productOrganizationCompanyLink_productOrganizationId_companyId_" RENAME TO "productOrganizationCompanyLink_productOrganizationId_compan_key";
