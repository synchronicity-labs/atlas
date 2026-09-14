CREATE INDEX CONCURRENTLY "metricSnapshot_metricVersionId_computedAt_id_idx" ON "metrics"."metricSnapshot" ("metricVersionId", "computedAt" DESC, "id" DESC);
