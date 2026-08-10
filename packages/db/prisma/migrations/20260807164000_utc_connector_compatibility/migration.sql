-- Revenue questions are Atlas-owned definitions executed by the Metabase connector.
-- Mark the execution connector accurately so dashboard refreshes run the live SQL.
UPDATE question
SET connector = 'METABASE', "updatedAt" = CURRENT_TIMESTAMP
WHERE number BETWEEN 1001 AND 1014;

-- HogQL exposes one-argument period bucketing. Normalize to UTC before bucketing
-- instead of using ClickHouse's unsupported two-argument form.
WITH latest AS (
  SELECT DISTINCT ON (v."questionId")
    v."questionId", v."version", v."queryLanguage", v."queryText", v."display",
    v."visualization", v."sourceCardExternalId"
  FROM "questionVersion" v
  JOIN question q ON q.id = v."questionId"
  WHERE q.number IN (2004, 2006, 2019, 4001, 4002, 4004)
  ORDER BY v."questionId", v."version" DESC
), rewritten AS (
  SELECT
    latest.*,
    replace(
      replace(
        replace(
          replace("queryText",
            'toStartOfMonth(timestamp, ''UTC'')',
            'toStartOfMonth(toTimeZone(timestamp, ''UTC''))'
          ),
          'toStartOfMonth(now(''UTC''), ''UTC'')',
          'toStartOfMonth(toTimeZone(now(), ''UTC''))'
        ),
        'toStartOfDay(timestamp, ''UTC'')',
        'toStartOfDay(toTimeZone(timestamp, ''UTC''))'
      ),
      'toStartOfDay(now(''UTC''), ''UTC'')',
      'toStartOfDay(toTimeZone(now(), ''UTC''))'
    ) AS utc_query
  FROM latest
)
INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
SELECT
  'atlas-hogql-utc-q' || q.number::text || '-v' || (rewritten.version + 1)::text,
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
