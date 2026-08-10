-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('METABASE', 'STRIPE', 'HUBSPOT', 'ATLAS');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('UNCONFIGURED', 'SYNCING', 'HEALTHY', 'STALE', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('INCREMENTAL', 'BACKFILL');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "QueryLanguage" AS ENUM ('SQL', 'MBQL');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VisualizationType" AS ENUM ('NUMBER', 'LINE', 'AREA', 'BAR', 'PIE', 'TABLE', 'FUNNEL', 'TEXT');

-- CreateTable
CREATE TABLE "dataSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "DataSourceKind" NOT NULL,
    "label" TEXT NOT NULL,
    "state" "SourceStatus" NOT NULL DEFAULT 'UNCONFIGURED',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "freshnessDeadlineAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourceDashboard" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tabs" JSONB NOT NULL,
    "metadataHash" TEXT NOT NULL,
    "metadata" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sourceDashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourceCard" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "dashcardExternalId" TEXT NOT NULL,
    "tabExternalId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "display" TEXT NOT NULL,
    "queryType" TEXT,
    "databaseExternalId" TEXT,
    "metadata" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sourceCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syncRun" (
    "id" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "mode" "SyncMode" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "scope" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "cardsProcessed" INTEGER NOT NULL DEFAULT 0,
    "snapshotsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "syncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syncCursor" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "mode" "SyncMode" NOT NULL,
    "scope" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "offset" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "completedPeriods" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "syncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultSnapshot" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dashboardExternalId" TEXT,
    "questionExternalId" TEXT NOT NULL,
    "reportingPeriod" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resultSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "connector" "DataSourceKind" NOT NULL,
    "sourceId" TEXT,
    "sourceExternalId" TEXT,
    "sourceDashboardExternalId" TEXT,
    "databaseExternalId" TEXT,
    "status" "QuestionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "queryLanguage" "QueryLanguage" NOT NULL,
    "queryText" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "visualization" JSONB NOT NULL,
    "sourceCardExternalId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "layoutVersion" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboardTab" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sourceExternalId" TEXT,

    CONSTRAINT "dashboardTab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboardCard" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "tabId" TEXT,
    "questionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "visualization" "VisualizationType" NOT NULL,
    "displaySettings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboardCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productUser" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "role" TEXT,
    "disabled" BOOLEAN,
    "isAnonymous" BOOLEAN,
    "avatarUrl" TEXT,
    "locale" TEXT,
    "phoneNumber" TEXT,
    "emailVerified" BOOLEAN,
    "createdAtSource" TIMESTAMP(3),
    "updatedAtSource" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "traits" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productUserIdentity" (
    "id" TEXT NOT NULL,
    "productUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "productUserIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productOrganization" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "domain" TEXT,
    "plan" TEXT,
    "paymentStatus" JSONB,
    "stripeSubscriptionId" TEXT,
    "stripeCustomerId" TEXT,
    "traits" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productOrganizationMembership" (
    "id" TEXT NOT NULL,
    "productUserId" TEXT NOT NULL,
    "productOrganizationId" TEXT NOT NULL,
    "role" TEXT,
    "traits" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productOrganizationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productUserSnapshot" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "productUserId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "productUserSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataSource_key_key" ON "dataSource"("key");

-- CreateIndex
CREATE INDEX "sourceDashboard_sourceId_syncedAt_idx" ON "sourceDashboard"("sourceId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sourceDashboard_sourceId_externalId_key" ON "sourceDashboard"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "sourceCard_sourceId_externalId_idx" ON "sourceCard"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "sourceCard_dashboardId_tabExternalId_idx" ON "sourceCard"("dashboardId", "tabExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "sourceCard_sourceId_dashcardExternalId_key" ON "sourceCard"("sourceId", "dashcardExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "syncRun_runKey_key" ON "syncRun"("runKey");

-- CreateIndex
CREATE INDEX "syncRun_sourceId_startedAt_idx" ON "syncRun"("sourceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "syncCursor_sourceId_mode_scope_key" ON "syncCursor"("sourceId", "mode", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "resultSnapshot_idempotencyKey_key" ON "resultSnapshot"("idempotencyKey");

-- CreateIndex
CREATE INDEX "resultSnapshot_questionExternalId_reportingPeriod_capturedA_idx" ON "resultSnapshot"("questionExternalId", "reportingPeriod", "capturedAt");

-- CreateIndex
CREATE INDEX "resultSnapshot_sourceId_capturedAt_idx" ON "resultSnapshot"("sourceId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "question_number_key" ON "question"("number");

-- CreateIndex
CREATE INDEX "question_status_updatedAt_idx" ON "question"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "question_connector_sourceExternalId_key" ON "question"("connector", "sourceExternalId");

-- CreateIndex
CREATE INDEX "questionVersion_questionId_createdAt_idx" ON "questionVersion"("questionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "questionVersion_questionId_version_key" ON "questionVersion"("questionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_number_key" ON "dashboard"("number");

-- CreateIndex
CREATE INDEX "dashboardTab_dashboardId_position_idx" ON "dashboardTab"("dashboardId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "dashboardTab_dashboardId_number_key" ON "dashboardTab"("dashboardId", "number");

-- CreateIndex
CREATE INDEX "dashboardCard_dashboardId_position_idx" ON "dashboardCard"("dashboardId", "position");

-- CreateIndex
CREATE INDEX "dashboardCard_tabId_position_idx" ON "dashboardCard"("tabId", "position");

-- CreateIndex
CREATE INDEX "dashboardCard_questionId_idx" ON "dashboardCard"("questionId");

-- CreateIndex
CREATE INDEX "productUser_email_idx" ON "productUser"("email");

-- CreateIndex
CREATE INDEX "productUser_displayName_idx" ON "productUser"("displayName");

-- CreateIndex
CREATE INDEX "productUser_lastSeenAt_idx" ON "productUser"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "productUser_sourceId_externalId_key" ON "productUser"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "productUserIdentity_normalizedValue_idx" ON "productUserIdentity"("normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "productUserIdentity_productUserId_kind_normalizedValue_key" ON "productUserIdentity"("productUserId", "kind", "normalizedValue");

-- CreateIndex
CREATE INDEX "productOrganization_name_idx" ON "productOrganization"("name");

-- CreateIndex
CREATE INDEX "productOrganization_domain_idx" ON "productOrganization"("domain");

-- CreateIndex
CREATE INDEX "productOrganization_stripeCustomerId_idx" ON "productOrganization"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "productOrganization_sourceId_externalId_key" ON "productOrganization"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "productOrganizationMembership_productOrganizationId_idx" ON "productOrganizationMembership"("productOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "productOrganizationMembership_productUserId_productOrganiza_key" ON "productOrganizationMembership"("productUserId", "productOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "productUserSnapshot_idempotencyKey_key" ON "productUserSnapshot"("idempotencyKey");

-- CreateIndex
CREATE INDEX "productUserSnapshot_productUserId_capturedAt_idx" ON "productUserSnapshot"("productUserId", "capturedAt");

-- CreateIndex
CREATE INDEX "productUserSnapshot_sourceId_capturedAt_idx" ON "productUserSnapshot"("sourceId", "capturedAt");

-- AddForeignKey
ALTER TABLE "sourceDashboard" ADD CONSTRAINT "sourceDashboard_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourceCard" ADD CONSTRAINT "sourceCard_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourceCard" ADD CONSTRAINT "sourceCard_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "sourceDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syncRun" ADD CONSTRAINT "syncRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syncCursor" ADD CONSTRAINT "syncCursor_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultSnapshot" ADD CONSTRAINT "resultSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question" ADD CONSTRAINT "question_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionVersion" ADD CONSTRAINT "questionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboardTab" ADD CONSTRAINT "dashboardTab_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboardCard" ADD CONSTRAINT "dashboardCard_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboardCard" ADD CONSTRAINT "dashboardCard_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "dashboardTab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboardCard" ADD CONSTRAINT "dashboardCard_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productUser" ADD CONSTRAINT "productUser_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productUserIdentity" ADD CONSTRAINT "productUserIdentity_productUserId_fkey" FOREIGN KEY ("productUserId") REFERENCES "productUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productOrganization" ADD CONSTRAINT "productOrganization_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productOrganizationMembership" ADD CONSTRAINT "productOrganizationMembership_productUserId_fkey" FOREIGN KEY ("productUserId") REFERENCES "productUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productOrganizationMembership" ADD CONSTRAINT "productOrganizationMembership_productOrganizationId_fkey" FOREIGN KEY ("productOrganizationId") REFERENCES "productOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productUserSnapshot" ADD CONSTRAINT "productUserSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productUserSnapshot" ADD CONSTRAINT "productUserSnapshot_productUserId_fkey" FOREIGN KEY ("productUserId") REFERENCES "productUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
