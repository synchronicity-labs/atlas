ALTER TYPE "ExternalRecordKind" ADD VALUE IF NOT EXISTS 'ACTIVITY';

UPDATE "dashboard"
SET
  "description" = 'A live Atlas mirror of HubSpot sales operations, with the source reports, pipeline analysis, bookings, and every underlying question kept inspectable.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-sales-dashboard';

UPDATE "dashboardTab"
SET "name" = 'HubSpot mirror', "position" = 0
WHERE "id" = 'atlas-sales-tab-overview';

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-sales-tab-analysis', 'atlas-sales-dashboard', 4, 'Pipeline analysis', 3,
  'hubspot:dashboard:15158250'
) ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

UPDATE "dashboardCard"
SET "tabId" = 'atlas-sales-tab-analysis', "updatedAt" = CURRENT_TIMESTAMP
WHERE "tabId" = 'atlas-sales-tab-overview';

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "status", "createdAt", "updatedAt"
) VALUES
  ('atlas-sales-question-hubspot-forecast', 3021, 'Deal revenue forecast by stages', 'Weighted deal revenue with a close date in the rolling last 30 days, grouped by the live HubSpot stage probability.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:deal-revenue-forecast-by-stage', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-hubspot-contact-totals', 3022, 'Contacts created and worked totals with deals created and won totals', 'Rolling 30-day contacts and deals operating totals compared with the same period one year earlier.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:contact-deal-totals', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-hubspot-team-activity', 3023, 'Team activity totals', 'Rolling 30-day sales emails, meetings, notes, and tasks compared with the previous 30-day period.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:team-activity-totals', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-hubspot-closed-goal', 3024, 'Deal closed totals vs. goal', 'Cumulative closed-won deal amount by day across the rolling last 30 days, with the HubSpot revenue goal as a comparison series.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:closed-deal-vs-goal', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-hubspot-lead-pipeline', 3025, 'Lead pipeline status', 'Current HubSpot lead count grouped by pipeline stage category.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:lead-pipeline-status', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-question-hubspot-lead-stage', 3026, 'Lead stage view', 'Current HubSpot lead count grouped by its source pipeline stage identifier.', 'HUBSPOT', (SELECT "id" FROM "dataSource" WHERE "key" = 'hubspot:crm'), 'sales:lead-stage-view', '15158250', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "sourceId" = EXCLUDED."sourceId",
  "sourceExternalId" = EXCLUDED."sourceExternalId",
  "sourceDashboardExternalId" = EXCLUDED."sourceDashboardExternalId",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  ('atlas-sales-version-hubspot-forecast', 'atlas-sales-question-hubspot-forecast', 1, 'API', '{"source":"hubspot","report":"deal-revenue-forecast-by-stage","months":1,"pipelines":[]}', 'bar', '{"presentation":"forecast-stage"}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-hubspot-contact-totals', 'atlas-sales-question-hubspot-contact-totals', 1, 'API', '{"source":"hubspot","report":"contact-deal-totals","months":1,"pipelines":[]}', 'table', '{"presentation":"metric-strip"}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-hubspot-team-activity', 'atlas-sales-question-hubspot-team-activity', 1, 'API', '{"source":"hubspot","report":"team-activity-totals","months":1,"pipelines":[]}', 'table', '{"presentation":"metric-strip"}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-hubspot-closed-goal', 'atlas-sales-question-hubspot-closed-goal', 1, 'API', '{"source":"hubspot","report":"closed-deal-vs-goal","months":1,"pipelines":[]}', 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-hubspot-lead-pipeline', 'atlas-sales-question-hubspot-lead-pipeline', 1, 'API', '{"source":"hubspot","report":"lead-pipeline-status","months":1,"pipelines":[]}', 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-sales-version-hubspot-lead-stage', 'atlas-sales-question-hubspot-lead-stage', 1, 'API', '{"source":"hubspot","report":"lead-stage-view","months":1,"pipelines":[]}', 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES
  ('atlas-sales-card-hubspot-forecast', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-hubspot-forecast', 0, 0, 0, 12, 9, 'BAR', '{"presentation":"forecast-stage","periodLabel":"Last 30 days"}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-hubspot-contact-totals', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-hubspot-contact-totals', 1, 12, 0, 12, 9, 'TABLE', '{"presentation":"metric-strip","periodLabel":"Last 30 days","comparisonLabel":"Compared to 1 year before"}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-hubspot-team-activity', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-hubspot-team-activity', 2, 0, 9, 12, 9, 'TABLE', '{"presentation":"metric-strip","periodLabel":"Last 30 days","comparisonLabel":"Previous 30 days"}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-hubspot-closed-goal', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-hubspot-closed-goal', 3, 12, 9, 12, 9, 'LINE', '{"periodLabel":"Last 30 days · daily"}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-hubspot-lead-pipeline', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-hubspot-lead-pipeline', 4, 0, 18, 12, 9, 'BAR', '{"unavailableMessage":"The current HubSpot token is missing the read-only Leads scope. Existing deal, contact, and activity reports remain live."}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-sales-card-hubspot-lead-stage', 'atlas-sales-dashboard', 'atlas-sales-tab-overview', 'atlas-sales-question-hubspot-lead-stage', 5, 12, 18, 12, 9, 'BAR', '{"unavailableMessage":"The current HubSpot token is missing the read-only Leads scope. Add it to populate this question without changing the dashboard."}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "tabId" = EXCLUDED."tabId",
  "position" = EXCLUDED."position",
  "x" = EXCLUDED."x",
  "y" = EXCLUDED."y",
  "width" = EXCLUDED."width",
  "height" = EXCLUDED."height",
  "visualization" = EXCLUDED."visualization",
  "displaySettings" = EXCLUDED."displaySettings",
  "updatedAt" = CURRENT_TIMESTAMP;
