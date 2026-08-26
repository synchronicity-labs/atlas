UPDATE "question"
SET
  "name" = 'Active pilot registry and product adoption',
  "description" = 'Current active Enterprise and Studio pilots joined to product workspaces by exact company-domain evidence. Unmatched pilots remain visible as not verified. The result includes eligible users, pending invites, 24-hour and all-time generations, completion outcomes, output hours, model and surface mix, and latest activity without exposing domains, emails, or product identifiers.',
  "connector" = 'HUBSPOT',
  "sourceId" = (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'),
  "sourceExternalId" = 'cron:active-pilots:adoption',
  "sourceDashboardExternalId" = '15158250',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-active-pilot-adoption';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-active-pilot-adoption-v2',
  'atlas-cron-question-active-pilot-adoption',
  2,
  'API',
  '{"source":"hubspot","report":"active-pilot-adoption","months":1,"pipelines":["989457121","1984250589"]}',
  'table',
  '{"columns":["account","pilot_status","pilot_start","pilot_end","owner","workspace_mapping","matched_workspaces","users","active_users_24h","pending_invites","generations_24h","generations_to_date","completed_generations","failed_generations","output_hours","model_usage","surface_usage","latest_activity_at","data_through"]}'::jsonb,
  NULL,
  'atlas-sales-pilot-adoption-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-sales-card-active-pilot-adoption',
  'atlas-sales-dashboard',
  'atlas-sales-tab-overview',
  'atlas-cron-question-active-pilot-adoption',
  7,
  0,
  35,
  24,
  10,
  'TABLE',
  '{"compact":true,"unmatchedLabel":"not_verified"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "questionId" = EXCLUDED."questionId",
  "position" = EXCLUDED."position",
  "x" = EXCLUDED."x",
  "y" = EXCLUDED."y",
  "width" = EXCLUDED."width",
  "height" = EXCLUDED."height",
  "visualization" = EXCLUDED."visualization",
  "displaySettings" = EXCLUDED."displaySettings",
  "updatedAt" = CURRENT_TIMESTAMP;
