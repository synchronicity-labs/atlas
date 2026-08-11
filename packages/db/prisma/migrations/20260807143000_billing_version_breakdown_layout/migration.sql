UPDATE "dashboardTab"
SET "name" = 'Billing version breakdown'
WHERE "id" = 'atlas-product-tab-billing-operations';

DELETE FROM "dashboardCard"
WHERE "id" IN (
  'atlas-product-card-billing-org-mix',
  'atlas-product-card-v3-topups'
);

UPDATE "dashboardCard"
SET "position" = 0, "x" = 0, "y" = 0, "width" = 12, "height" = 6,
    "visualization" = 'BAR', "displaySettings" = '{}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-card-v3-plan-mix';

UPDATE "dashboardCard"
SET "position" = 1, "x" = 12, "y" = 0, "width" = 12, "height" = 6,
    "visualization" = 'TABLE', "displaySettings" = '{}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-card-billing-paid-rate';

UPDATE "dashboardCard"
SET "position" = 2, "x" = 0, "y" = 6, "width" = 12, "height" = 7,
    "visualization" = 'LINE',
    "displaySettings" = '{"title":"V2 subscription revenue · monthly","series":"v2_subscription_revenue_usd"}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-card-billing-subscription-revenue';

UPDATE "dashboardCard"
SET "position" = 4, "x" = 0, "y" = 13, "width" = 12, "height" = 7,
    "visualization" = 'LINE',
    "displaySettings" = '{"title":"V2 lipsync frames · monthly","series":"v2_frames"}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-card-billing-frames';

UPDATE "dashboardCard"
SET "position" = 6, "x" = 0, "y" = 20, "width" = 12, "height" = 7,
    "visualization" = 'LINE',
    "displaySettings" = '{"title":"V2 dubbing cost · monthly","series":"v2_dubbing_cost_usd"}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-card-billing-dubbing';

UPDATE "dashboardCard"
SET "position" = 8, "x" = 0, "y" = 27, "width" = 12, "height" = 7,
    "visualization" = 'LINE',
    "displaySettings" = '{"title":"V2 TTS cost · monthly","series":"v2_tts_cost_usd"}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-card-billing-tts';

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
)
SELECT
  values."id", dashboard."id", tab."id", question."id", values."position",
  12, values."y", 12, 7, 'LINE'::"VisualizationType", values."displaySettings"::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  VALUES
    (
      'atlas-product-card-billing-subscription-revenue-v3', 49, 3, 6,
      '{"title":"V3 subscription revenue · monthly","series":"v3_subscription_revenue_usd"}'
    ),
    (
      'atlas-product-card-billing-frames-v3', 51, 5, 13,
      '{"title":"V3 lipsync frames · monthly","series":"v3_frames"}'
    ),
    (
      'atlas-product-card-billing-dubbing-v3', 52, 7, 20,
      '{"title":"V3 dubbing cost · monthly","series":"v3_dubbing_cost_usd"}'
    ),
    (
      'atlas-product-card-billing-tts-v3', 53, 9, 27,
      '{"title":"V3 TTS cost · monthly","series":"v3_tts_cost_usd"}'
    )
) AS values("id", "questionNumber", "position", "y", "displaySettings")
CROSS JOIN "dashboard" dashboard
JOIN "dashboardTab" tab
  ON tab."dashboardId" = dashboard."id" AND tab."number" = 7
JOIN "question" question ON question."number" = values."questionNumber"
WHERE dashboard."number" = 1;

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1;
