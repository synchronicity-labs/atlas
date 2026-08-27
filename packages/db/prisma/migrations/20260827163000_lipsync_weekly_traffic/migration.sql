INSERT INTO "dataSource" ("id", "key", "kind", "label", "state", "createdAt", "updatedAt")
VALUES ('atlas-lipsync-weekly-source', 'atlas:lipsync-weekly', 'ATLAS',
  'Lipsync GA4 and Search Console', 'UNCONFIGURED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "status", "purpose", "createdAt", "updatedAt"
) VALUES (
  'atlas-lipsync-weekly-traffic', 7100, 'Lipsync weekly traffic and search',
  'Two complete Monday-Sunday source-calendar weeks from GA4 property 525331485 and finalized sc-domain:lipsync.com totals. Each source shows its own period and time zone. Search has a three-day processing allowance. Q236 product conversion is a separate population.',
  'ATLAS', 'atlas-lipsync-weekly-source', 'cron:lipsync:weekly-traffic',
  'atlas:marketing:acquisition', 'ACTIVE', 'RECONCILIATION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES (
  'atlas-lipsync-weekly-traffic-v1', 'atlas-lipsync-weekly-traffic', 1, 'API',
  '{"source":"lipsync_traffic","report":"weekly-acquisition","version":1}',
  'table', '{}'::jsonb, 'atlas-lipsync-traffic-registry', CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES (
  'atlas-lipsync-weekly-traffic-card', 'atlas-marketing-dashboard',
  'atlas-marketing-tab-acquisition', 'atlas-lipsync-weekly-traffic', 20, 0, 60,
  24, 12, 'TABLE', '{"compact":true}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
