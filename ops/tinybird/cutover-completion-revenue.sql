DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "questionVersion"
    WHERE "id" = 'atlas-revenue-version-product-run-rate-completion-verified'
  ) AND EXISTS (
    SELECT 1
    FROM "question" q
    JOIN LATERAL (
      SELECT v."queryText" FROM "questionVersion" v
      WHERE v."questionId" = q."id"
      ORDER BY v."version" DESC LIMIT 1
    ) latest ON true
    WHERE q."number" = 1102
      AND position($before$from sync_prod.sync_usage3
  cross join bounds
), topups as ($before$ IN latest."queryText") = 0
  ) THEN
    RAISE EXCEPTION 'Question 1102 usage query has changed; verify the completion-source migration before applying it';
  END IF;
END
$migration$;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
SELECT
  'atlas-revenue-version-product-run-rate-completion-verified',
  q."id",
  latest."version" + 1,
  latest."queryLanguage",
  replace(latest."queryText",
    $before$from sync_prod.sync_usage3
  cross join bounds
), topups as ($before$,
    $after$from sync_prod.sync_usage_by_completion
  cross join bounds
  where "generationEndedAt" >= bounds.month_start
    and "generationEndedAt" < bounds.data_through
), topups as ($after$),
  latest."display",
  latest."visualization",
  latest."sourceCardExternalId",
  'atlas-revenue-registry',
  CURRENT_TIMESTAMP
FROM "question" q
JOIN LATERAL (
  SELECT v.* FROM "questionVersion" v
  WHERE v."questionId" = q."id"
  ORDER BY v."version" DESC LIMIT 1
) latest ON true
WHERE q."number" = 1102
  AND NOT EXISTS (
    SELECT 1 FROM "questionVersion"
    WHERE "id" = 'atlas-revenue-version-product-run-rate-completion-verified'
  )
ON CONFLICT ("id") DO NOTHING;
