INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-product-tab-surfaces',
  (SELECT "id" FROM "dashboard" WHERE "number" = 1),
  8,
  'Surfaces',
  7,
  'atlas:product:surfaces'
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
    'atlas-product-question-paid-generated-hours-by-surface', 7020,
    'Paid-plan generated hours by surface',
    'Final generated media hours from completed paid-plan generations in the current UTC month. A 30-second generated segment counts as 30 seconds even if the input video is one hour. The result separates the product app, API, plugins, MCP, agent workflows, and other sources.',
    'METABASE', 'atlas-metabase-source', 'atlas:product:paid-generated-hours-by-surface',
    '1717', '166', 'ACTIVE', 'CERTIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-question-paid-generated-hours-share-by-surface', 7021,
    'Share of paid-plan generated hours by surface',
    'Each surface as a percentage of final generated media hours from completed paid-plan generations in the current UTC month.',
    'METABASE', 'atlas-metabase-source', 'atlas:product:paid-generated-hours-share-by-surface',
    '1717', '166', 'ACTIVE', 'CERTIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-question-accrued-value-by-surface', 7022,
    'Paid usage accrued by surface',
    'Usage revenue incurred by completed paid-plan generations in the current UTC month. This is usage accrued when generation output completes, not an invoice or cash collection. It does not allocate subscription revenue to a surface.',
    'METABASE', 'atlas-metabase-source', 'atlas:product:accrued-value-by-surface',
    '1717', '166', 'ACTIVE', 'CERTIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-question-accrued-value-share-by-surface', 7023,
    'Share of paid usage accrued by surface',
    'Each surface as a percentage of usage revenue incurred by completed paid-plan generations in the current UTC month. Subscription revenue is not allocated to a surface.',
    'METABASE', 'atlas-metabase-source', 'atlas:product:accrued-value-share-by-surface',
    '1717', '166', 'ACTIVE', 'CERTIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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
    'atlas-product-version-paid-generated-hours-by-surface-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7020),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), source_rows as (
  select
    toStartOfMonth("generationEndedAt") as period_start,
    multiIf(
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'studio', 'app',
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'api' or (empty(simpleJSONExtractString("generationRecord", 'source')) and notEmpty("apiKeyId")), 'api',
      endsWith(lower(simpleJSONExtractString("generationRecord", 'source')), '-plugin'), 'plugins',
      startsWith(lower(simpleJSONExtractString("generationRecord", 'source')), 'mcp'), 'mcp',
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'agent', 'agent',
      'other'
    ) as surface,
    simpleJSONExtractFloat("generationRecord", 'outputMediaLength') / 3600.0 as generated_hours
  from sync_prod.sync_usage3
  where "generationEndedAt" >= toStartOfMonth(toTimeZone(now(), 'UTC'))
    and "generationEndedAt" < toStartOfMinute(toTimeZone(now(), 'UTC'))
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
)
select
  period_start,
  sumIf(generated_hours, surface = 'app') as app_generated_hours,
  sumIf(generated_hours, surface = 'api') as api_generated_hours,
  sumIf(generated_hours, surface = 'plugins') as plugin_generated_hours,
  sumIf(generated_hours, surface = 'mcp') as mcp_generated_hours,
  sumIf(generated_hours, surface = 'agent') as agent_generated_hours,
  sumIf(generated_hours, surface = 'other') as other_generated_hours,
  bounds.data_through as data_through
from source_rows
cross join bounds
group by period_start, bounds.data_through
order by period_start$query$,
    'bar', '{}'::jsonb, NULL, 'atlas-product-surface-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-paid-generated-hours-share-by-surface-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7021),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), source_rows as (
  select
    toStartOfMonth("generationEndedAt") as period_start,
    multiIf(
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'studio', 'app',
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'api' or (empty(simpleJSONExtractString("generationRecord", 'source')) and notEmpty("apiKeyId")), 'api',
      endsWith(lower(simpleJSONExtractString("generationRecord", 'source')), '-plugin'), 'plugins',
      startsWith(lower(simpleJSONExtractString("generationRecord", 'source')), 'mcp'), 'mcp',
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'agent', 'agent',
      'other'
    ) as surface,
    simpleJSONExtractFloat("generationRecord", 'outputMediaLength') as generated_seconds
  from sync_prod.sync_usage3
  where "generationEndedAt" >= toStartOfMonth(toTimeZone(now(), 'UTC'))
    and "generationEndedAt" < toStartOfMinute(toTimeZone(now(), 'UTC'))
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
)
select
  period_start,
  100 * sumIf(generated_seconds, surface = 'app') / nullIf(sum(generated_seconds), 0) as app_share_pct,
  100 * sumIf(generated_seconds, surface = 'api') / nullIf(sum(generated_seconds), 0) as api_share_pct,
  100 * sumIf(generated_seconds, surface = 'plugins') / nullIf(sum(generated_seconds), 0) as plugin_share_pct,
  100 * sumIf(generated_seconds, surface = 'mcp') / nullIf(sum(generated_seconds), 0) as mcp_share_pct,
  100 * sumIf(generated_seconds, surface = 'agent') / nullIf(sum(generated_seconds), 0) as agent_share_pct,
  100 * sumIf(generated_seconds, surface = 'other') / nullIf(sum(generated_seconds), 0) as other_share_pct,
  bounds.data_through as data_through
