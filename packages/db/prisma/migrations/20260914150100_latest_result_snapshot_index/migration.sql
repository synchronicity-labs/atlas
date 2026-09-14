CREATE INDEX CONCURRENTLY "resultSnapshot_questionExternalId_capturedAt_id_idx" ON "public"."resultSnapshot" ("questionExternalId", "capturedAt" DESC, "id" DESC);
