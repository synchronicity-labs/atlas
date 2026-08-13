WITH latest_versions AS (
  SELECT DISTINCT ON (version."questionId")
    version."questionId",
    version."version",
    version."queryLanguage",
    version."queryText",
    version."display",
    version."visualization",
    version."sourceCardExternalId",
    question."number"
  FROM "questionVersion" AS version
  JOIN "question" AS question ON question."id" = version."questionId"
  WHERE question."number" IN (8, 21, 23)
  ORDER BY version."questionId", version."version" DESC
)
INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
SELECT
  'atlas-retain-disabled-product-q' || latest."number" || '-v' || (latest."version" + 1),
  latest."questionId",
  latest."version" + 1,
  latest."queryLanguage",
  replace(
    latest."queryText",
    ' and coalesce(disabled,false)=false',
    ''
  ),
  latest."display",
  latest."visualization",
  latest."sourceCardExternalId",
  'atlas-governance',
  CURRENT_TIMESTAMP
FROM latest_versions AS latest
WHERE latest."queryText" LIKE '%coalesce(disabled,false)=false%'
ON CONFLICT ("questionId", "version") DO NOTHING;
