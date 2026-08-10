-- The connected ClickHouse version exposes zero-argument today()/now(). Convert
-- timestamps to UTC before bucketing rather than passing timezone arguments.
WITH latest AS (
  SELECT DISTINCT ON (v."questionId")
    v."questionId", v."version", v."queryLanguage", v."queryText", v."display",
    v."visualization", v."sourceCardExternalId"
  FROM "questionVersion" v
  JOIN question q ON q.id = v."questionId"
  WHERE q.number BETWEEN 1001 AND 1014
  ORDER BY v."questionId", v."version" DESC
), rewritten AS (
  SELECT
    latest.*,
    replace(
      replace(
        replace(
          replace("queryText",
            'toStartOfMonth("generationEndedAt", ''UTC'')',
            'toStartOfMonth(toTimeZone("generationEndedAt", ''UTC''))'
          ),
          'toStartOfMonth("createdAt", ''UTC'')',
          'toStartOfMonth(toTimeZone("createdAt", ''UTC''))'
        ),
        'toStartOfMonth(today(''UTC''), ''UTC'')',
        'toStartOfMonth(toTimeZone(now(), ''UTC''))'
      ),
      'now(''UTC'')',
      'toTimeZone(now(), ''UTC'')'
    ) AS utc_query
  FROM latest
)
INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
SELECT
  'atlas-clickhouse-utc-q' || q.number::text || '-v' || (rewritten.version + 1)::text,
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
