INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'hubspot-crm-source', 'hubspot:crm', 'HUBSPOT', 'HubSpot CRM',
  'STALE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("key") DO NOTHING;

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-sales-dashboard', 4, 'Sales pipeline & bookings',
  'A live Atlas mirror of HubSpot deal flow: pipeline coverage, bookings, conversion, ownership, and every underlying deal.',
  1, 'atlas', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES
  ('atlas-sales-tab-overview', 'atlas-sales-dashboard', 1, 'Overview', 0, 'hubspot:dashboard:15158250'),
  ('atlas-sales-tab-enterprise', 'atlas-sales-dashboard', 2, 'Enterprise', 1, 'hubspot:pipeline:989457121'),
  ('atlas-sales-tab-studios', 'atlas-sales-dashboard', 3, 'Studios', 2, 'hubspot:pipeline:1984250589');

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "status", "createdAt", "updatedAt"
) VALUES
  ('atlas-sales-question-open', 3001, 'Open pipeline', 'Current open deal amount across every HubSpot sales pipeline.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:open-pipeline', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-weighted', 3002, 'Weighted pipeline', 'Current open pipeline weighted by HubSpot forecast or stage probability.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:weighted-pipeline', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-won', 3003, 'Closed won bookings', 'Closed won deal amount by close month, including current month to date.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:closed-won', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-created', 3004, 'New pipeline created', 'Deals and gross pipeline amount created by month.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:deals-created', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-win-rate', 3005, 'Deal win rate', 'Closed won deals divided by all deals closed in each month.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:win-rate', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-stage', 3006, 'Open pipeline by stage', 'Current open deals, amount, and weighted amount in every HubSpot pipeline stage.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:pipeline-by-stage', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-owner', 3007, 'Open pipeline by owner', 'Current open deal count, amount, and weighted amount by HubSpot owner.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:pipeline-by-owner', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-cycle', 3008, 'Sales cycle', 'Average days to close for closed won deals by month.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:sales-cycle', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-forecast', 3009, 'Pipeline by expected close month', 'Open and weighted pipeline grouped by expected close month.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:open-deal-forecast', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-deals', 3010, 'Largest open deals', 'The largest current open HubSpot deals with company, pipeline, stage, owner, and close date.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:open-deals', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-enterprise-open', 3011, 'Enterprise open pipeline', 'Current open amount in the Sync enterprise pipeline.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:enterprise:open-pipeline', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-enterprise-weighted', 3012, 'Enterprise weighted pipeline', 'Weighted open amount in the Sync enterprise pipeline.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:enterprise:weighted-pipeline', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-enterprise-won', 3013, 'Enterprise closed won', 'Enterprise closed won bookings by month.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:enterprise:closed-won', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-enterprise-stage', 3014, 'Enterprise pipeline by stage', 'Open enterprise deals and amount by stage.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:enterprise:pipeline-by-stage', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-enterprise-deals', 3015, 'Enterprise open deals', 'Current enterprise opportunities with ownership and expected close.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:enterprise:open-deals', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-studios-open', 3016, 'Studios open pipeline', 'Current open amount in the Sync studios pipeline.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:studios:open-pipeline', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-studios-weighted', 3017, 'Studios weighted pipeline', 'Weighted open amount in the Sync studios pipeline.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:studios:weighted-pipeline', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-studios-won', 3018, 'Studios closed won', 'Studios closed won bookings by month.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:studios:closed-won', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-studios-stage', 3019, 'Studios pipeline by stage', 'Open studios deals and amount by stage.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:studios:pipeline-by-stage', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-studios-deals', 3020, 'Studios open deals', 'Current studios opportunities with ownership and expected close.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:studios:open-deals', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  ('atlas-sales-version-open', 'atlas-sales-question-open', 1, 'API', '{"source":"hubspot","report":"open-pipeline","months":6,"pipelines":[]}', 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-weighted', 'atlas-sales-question-weighted', 1, 'API', '{"source":"hubspot","report":"weighted-pipeline","months":6,"pipelines":[]}', 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-won', 'atlas-sales-question-won', 1, 'API', '{"source":"hubspot","report":"closed-won","months":6,"pipelines":[]}', 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-created', 'atlas-sales-question-created', 1, 'API', '{"source":"hubspot","report":"deals-created","months":6,"pipelines":[]}', 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-win-rate', 'atlas-sales-question-win-rate', 1, 'API', '{"source":"hubspot","report":"win-rate","months":6,"pipelines":[]}', 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-stage', 'atlas-sales-question-stage', 1, 'API', '{"source":"hubspot","report":"pipeline-by-stage","months":6,"pipelines":[]}', 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-owner', 'atlas-sales-question-owner', 1, 'API', '{"source":"hubspot","report":"pipeline-by-owner","months":6,"pipelines":[]}', 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-cycle', 'atlas-sales-question-cycle', 1, 'API', '{"source":"hubspot","report":"sales-cycle","months":6,"pipelines":[]}', 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-forecast', 'atlas-sales-question-forecast', 1, 'API', '{"source":"hubspot","report":"open-deal-forecast","months":6,"pipelines":[]}', 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-deals', 'atlas-sales-question-deals', 1, 'API', '{"source":"hubspot","report":"open-deals","months":6,"pipelines":[]}', 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-enterprise-open', 'atlas-sales-question-enterprise-open', 1, 'API', '{"source":"hubspot","report":"open-pipeline","months":6,"pipelines":["989457121"]}', 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-enterprise-weighted', 'atlas-sales-question-enterprise-weighted', 1, 'API', '{"source":"hubspot","report":"weighted-pipeline","months":6,"pipelines":["989457121"]}', 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-enterprise-won', 'atlas-sales-question-enterprise-won', 1, 'API', '{"source":"hubspot","report":"closed-won","months":6,"pipelines":["989457121"]}', 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-enterprise-stage', 'atlas-sales-question-enterprise-stage', 1, 'API', '{"source":"hubspot","report":"pipeline-by-stage","months":6,"pipelines":["989457121"]}', 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-enterprise-deals', 'atlas-sales-question-enterprise-deals', 1, 'API', '{"source":"hubspot","report":"open-deals","months":6,"pipelines":["989457121"]}', 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-studios-open', 'atlas-sales-question-studios-open', 1, 'API', '{"source":"hubspot","report":"open-pipeline","months":6,"pipelines":["1984250589"]}', 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-studios-weighted', 'atlas-sales-question-studios-weighted', 1, 'API', '{"source":"hubspot","report":"weighted-pipeline","months":6,"pipelines":["1984250589"]}', 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-studios-won', 'atlas-sales-question-studios-won', 1, 'API', '{"source":"hubspot","report":"closed-won","months":6,"pipelines":["1984250589"]}', 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-studios-stage', 'atlas-sales-question-studios-stage', 1, 'API', '{"source":"hubspot","report":"pipeline-by-stage","months":6,"pipelines":["1984250589"]}', 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-studios-deals', 'atlas-sales-question-studios-deals', 1, 'API', '{"source":"hubspot","report":"open-deals","months":6,"pipelines":["1984250589"]}', 'table', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP);

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES
  ('atlas-sales-card-open', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-open', 0, 0, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-weighted', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-weighted', 1, 6, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-won-kpi', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-won', 2, 12, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-win-rate', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-win-rate', 3, 18, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-created', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-created', 4, 0, 5, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-won-history', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-won', 5, 12, 5, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-stage', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-stage', 6, 0, 13, 12, 9, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-owner', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-owner', 7, 12, 13, 12, 9, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-forecast', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-forecast', 8, 0, 22, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-cycle', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-cycle', 9, 12, 22, 12, 8, 'LINE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-deals', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-deals', 10, 0, 30, 24, 10, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-enterprise-open', 'atlas-sales-dashboard', 'atlas-sales-tab-enterprise', 'atlas-sales-question-enterprise-open', 0, 0, 0, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-enterprise-weighted', 'atlas-sales-dashboard', 'atlas-sales-tab-enterprise', 'atlas-sales-question-enterprise-weighted', 1, 8, 0, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-enterprise-won-kpi', 'atlas-sales-dashboard', 'atlas-sales-tab-enterprise', 'atlas-sales-question-enterprise-won', 2, 16, 0, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-enterprise-won', 'atlas-sales-dashboard', 'atlas-sales-tab-enterprise', 'atlas-sales-question-enterprise-won', 3, 0, 5, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-enterprise-stage', 'atlas-sales-dashboard', 'atlas-sales-tab-enterprise', 'atlas-sales-question-enterprise-stage', 4, 12, 5, 12, 8, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-enterprise-deals', 'atlas-sales-dashboard', 'atlas-sales-tab-enterprise', 'atlas-sales-question-enterprise-deals', 5, 0, 13, 24, 10, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-studios-open', 'atlas-sales-dashboard', 'atlas-sales-tab-studios', 'atlas-sales-question-studios-open', 0, 0, 0, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-studios-weighted', 'atlas-sales-dashboard', 'atlas-sales-tab-studios', 'atlas-sales-question-studios-weighted', 1, 8, 0, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-studios-won-kpi', 'atlas-sales-dashboard', 'atlas-sales-tab-studios', 'atlas-sales-question-studios-won', 2, 16, 0, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-studios-won', 'atlas-sales-dashboard', 'atlas-sales-tab-studios', 'atlas-sales-question-studios-won', 3, 0, 5, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-studios-stage', 'atlas-sales-dashboard', 'atlas-sales-tab-studios', 'atlas-sales-question-studios-stage', 4, 12, 5, 12, 8, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-studios-deals', 'atlas-sales-dashboard', 'atlas-sales-tab-studios', 'atlas-sales-question-studios-deals', 5, 0, 13, 24, 10, 'TABLE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
