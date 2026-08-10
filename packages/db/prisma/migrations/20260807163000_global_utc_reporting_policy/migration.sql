-- Atlas owns reporting boundaries. Source/session/browser timezone must not change a result.
-- Calendar periods use UTC; rolling windows use exact hours; intervals are half-open.

WITH latest AS (
  SELECT DISTINCT ON (v."questionId")
    v."questionId", v."version", v."queryLanguage", v."queryText", v."display",
    v."visualization", v."sourceCardExternalId"
  FROM "questionVersion" v
  JOIN question q ON q.id = v."questionId"
  WHERE q.number BETWEEN 1001 AND 1014
     OR q.number IN (2004, 2006, 2014, 2015, 2016, 2017, 2018, 2019, 4001, 4002, 4004, 4006)
  ORDER BY v."questionId", v."version" DESC
), rewritten AS (
  SELECT
    latest.*,
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace("queryText",
                          'toStartOfMonth("generationEndedAt")',
                          'toStartOfMonth("generationEndedAt", ''UTC'')'
                        ),
                        'toStartOfMonth("createdAt")',
                        'toStartOfMonth("createdAt", ''UTC'')'
                      ),
                      'toStartOfMonth(today())',
                      'toStartOfMonth(today(''UTC''), ''UTC'')'
                    ),
                    'toStartOfMonth(timestamp)',
                    'toStartOfMonth(timestamp, ''UTC'')'
                  ),
                  'toStartOfMonth(now())',
                  'toStartOfMonth(now(''UTC''), ''UTC'')'
                ),
                'toStartOfDay(timestamp)',
                'toStartOfDay(timestamp, ''UTC'')'
              ),
              'toStartOfDay(now())',
              'toStartOfDay(now(''UTC''), ''UTC'')'
            ),
            'now()',
            'now(''UTC'')'
          ),
          'interval 180 day',
          'interval 4320 hour'
        ),
        'interval 90 day',
        'interval 2160 hour'
      ),
      'interval 30 day',
      'interval 720 hour'
    ) AS utc_query
  FROM latest
)
INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
SELECT
  'atlas-utc-policy-q' || q.number::text || '-v' || (rewritten.version + 1)::text,
  rewritten."questionId",
  rewritten.version + 1,
  rewritten."queryLanguage",
  rewritten.utc_query,
  rewritten.display,
  rewritten.visualization,
  rewritten."sourceCardExternalId",
  'atlas',
  CURRENT_TIMESTAMP
FROM rewritten
JOIN question q ON q.id = rewritten."questionId";

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
)
SELECT
  'atlas-utc-policy-q4005-v2', q.id, 2, 'SQL',
  $query$with clock as (
  select statement_timestamp() as end_utc
)
select
  date_trunc('day', updated_at at time zone 'UTC')::date as day,
  count(*)::integer as accounts_marked_banned
from auth.users
cross join clock
where banned is true
  and updated_at >= end_utc - interval '4320 hours'
  and updated_at < end_utc
group by 1
order by 1$query$,
  'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
FROM question q
WHERE q.number = 4005;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
)
SELECT
  'atlas-utc-policy-q4007-v2', q.id, 2, 'SQL',
  $query$with clock as (
  select statement_timestamp() as end_utc
)
select
  coalesce(nullif(btrim(ban_reason), ''), '(none)') as ban_reason,
  count(*)::integer as banned_accounts
from auth.users
cross join clock
where banned is true
  and updated_at >= end_utc - interval '720 hours'
  and updated_at < end_utc
group by 1
order by 2 desc$query$,
  'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP
FROM question q
WHERE q.number = 4007;

-- Make the metric window visible even for scalar and categorical results that cannot
-- communicate a time range through their result columns.
UPDATE "dashboardCard" card
SET "displaySettings" = coalesce(card."displaySettings", '{}'::jsonb) ||
  jsonb_build_object(
    'timeframe',
    CASE
      WHEN q.number BETWEEN 1001 AND 1007 OR q.number BETWEEN 1011 AND 1014
        THEN 'Latest complete UTC month · compared with previous UTC month'
      WHEN q.number BETWEEN 1008 AND 1010
        THEN 'Previous 6 calendar months + current MTD · UTC'
      WHEN q.number BETWEEN 2001 AND 2006 OR q.number IN (2009, 2019, 2020)
        THEN 'Previous 6 calendar months + current MTD · UTC'
      WHEN q.number IN (2007, 2008)
        THEN 'Last 30 days · UTC'
      WHEN q.number BETWEEN 2010 AND 2013
        THEN 'Last 90 days · UTC'
      WHEN q.number IN (2014, 2015)
        THEN 'Signups: rolling 90d · first-touch lookback: 180d · UTC'
      WHEN q.number = 2016
        THEN 'Rolling 180 days · UTC'
      WHEN q.number = 2017
        THEN 'Rolling 90 days · UTC'
      WHEN q.number = 2018
        THEN 'Signups: rolling 90d · touches: 30d before signup · UTC'
      WHEN q.number IN (3001, 3002, 3006, 3007, 3010, 3011, 3012, 3014, 3015, 3016, 3017, 3019, 3020, 3025, 3026)
        THEN 'Current HubSpot state · as of snapshot · UTC'
      WHEN q.number IN (3003, 3004, 3005, 3008, 3013, 3018)
        THEN '6 calendar months incl. current partial · UTC'
      WHEN q.number = 3009
        THEN 'Next 6 calendar close months incl. current · UTC'
      WHEN q.number BETWEEN 3021 AND 3024
        THEN 'Rolling 30 days · UTC'
      WHEN q.number IN (4001, 4002)
        THEN 'Current calendar month to now · UTC'
      WHEN q.number = 4003
        THEN 'Current account state · as of snapshot · UTC'
      WHEN q.number IN (4004, 4005)
        THEN 'Rolling 180 days · daily UTC buckets'
      WHEN q.number = 4006
        THEN 'Rolling 90 days · exact 2,160h · UTC'
      WHEN q.number = 4007
        THEN 'Rolling 30 days · exact 720h · UTC'
      WHEN q.number BETWEEN 5001 AND 5007
        THEN 'Previous 6 calendar months + current MTD · UTC'
      ELSE 'Timeframe not defined'
    END
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM question q
WHERE q.id = card."questionId"
  AND q.number BETWEEN 1001 AND 5007;

UPDATE dashboard
SET "layoutVersion" = "layoutVersion" + 1
WHERE number BETWEEN 1 AND 6;
