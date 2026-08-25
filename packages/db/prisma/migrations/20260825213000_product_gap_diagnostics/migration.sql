UPDATE "question"
SET
  "name" = 'Activated organizations not yet professional',
  "description" = 'Latest and previous complete-month V2 self-serve organizations that meet the canonical activation rule but remain below the professional accrued-value threshold. Governed detail includes plan, generation, output-hour, and model breakdowns without customer identifiers.',
  "connector" = 'METABASE',
  "sourceId" = (SELECT "id" FROM "dataSource" WHERE "key" = 'metabase:sync'),
  "sourceExternalId" = 'cron:product:activated-not-professional',
  "sourceDashboardExternalId" = 'atlas:product:scoreboard',
  "databaseExternalId" = '166',
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-activated-not-professional';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-activated-not-professional-v2',
  'atlas-cron-question-activated-not-professional',
  2,
  'SQL',
  $sql$with
  toStartOfMonth(now()) as cutoff,
  source as (
    select
      toStartOfMonth(generationCreatedAt) as month,
      organizationId,
      organizationPlanType as plan,
      generationId,
      generationCreatedAt,
      coalesce(nullIf(model, ''), 'unknown') as model,
      generationCostMillicents,
      greatest(JSONExtractFloat(generationRecord, 'outputMediaLength'), 0) as output_seconds
    from sync_prod.sync_usage3
    where generationCreatedAt >= addMonths(cutoff, -2)
      and generationCreatedAt < cutoff
      and organizationId != ''
      and organizationPlanType in ('hobbyist', 'creator', 'growth', 'scale')
  ),
  organization_month as (
    select
      month,
      organizationId,
      argMax(plan, generationCreatedAt) as plan,
      uniqExact(generationId) as generations,
      uniqExact(toDate(generationCreatedAt)) as active_days,
      sum(generationCostMillicents) / 100000.0 as accrued_value_usd,
      sum(output_seconds) / 3600.0 as output_hours
    from source
    group by month, organizationId
  ),
  classified as (
    select
      *,
      generations >= 3 and active_days >= 2 as is_activated,
      generations >= 3 and active_days >= 2 and accrued_value_usd >= 100 as is_professional
    from organization_month
  ),
  gap as (
    select *
    from classified
    where is_activated and not is_professional
  ),
  summary as (
    select
      month,
      countIf(is_activated) as activated_organizations,
      countIf(is_professional) as professional_organizations,
      countIf(is_activated and not is_professional) as gap_organizations
    from classified
    group by month
  ),
  model_mix as (
    select
      source.month,
      source.model,
      uniqExact(source.organizationId) as organization_count,
      uniqExact(source.generationId) as generation_count,
      sum(source.output_seconds) / 3600.0 as output_hours
    from source
    inner join gap
      on gap.month = source.month
      and gap.organizationId = source.organizationId
    group by source.month, source.model
  ),
  generation_buckets as (
    select
      month,
      multiIf(
        generations between 3 and 4, '3-4',
        generations between 5 and 9, '5-9',
        generations between 10 and 24, '10-24',
        '25+'
      ) as bucket,
      count() as organization_count,
      sum(generations) as generation_count
    from gap
    group by month, bucket
  ),
  output_hour_buckets as (
    select
      month,
      multiIf(
        output_hours < 0.25, '<0.25h',
        output_hours < 1, '0.25-0.99h',
        output_hours < 5, '1-4.99h',
        '5h+'
      ) as bucket,
      count() as organization_count,
      sum(gap.output_hours) as bucket_output_hours
    from gap
    group by month, bucket
  ),
  detail as (
    select
      0 as section_order,
      'summary' as section,
      month,
      'all' as dimension_value,
      gap_organizations as organization_count,
      activated_organizations,
      professional_organizations,
      gap_organizations,
      0 as generation_count,
      0.0 as output_hours
    from summary
    union all
    select
      1, 'plan', month, plan, count(), 0, 0, 0, 0, 0.0
    from gap
    group by month, plan
    union all
    select
      2, 'generation_bucket', month, bucket, organization_count,
      0, 0, 0, generation_count, 0.0
    from generation_buckets
    union all
    select
      3, 'output_hour_bucket', month, bucket, organization_count,
      0, 0, 0, 0, bucket_output_hours
    from output_hour_buckets
    union all
    select
      4, 'model', month, model, organization_count,
      0, 0, 0, generation_count, output_hours
    from model_mix
  )
select
  section,
  month,
  dimension_value,
  organization_count,
  activated_organizations,
  professional_organizations,
  gap_organizations,
  generation_count,
  round(output_hours, 2) as output_hours,
  cutoff as data_through
from detail
order by month, section_order, organization_count desc, dimension_value$sql$,
  'table',
  '{"columns":["section","month","dimension_value","organization_count","activated_organizations","professional_organizations","gap_organizations","generation_count","output_hours","data_through"]}'::jsonb,
  NULL,
  'atlas-product-scoreboard-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-product-tab-diagnostics',
  (SELECT "id" FROM "dashboard" WHERE "number" = 1),
  8,
  'Diagnostics',
  6,
  'atlas:product:scoreboard'
)
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-product-card-activated-not-professional',
  (SELECT "id" FROM "dashboard" WHERE "number" = 1),
  'atlas-product-tab-diagnostics',
  'atlas-cron-question-activated-not-professional',
  0,
  0,
  0,
  24,
  14,
  'TABLE',
  '{"compact":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
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
