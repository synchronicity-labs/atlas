WITH specs (
  id, number, public_number, name, description, external_id
) AS (
  VALUES
    (
      'atlas-studio-question-weekly-time-to-magic', 7042, 272,
      'Weekly Studio time to magic',
      'Median and average signup-to-successful-generation time for complete UTC weeks. It preserves the approved native PostHog funnel and 30-minute conversion window.',
      'cron:studio:insight-weekly-time-to-magic'
    ),
    (
      'atlas-studio-question-monthly-time-to-magic', 7043, 273,
      'Monthly Studio time to magic',
      'Median and average signup-to-successful-generation time for complete UTC calendar months. It preserves the approved native PostHog funnel and 30-minute conversion window.',
      'cron:studio:insight-monthly-time-to-magic'
    ),
    (
      'atlas-studio-question-weekly-signup-conversion', 7044, 274,
      'Weekly Studio signup to subscription conversion',
      'Complete UTC-week signup cohorts and paid-subscription conversion under the approved ordered six-week native PostHog funnel. A cohort is published only after the full six-week observation window.',
      'cron:studio:insight-weekly-signup-conversion'
    ),
    (
      'atlas-studio-question-monthly-signup-conversion', 7045, 275,
      'Monthly Studio signup to subscription conversion',
      'Complete UTC-month signup cohorts and paid-subscription conversion under the approved ordered six-week native PostHog funnel. A cohort is published only after the full six-week observation window.',
      'cron:studio:insight-monthly-signup-conversion'
    ),
    (
      'atlas-studio-question-week-two-retention', 7046, 276,
      'Studio week-two generation retention',
      'Mature weekly generation cohorts and recurring week-two generation retention. Cohorts are published only after a complete three-week observation window.',
      'cron:studio:insight-week-two-retention'
    )
)
INSERT INTO "question" (
  "id", "number", "publicNumber", "name", "description", "connector",
  "sourceId", "sourceExternalId", "sourceDashboardExternalId",
  "databaseExternalId", "status", "purpose", "createdAt", "updatedAt"
)
SELECT
  specs.id,
  specs.number,
  specs.public_number,
  specs.name,
  specs.description,
  'ATLAS',
  (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:studio-product'),
  specs.external_id,
  'atlas:studio-product:delivery',
  NULL,
  'ACTIVE',
  'RECONCILIATION',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM specs
ON CONFLICT ("id") DO UPDATE SET
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

WITH queries (kind, query) AS (
  VALUES
    (
      'time_to_magic',
      '{
        "kind": "InsightVizNode",
        "source": {
          "kind": "FunnelsQuery",
          "series": [
            {"kind":"EventsNode","name":"Pageview","event":"$pageview"},
            {"kind":"EventsNode","name":"user_signed_up","event":"user_signed_up"},
            {
              "kind":"EventsNode",
              "name":"playground_started_generation",
              "event":"playground_started_generation",
              "properties":[
                {"key":"source","type":"event","value":["plugin_premiere","agent"],"operator":"is_not"}
              ]
            },
            {
              "kind":"EventsNode",
              "name":"playground_completed_generation",
              "event":"playground_completed_generation",
              "properties":[
                {"key":"source","type":"event","value":["plugin_premiere","agent"],"operator":"is_not"}
              ]
            }
          ],
          "version":2,
          "interval":"day",
          "funnelsFilter":{
            "binCount":5,
            "exclusions":[],
            "funnelToStep":3,
            "funnelVizType":"time_to_convert",
            "funnelFromStep":1,
            "funnelStepReference":"total",
            "funnelWindowInterval":30,
            "funnelWindowIntervalUnit":"minute"
          },
          "filterTestAccounts":true
        }
      }'::jsonb
    ),
    (
      'signup_conversion',
      '{
        "kind":"InsightVizNode",
        "source":{
          "kind":"FunnelsQuery",
          "series":[
            {"kind":"EventsNode","name":"user_signed_up","event":"user_signed_up"},
            {"kind":"EventsNode","name":"subscription_created","event":"subscription_created"}
          ],
          "version":2,
          "interval":"day",
          "properties":[],
          "funnelsFilter":{
            "exclusions":[],
            "funnelVizType":"steps",
            "funnelOrderType":"ordered",
            "funnelStepReference":"total",
            "funnelWindowInterval":6,
            "funnelWindowIntervalUnit":"week"
          },
          "filterTestAccounts":true
        }
      }'::jsonb
    ),
    (
      'retention',
      '{
        "kind":"InsightVizNode",
        "source":{
          "kind":"RetentionQuery",
          "version":2,
          "properties":[],
          "retentionFilter":{
            "period":"Week",
            "targetEntity":{
              "id":"playground_completed_generation",
              "name":"playground_completed_generation",
              "type":"events",
              "order":0,
              "properties":[
                {"key":"source","type":"event","value":["plugin_premiere"],"operator":"is_not"}
              ]
            },
            "retentionType":"retention_recurring",
            "totalIntervals":3,
            "returningEntity":{
              "id":"playground_completed_generation",
              "name":"playground_completed_generation",
              "type":"events",
              "order":0,
              "properties":[
                {"key":"source","type":"event","value":["plugin_premiere"],"operator":"is_not"}
              ]
            },
            "retentionReference":"total"
          },
          "filterTestAccounts":true
        }
      }'::jsonb
    )
), specs (
  id, question_id, mode, grain, periods, query_kind, source_card
) AS (
  VALUES
    (
      'atlas-studio-question-weekly-time-to-magic-v1',
      'atlas-studio-question-weekly-time-to-magic',
      'funnel_time_to_convert', 'week', 3, 'time_to_magic', 'Sab6fNKH'
    ),
    (
      'atlas-studio-question-monthly-time-to-magic-v1',
      'atlas-studio-question-monthly-time-to-magic',
      'funnel_time_to_convert', 'month', 3, 'time_to_magic', 'Sab6fNKH'
    ),
    (
      'atlas-studio-question-weekly-signup-conversion-v1',
      'atlas-studio-question-weekly-signup-conversion',
      'funnel_conversion', 'week', 3, 'signup_conversion', 'TYEh8QQK'
    ),
    (
      'atlas-studio-question-monthly-signup-conversion-v1',
      'atlas-studio-question-monthly-signup-conversion',
      'funnel_conversion', 'month', 3, 'signup_conversion', 'TYEh8QQK'
    ),
    (
      'atlas-studio-question-week-two-retention-v1',
      'atlas-studio-question-week-two-retention',
      'retention_week_two', 'week', 12, 'retention', 'Lm7NbIhY'
    )
)
INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
SELECT
  specs.id,
  specs.question_id,
  1,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'posthog_insight',
    'mode', specs.mode,
    'grain', specs.grain,
    'periods', specs.periods,
    'query', queries.query
  )),
  'table',
  '{}'::jsonb,
  specs.source_card,
  'atlas-studio-insight-registry',
  CURRENT_TIMESTAMP
