UPDATE "question"
SET
  "description" = 'Current unpaid pilot accounts from Product Postgres pilot markers after verified paid enterprise, production, and channel mappings. Product organization IDs join pilots to eligible workspaces. Unmatched pilots remain visible as not verified; pilot usage is excluded from paid revenue and product-usage populations.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-active-pilot-adoption';

INSERT INTO "questionVersion" (
  "id",
  "questionId",
  "version",
  "queryLanguage",
  "queryText",
  "display",
  "visualization",
  "sourceCardExternalId",
  "createdBy",
  "createdAt"
) VALUES (
  'atlas-cron-question-active-pilot-adoption-v3',
  'atlas-cron-question-active-pilot-adoption',
  3,
  'API',
  '{"source":"product","report":"active-pilot-adoption","months":1,"pipelines":[]}',
  'table',
  '{"columns":["account","pilot_status","pilot_start","pilot_end","owner","workspace_mapping","matched_workspaces","users","active_users_24h","pending_invites","generations_24h","generations_to_date","completed_generations","failed_generations","output_hours","model_usage","surface_usage","latest_activity_at","data_through"]}'::jsonb,
  NULL,
  'atlas-product-pilot-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "sourceCardExternalId" = EXCLUDED."sourceCardExternalId",
  "createdBy" = EXCLUDED."createdBy";

