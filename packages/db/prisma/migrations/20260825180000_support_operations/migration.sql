INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-pylon-support-source',
  'pylon:support',
  'ATLAS',
  'Pylon support aggregates',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-customer-lifecycle-tab-support',
  (SELECT "id" FROM "dashboard" WHERE "number" = 9),
  2,
  'Support operations',
  1,
  'atlas:customer-lifecycle:support'
)
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES
  (
    'atlas-support-question-issue-volume', 7030,
    'Support request volume',
    'Monthly customer support requests created in Pylon. Open and closed counts show the current state of requests that started in each UTC month.',
    'ATLAS', (SELECT "id" FROM "dataSource" WHERE "key" = 'pylon:support'),
    'atlas-support-issue-volume', 'atlas:customer-lifecycle:support', NULL,
    'ACTIVE', 'RECONCILIATION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-question-top-categories', 7031,
    'Top support request categories',
    'The most common Pylon tags on support requests, grouped by UTC month. A request can appear in more than one category when it has several tags.',
    'ATLAS', (SELECT "id" FROM "dataSource" WHERE "key" = 'pylon:support'),
    'atlas-support-top-categories', 'atlas:customer-lifecycle:support', NULL,
    'ACTIVE', 'RECONCILIATION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-question-response-resolution', 7032,
    'Support response and resolution time',
    'Average and median time to the first support reply, plus average and median time until a request is resolved. First response uses Pylon business hours when that value is available.',
    'ATLAS', (SELECT "id" FROM "dataSource" WHERE "key" = 'pylon:support'),
    'atlas-support-response-resolution', 'atlas:customer-lifecycle:support', NULL,
    'ACTIVE', 'RECONCILIATION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-question-channel-volume', 7033,
    'Support volume by channel',
    'Monthly support request volume split by the Pylon source channel, such as Slack, email, or chat.',
    'ATLAS', (SELECT "id" FROM "dataSource" WHERE "key" = 'pylon:support'),
    'atlas-support-channel-volume', 'atlas:customer-lifecycle:support', NULL,
    'ACTIVE', 'RECONCILIATION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-question-csat', 7034,
    'Customer Satisfaction score',
    'Monthly Customer Satisfaction score from Pylon surveys. Atlas stores only the score count and average. It does not store comments or customer identities.',
    'ATLAS', (SELECT "id" FROM "dataSource" WHERE "key" = 'pylon:support'),
    'atlas-support-csat', 'atlas:customer-lifecycle:support', NULL,
    'ACTIVE', 'RECONCILIATION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-question-remi-performance', 7035,
    'Remi performance',
    'Connection status for Remi performance. The result stays pending until the team confirms the customer outcome to measure and Atlas maps a read-only aggregate endpoint.',
    'ATLAS', (SELECT "id" FROM "dataSource" WHERE "key" = 'pylon:support'),
    'atlas-support-remi-performance', 'atlas:customer-lifecycle:support', NULL,
    'ACTIVE', 'EXPLORATORY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "connector" = EXCLUDED."connector",
  "sourceId" = EXCLUDED."sourceId",
  "sourceExternalId" = EXCLUDED."sourceExternalId",
  "sourceDashboardExternalId" = EXCLUDED."sourceDashboardExternalId",
  "databaseExternalId" = EXCLUDED."databaseExternalId",
  "status" = EXCLUDED."status",
  "purpose" = EXCLUDED."purpose",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-support-version-issue-volume-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7030),
    1, 'API',
    '{"source":"pylon","dataset":"monthly_issue_volume","window":"six_months_including_current","stored_data":"monthly_aggregates_only"}',
    'line', '{"columns":["month","issues","open_issues","closed_issues"]}'::jsonb,
    NULL, 'atlas-support-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-version-top-categories-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7031),
    1, 'API',
    '{"source":"pylon","dataset":"monthly_tag_counts","window":"six_months_including_current","stored_data":"monthly_aggregates_only"}',
    'bar', '{"columns":["month","category","issues"],"seriesOrder":"total-desc"}'::jsonb,
    NULL, 'atlas-support-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-version-response-resolution-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7032),
    1, 'API',
    '{"source":"pylon","dataset":"monthly_response_resolution","window":"six_months_including_current","first_response":"business_hours_when_available","stored_data":"monthly_aggregates_only"}',
    'line', '{"columns":["month","average_first_response_minutes","median_first_response_minutes","average_resolution_hours","median_resolution_hours"]}'::jsonb,
    NULL, 'atlas-support-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-version-channel-volume-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7033),
    1, 'API',
    '{"source":"pylon","dataset":"monthly_source_counts","window":"six_months_including_current","stored_data":"monthly_aggregates_only"}',
    'bar', '{"columns":["month","source","issues"],"seriesOrder":"total-desc"}'::jsonb,
    NULL, 'atlas-support-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-version-csat-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7034),
    1, 'API',
    '{"source":"pylon","dataset":"monthly_survey_scores","window":"six_months_including_current","stored_data":"score_count_and_average_only"}',
    'line', '{"columns":["month","responses","average_score"]}'::jsonb,
    NULL, 'atlas-support-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-version-remi-performance-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7035),
    1, 'API',
    '{"source":"remi","dataset":"pending_definition","stored_data":"connection_status_only"}',
    'table', '{"columns":["status","next_step"]}'::jsonb,
    NULL, 'atlas-support-registry', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-support-card-issue-volume',
    (SELECT "id" FROM "dashboard" WHERE "number" = 9),
    'atlas-customer-lifecycle-tab-support',
    (SELECT "id" FROM "question" WHERE "number" = 7030),
    0, 0, 0, 12, 8, 'LINE', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-card-top-categories',
    (SELECT "id" FROM "dashboard" WHERE "number" = 9),
    'atlas-customer-lifecycle-tab-support',
    (SELECT "id" FROM "question" WHERE "number" = 7031),
    1, 12, 0, 12, 8, 'BAR', '{"seriesOrder":"total-desc"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-card-response-resolution',
    (SELECT "id" FROM "dashboard" WHERE "number" = 9),
    'atlas-customer-lifecycle-tab-support',
    (SELECT "id" FROM "question" WHERE "number" = 7032),
    2, 0, 8, 12, 8, 'LINE', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-card-channel-volume',
    (SELECT "id" FROM "dashboard" WHERE "number" = 9),
    'atlas-customer-lifecycle-tab-support',
    (SELECT "id" FROM "question" WHERE "number" = 7033),
    3, 12, 8, 12, 8, 'BAR', '{"seriesOrder":"total-desc"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-card-csat',
    (SELECT "id" FROM "dashboard" WHERE "number" = 9),
    'atlas-customer-lifecycle-tab-support',
    (SELECT "id" FROM "question" WHERE "number" = 7034),
    4, 0, 16, 12, 7, 'LINE', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-support-card-remi-performance',
    (SELECT "id" FROM "dashboard" WHERE "number" = 9),
    'atlas-customer-lifecycle-tab-support',
    (SELECT "id" FROM "question" WHERE "number" = 7035),
    5, 12, 16, 12, 7, 'TABLE', '{"compact":true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE SET
  "dashboardId" = EXCLUDED."dashboardId",
  "tabId" = EXCLUDED."tabId",
  "questionId" = EXCLUDED."questionId",
  "position" = EXCLUDED."position",
  "x" = EXCLUDED."x",
  "y" = EXCLUDED."y",
  "width" = EXCLUDED."width",
  "height" = EXCLUDED."height",
  "visualization" = EXCLUDED."visualization",
  "displaySettings" = EXCLUDED."displaySettings",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 9;