from source_rows
cross join bounds
group by period_start, bounds.data_through
order by period_start$query$,
    'bar', '{}'::jsonb, NULL, 'atlas-product-surface-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-accrued-value-by-surface-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7022),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), source_rows as (
  select
    toStartOfMonth("generationEndedAt") as period_start,
    multiIf(
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'studio', 'app',
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'api' or (empty(simpleJSONExtractString("generationRecord", 'source')) and notEmpty("apiKeyId")), 'api',
      endsWith(lower(simpleJSONExtractString("generationRecord", 'source')), '-plugin'), 'plugins',
      startsWith(lower(simpleJSONExtractString("generationRecord", 'source')), 'mcp'), 'mcp',
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'agent', 'agent',
      'other'
    ) as surface,
    "generationCostMillicents" / 100000.0 as accrued_value_usd
  from sync_prod.sync_usage3
  where "generationEndedAt" >= toStartOfMonth(toTimeZone(now(), 'UTC'))
    and "generationEndedAt" < toStartOfMinute(toTimeZone(now(), 'UTC'))
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
)
select
  period_start,
  sumIf(accrued_value_usd, surface = 'app') as app_accrued_value_usd,
  sumIf(accrued_value_usd, surface = 'api') as api_accrued_value_usd,
  sumIf(accrued_value_usd, surface = 'plugins') as plugin_accrued_value_usd,
  sumIf(accrued_value_usd, surface = 'mcp') as mcp_accrued_value_usd,
  sumIf(accrued_value_usd, surface = 'agent') as agent_accrued_value_usd,
  sumIf(accrued_value_usd, surface = 'other') as other_accrued_value_usd,
  bounds.data_through as data_through
from source_rows
cross join bounds
group by period_start, bounds.data_through
order by period_start$query$,
    'bar', '{}'::jsonb, NULL, 'atlas-product-surface-registry', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-accrued-value-share-by-surface-v1',
    (SELECT "id" FROM "question" WHERE "number" = 7023),
    1, 'SQL',
    $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), source_rows as (
  select
    toStartOfMonth("generationEndedAt") as period_start,
    multiIf(
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'studio', 'app',
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'api' or (empty(simpleJSONExtractString("generationRecord", 'source')) and notEmpty("apiKeyId")), 'api',
      endsWith(lower(simpleJSONExtractString("generationRecord", 'source')), '-plugin'), 'plugins',
      startsWith(lower(simpleJSONExtractString("generationRecord", 'source')), 'mcp'), 'mcp',
      lower(simpleJSONExtractString("generationRecord", 'source')) = 'agent', 'agent',
      'other'
    ) as surface,
    "generationCostMillicents" / 100000.0 as accrued_value_usd
  from sync_prod.sync_usage3
  where "generationEndedAt" >= toStartOfMonth(toTimeZone(now(), 'UTC'))
    and "generationEndedAt" < toStartOfMinute(toTimeZone(now(), 'UTC'))
    and "organizationPlanType" is not null
    and "organizationPlanType" != ''
)
select
  period_start,
  100 * sumIf(accrued_value_usd, surface = 'app') / nullIf(sum(accrued_value_usd), 0) as app_share_pct,
  100 * sumIf(accrued_value_usd, surface = 'api') / nullIf(sum(accrued_value_usd), 0) as api_share_pct,
  100 * sumIf(accrued_value_usd, surface = 'plugins') / nullIf(sum(accrued_value_usd), 0) as plugin_share_pct,
  100 * sumIf(accrued_value_usd, surface = 'mcp') / nullIf(sum(accrued_value_usd), 0) as mcp_share_pct,
  100 * sumIf(accrued_value_usd, surface = 'agent') / nullIf(sum(accrued_value_usd), 0) as agent_share_pct,
  100 * sumIf(accrued_value_usd, surface = 'other') / nullIf(sum(accrued_value_usd), 0) as other_share_pct,
  bounds.data_through as data_through
from source_rows
cross join bounds
group by period_start, bounds.data_through
order by period_start$query$,
    'bar', '{}'::jsonb, NULL, 'atlas-product-surface-registry', CURRENT_TIMESTAMP
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
    'atlas-product-card-paid-generated-hours-by-surface',
    (SELECT "id" FROM "dashboard" WHERE "number" = 1),
    'atlas-product-tab-surfaces',
    (SELECT "id" FROM "question" WHERE "number" = 7020),
    0, 0, 0, 12, 8, 'BAR', '{"seriesOrder":"total-desc"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-card-paid-generated-hours-share-by-surface',
    (SELECT "id" FROM "dashboard" WHERE "number" = 1),
    'atlas-product-tab-surfaces',
    (SELECT "id" FROM "question" WHERE "number" = 7021),
    1, 12, 0, 12, 8, 'BAR', '{"seriesOrder":"total-desc"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-card-accrued-value-by-surface',
    (SELECT "id" FROM "dashboard" WHERE "number" = 1),
    'atlas-product-tab-surfaces',
    (SELECT "id" FROM "question" WHERE "number" = 7022),
    2, 0, 8, 12, 8, 'BAR', '{"seriesOrder":"total-desc"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-card-accrued-value-share-by-surface',
    (SELECT "id" FROM "dashboard" WHERE "number" = 1),
    'atlas-product-tab-surfaces',
    (SELECT "id" FROM "question" WHERE "number" = 7023),
    3, 12, 8, 12, 8, 'BAR', '{"seriesOrder":"total-desc"}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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
WHERE "number" = 1;
