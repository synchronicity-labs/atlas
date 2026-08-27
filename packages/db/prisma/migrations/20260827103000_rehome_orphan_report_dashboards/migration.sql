INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-lipsync-dashboard-v2',
    14,
    'Lipsync acquisition and conversion',
    'Governed lipsync.com search, traffic, and product conversion metrics.',
    1,
    'atlas',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-customer-lifecycle-dashboard-v2',
    15,
    'Customer lifecycle & retention',
    'Governed customer lifecycle, cancellation, retention, and exit-survey metrics used by Rudy reports.',
    1,
    'atlas',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-studio-product-dashboard-v2',
    16,
    'Studio product delivery',
    'Governed Studio delivery, activation speed, signup conversion, retention, and subscription movement metrics. Booked commitments remain separate.',
    1,
    'atlas',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE SET
  "number" = EXCLUDED."number",
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "layoutVersion" = EXCLUDED."layoutVersion",
  "createdBy" = EXCLUDED."createdBy",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES
  (
    'atlas-lipsync-tab-funnel-v2',
    'atlas-lipsync-dashboard-v2',
    1,
    'Product funnel',
    0,
    'atlas:lipsync:product-funnel'
  ),
  (
    'atlas-customer-lifecycle-tab-exit-survey-v2',
    'atlas-customer-lifecycle-dashboard-v2',
    1,
    'Exit survey',
    0,
    'atlas:customer-lifecycle:exit-survey'
  ),
  (
    'atlas-studio-product-tab-delivery-v2',
    'atlas-studio-product-dashboard-v2',
    1,
    'Delivery and logo movement',
    0,
    'atlas:studio-product:delivery'
  )
ON CONFLICT ("id") DO UPDATE SET
  "dashboardId" = EXCLUDED."dashboardId",
  "number" = EXCLUDED."number",
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

WITH cards (
  id, dashboard_id, tab_id, question_id, position, x, y, width, height
) AS (
  VALUES
    (
      'atlas-lipsync-card-funnel',
      'atlas-lipsync-dashboard-v2',
      'atlas-lipsync-tab-funnel-v2',
      'atlas-cron-question-lipsync-funnel',
      0, 0, 0, 24, 12
    ),
    (
      'atlas-customer-lifecycle-card-exit-survey',
      'atlas-customer-lifecycle-dashboard-v2',
      'atlas-customer-lifecycle-tab-exit-survey-v2',
      'atlas-cron-question-exit-survey',
      0, 0, 0, 24, 12
    ),
    (
      'atlas-studio-product-card-weekly',
      'atlas-studio-product-dashboard-v2',
      'atlas-studio-product-tab-delivery-v2',
      'atlas-cron-question-studio-period-pack',
      0, 0, 0, 12, 10
    ),
    (
      'atlas-studio-product-card-monthly',
      'atlas-studio-product-dashboard-v2',
      'atlas-studio-product-tab-delivery-v2',
      'atlas-studio-question-monthly-delivery',
      1, 12, 0, 12, 10
    ),
    (
      'atlas-studio-product-card-weekly-time-to-magic',
      'atlas-studio-product-dashboard-v2',
      'atlas-studio-product-tab-delivery-v2',
      'atlas-studio-question-weekly-time-to-magic',
      2, 0, 10, 12, 10
    ),
    (
      'atlas-studio-product-card-monthly-time-to-magic',
      'atlas-studio-product-dashboard-v2',
      'atlas-studio-product-tab-delivery-v2',
      'atlas-studio-question-monthly-time-to-magic',
      3, 12, 10, 12, 10
    ),
    (
      'atlas-studio-product-card-weekly-signup-conversion',
      'atlas-studio-product-dashboard-v2',
      'atlas-studio-product-tab-delivery-v2',
      'atlas-studio-question-weekly-signup-conversion',
      4, 0, 20, 12, 10
    ),
    (
      'atlas-studio-product-card-monthly-signup-conversion',
      'atlas-studio-product-dashboard-v2',
      'atlas-studio-product-tab-delivery-v2',
      'atlas-studio-question-monthly-signup-conversion',
      5, 12, 20, 12, 10
    ),
    (
      'atlas-studio-product-card-week-two-retention',
      'atlas-studio-product-dashboard-v2',
      'atlas-studio-product-tab-delivery-v2',
      'atlas-studio-question-week-two-retention',
      6, 0, 30, 12, 10
    )
)
INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
)
SELECT
  cards.id,
  cards.dashboard_id,
  cards.tab_id,
  cards.question_id,
  cards.position,
  cards.x,
  cards.y,
  cards.width,
  cards.height,
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
