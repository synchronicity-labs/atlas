ALTER TYPE "DataSourceKind" ADD VALUE 'GOOGLE_SHEETS';

CREATE TYPE "metrics"."MetricCatalogKind" AS ENUM (
    'KPI',
    'VIEW',
    'DIAGNOSTIC',
    'ROADMAP_MEASURE',
    'UNCLASSIFIED'
);

CREATE TYPE "metrics"."MetricReadinessStatus" AS ENUM (
    'CATALOGED',
    'NEEDS_DEFINITION',
    'NEEDS_SOURCE',
    'READY_TO_IMPLEMENT',
    'IMPLEMENTING',
    'RECONCILING',
    'VERIFIED',
    'BLOCKED'
);

CREATE TABLE "metrics"."metricCatalogEntry" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "sourceTabId" INTEGER NOT NULL,
    "sourceTabName" TEXT NOT NULL,
    "sourceTabIndex" INTEGER NOT NULL,
    "sourceRange" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "externalKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerTeam" TEXT,
    "kind" "metrics"."MetricCatalogKind" NOT NULL DEFAULT 'UNCLASSIFIED',
    "readiness" "metrics"."MetricReadinessStatus" NOT NULL DEFAULT 'CATALOGED',
    "metricId" TEXT,
    "rawRow" JSONB NOT NULL,
    "ambiguities" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "missingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metricCatalogEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "metricCatalogEntry_sourceDocumentId_externalKey_key"
ON "metrics"."metricCatalogEntry"("sourceDocumentId", "externalKey");

CREATE INDEX "metricCatalogEntry_kind_readiness_idx"
ON "metrics"."metricCatalogEntry"("kind", "readiness");

CREATE INDEX "metricCatalogEntry_ownerTeam_readiness_idx"
ON "metrics"."metricCatalogEntry"("ownerTeam", "readiness");

CREATE INDEX "metricCatalogEntry_metricId_idx"
ON "metrics"."metricCatalogEntry"("metricId");

CREATE INDEX "metricCatalogEntry_sourceId_sourceTabIndex_sourceRow_idx"
ON "metrics"."metricCatalogEntry"("sourceId", "sourceTabIndex", "sourceRow");

ALTER TABLE "metrics"."metricCatalogEntry"
ADD CONSTRAINT "metricCatalogEntry_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "dataSource"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "metrics"."metricCatalogEntry"
ADD CONSTRAINT "metricCatalogEntry_metricId_fkey"
FOREIGN KEY ("metricId") REFERENCES "metrics"."metricDefinition"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
