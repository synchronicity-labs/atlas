INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES
  ('atlas-modal-billing-source', 'modal:billing', 'ATLAS', 'Modal billing aggregate', 'STALE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-source', 'atlas:economics', 'ATLAS', 'TinyBird usage and Modal billing', 'STALE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-economics-dashboard', 6, 'Inference economics & margin',
  'Usage revenue, production inference cost, model mix, and an explicitly scoped inference contribution margin from canonical TinyBird usage plus aggregate Modal billing.',
  1, 'atlas', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-economics-tab-overview', 'atlas-economics-dashboard', 1, 'Overview', 0, 'atlas:economics:overview'
);

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "createdAt", "updatedAt"
) VALUES
  ('atlas-economics-question-modal-spend', 5001, 'Total Modal spend', 'Aggregate Modal billing for the current month to date. This includes production, staging, development, and unmapped Modal apps.', 'ATLAS', 'atlas-economics-source', 'economics:modal-spend', 'atlas:economics:overview', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-question-prod-cost', 5002, 'Production inference cost', 'Modal model cost allocated to free and paid production usage by each model frame ratio. Staging and unmapped apps are excluded.', 'ATLAS', 'atlas-economics-source', 'economics:prod-inference-cost', 'atlas:economics:overview', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-question-usage-revenue', 5003, 'Paid usage revenue', 'TinyBird generation cost grouped by generationEndedAt for organizations with a non-empty paid plan.', 'ATLAS', 'atlas-economics-source', 'economics:usage-revenue', 'atlas:economics:overview', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-question-margin-pct', 5004, 'Inference contribution margin', 'Paid usage revenue minus allocated free and paid production inference cost, divided by paid usage revenue. This is not company gross margin: licensed revenue and non-Modal COGS are excluded.', 'ATLAS', 'atlas-economics-source', 'economics:contribution-margin-pct', 'atlas:economics:overview', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-question-margin-history', 5005, 'Usage revenue & inference margin', 'Six completed months plus current month to date. Months without an actual Modal billing export use per-model cost-per-frame rates from available actual months.', 'ATLAS', 'atlas-economics-source', 'economics:margin-history', 'atlas:economics:overview', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-question-model-costs', 5006, 'Modal cost by model', 'Aggregate Modal billing mapped from production app names to canonical model names. Unknown apps remain visible as other.', 'ATLAS', 'atlas-economics-source', 'economics:model-costs', 'atlas:economics:overview', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-question-frames', 5007, 'Free & paid frames', 'TinyBird frames grouped by generationEndedAt and product-plan presence. Empty or null plan types are free; non-empty plan types are paid.', 'ATLAS', 'atlas-economics-source', 'economics:frames-by-tier', 'atlas:economics:overview', '166', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  ('atlas-economics-version-modal-spend-v1', 'atlas-economics-question-modal-spend', 1, 'API', '{"source":"atlas_economics","report":"modal-spend","months":7,"definitionVersion":"inference-economics-v1"}', 'smartscalar', '{"warehouseQuery":"sync_prod.sync_usage3 by generationEndedAt, model, and plan presence","modalAllocation":"aggregate Modal app cost mapped to model"}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-economics-version-prod-cost-v1', 'atlas-economics-question-prod-cost', 1, 'API', '{"source":"atlas_economics","report":"prod-inference-cost","months":7,"definitionVersion":"inference-economics-v1"}', 'smartscalar', '{"warehouseQuery":"sync_prod.sync_usage3 by generationEndedAt, model, and plan presence","modalAllocation":"per-model free and paid frame ratio"}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-economics-version-usage-revenue-v1', 'atlas-economics-question-usage-revenue', 1, 'API', '{"source":"atlas_economics","report":"usage-revenue","months":7,"definitionVersion":"inference-economics-v1"}', 'smartscalar', '{"warehouseQuery":"sum generationCostMillicents / 100000 for non-empty organizationPlanType grouped by generationEndedAt month"}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-economics-version-margin-pct-v1', 'atlas-economics-question-margin-pct', 1, 'API', '{"source":"atlas_economics","report":"margin-pct","months":7,"definitionVersion":"inference-economics-v1"}', 'smartscalar', '{"formula":"(paid usage revenue - allocated production inference cost) / paid usage revenue"}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-economics-version-margin-history-v1', 'atlas-economics-question-margin-history', 1, 'API', '{"source":"atlas_economics","report":"margin-history","months":7,"definitionVersion":"inference-economics-v1"}', 'bar', '{"formula":"paid usage revenue - allocated production inference cost"}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-economics-version-model-costs-v1', 'atlas-economics-question-model-costs', 1, 'API', '{"source":"atlas_economics","report":"model-costs","months":7,"definitionVersion":"inference-economics-v1"}', 'bar', '{"source":"Modal billing report aggregate; no app IDs or credentials persisted"}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-economics-version-frames-v1', 'atlas-economics-question-frames', 1, 'API', '{"source":"atlas_economics","report":"frames-by-tier","months":7,"definitionVersion":"inference-economics-v1"}', 'bar', '{"warehouseQuery":"sum frameCount from sync_prod.sync_usage3 by generationEndedAt month and plan presence"}'::jsonb, 'atlas', CURRENT_TIMESTAMP);

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES
  ('atlas-economics-card-modal-spend', 'atlas-economics-dashboard', 'atlas-economics-tab-overview', 'atlas-economics-question-modal-spend', 0, 0, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-card-prod-cost', 'atlas-economics-dashboard', 'atlas-economics-tab-overview', 'atlas-economics-question-prod-cost', 1, 6, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-card-usage-revenue', 'atlas-economics-dashboard', 'atlas-economics-tab-overview', 'atlas-economics-question-usage-revenue', 2, 12, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-card-margin-pct', 'atlas-economics-dashboard', 'atlas-economics-tab-overview', 'atlas-economics-question-margin-pct', 3, 18, 0, 6, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-card-margin-history', 'atlas-economics-dashboard', 'atlas-economics-tab-overview', 'atlas-economics-question-margin-history', 4, 0, 5, 12, 9, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-card-model-costs', 'atlas-economics-dashboard', 'atlas-economics-tab-overview', 'atlas-economics-question-model-costs', 5, 12, 5, 12, 9, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-economics-card-frames', 'atlas-economics-dashboard', 'atlas-economics-tab-overview', 'atlas-economics-question-frames', 6, 0, 14, 24, 9, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