FROM specs
JOIN queries ON queries.kind = specs.query_kind
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "sourceCardExternalId" = EXCLUDED."sourceCardExternalId",
  "createdBy" = EXCLUDED."createdBy";

UPDATE "dashboard"
SET
  "description" = 'Governed Studio delivery, activation speed, signup conversion, retention, and subscription movement metrics. Booked commitments remain separate.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 11;

WITH cards (id, question_id, position, x, y) AS (
  VALUES
    ('atlas-studio-product-card-weekly-time-to-magic', 'atlas-studio-question-weekly-time-to-magic', 2, 0, 10),
    ('atlas-studio-product-card-monthly-time-to-magic', 'atlas-studio-question-monthly-time-to-magic', 3, 12, 10),
    ('atlas-studio-product-card-weekly-signup-conversion', 'atlas-studio-question-weekly-signup-conversion', 4, 0, 20),
    ('atlas-studio-product-card-monthly-signup-conversion', 'atlas-studio-question-monthly-signup-conversion', 5, 12, 20),
    ('atlas-studio-product-card-week-two-retention', 'atlas-studio-question-week-two-retention', 6, 0, 30)
)
INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
)
SELECT
  cards.id,
  (SELECT "id" FROM "dashboard" WHERE "number" = 11),
  (
    SELECT "id" FROM "dashboardTab"
    WHERE "dashboardId" = (SELECT "id" FROM "dashboard" WHERE "number" = 11)
      AND "number" = 1
  ),
  cards.question_id,
  cards.position,
  cards.x,
  cards.y,
  12,
  10,
  'TABLE',
  '{"compact":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM cards
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
