WITH latest AS (
  SELECT
    question."id" AS "questionId",
    version."version",
    version."queryLanguage",
    version."display",
    version."visualization",
    version."sourceCardExternalId"
  FROM "question" AS question
  JOIN LATERAL (
    SELECT version.*
    FROM "questionVersion" AS version
    WHERE version."questionId" = question."id"
    ORDER BY version."version" DESC
    LIMIT 1
  ) AS version ON true
  WHERE question."number" = 1115
)
INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
SELECT
  'atlas-partner-usage-dynamic-pivot-v' || (latest."version" + 1),
  latest."questionId",
  latest."version" + 1,
  latest."queryLanguage",
  $query$with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), partner_usage as (
  select
    toStartOfMonth("generationEndedAt") as period_start,
    __ATLAS_PARTNER_LABEL__ as partner,
    sum("generationCostMillicents") / 100000.0 as usage_accrual
  from sync_prod.sync_usage3
  cross join bounds
  where "generationEndedAt" >= addMonths(bounds.month_start, -5)
    and "generationEndedAt" < bounds.data_through
  group by period_start, partner
)
select
  partner_usage.period_start,
  __ATLAS_PARTNER_USAGE_COLUMNS__,
  if(
    partner_usage.period_start = bounds.month_start,
    bounds.data_through,
    addMonths(partner_usage.period_start, 1)
  ) as period_end,
  bounds.data_through as data_through
from partner_usage
cross join bounds
group by partner_usage.period_start, bounds.month_start, bounds.data_through
order by partner_usage.period_start$query$,
  latest."display",
  latest."visualization",
  latest."sourceCardExternalId",
  'atlas-revenue-registry',
  CURRENT_TIMESTAMP
FROM latest
ON CONFLICT ("questionId", "version") DO NOTHING;

UPDATE "question"
SET
  "description" = 'Monthly accrued usage for every organization in the channel-partner registry, split by partner. The current month is month to date. New registry entries appear automatically after the next refresh.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1115;

UPDATE "metrics"."metricDefinition"
SET
  "description" = 'Monthly accrued usage for every organization in the channel-partner registry, split by partner. The current month is month to date. New registry entries appear automatically after the next refresh.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'company.partner_usage_history';
