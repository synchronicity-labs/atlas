UPDATE "questionVersion"
SET "queryText" = replace(
  replace(
    "queryText",
    E'\n  prewhere "generationEndedAt"',
    E'\n  where "generationEndedAt"'
  ),
  E'\n  where "organizationPlanType"',
  E'\n    and "organizationPlanType"'
)
WHERE "questionId" IN (
  SELECT "id"
  FROM "question"
  WHERE "number" IN (7020, 7021, 7022, 7023)
);
