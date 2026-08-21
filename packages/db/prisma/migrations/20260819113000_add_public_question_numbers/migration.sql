CREATE SEQUENCE "public"."question_publicNumber_seq";

ALTER TABLE "public"."question"
ADD COLUMN "publicNumber" INTEGER;

UPDATE "public"."question"
SET "publicNumber" = "number"
WHERE "number" < 1000;

WITH available_numbers AS (
  SELECT
    candidate,
    row_number() OVER (ORDER BY candidate) AS position
  FROM generate_series(
    1,
    (SELECT count(*)::integer + 1000 FROM "public"."question")
  ) AS candidate
  WHERE NOT EXISTS (
    SELECT 1
    FROM "public"."question" AS existing
    WHERE existing."number" < 1000
      AND existing."number" = candidate
  )
), compact_questions AS (
  SELECT
    "id",
    row_number() OVER (ORDER BY "createdAt", "id") AS position
  FROM "public"."question"
  WHERE "number" >= 1000
)
UPDATE "public"."question" AS question
SET "publicNumber" = available_numbers.candidate
FROM compact_questions
JOIN available_numbers
  ON available_numbers.position = compact_questions.position
WHERE question."id" = compact_questions."id";

ALTER TABLE "public"."question"
ALTER COLUMN "publicNumber" SET NOT NULL,
ALTER COLUMN "publicNumber" SET DEFAULT nextval('"public"."question_publicNumber_seq"');

SELECT setval(
  '"public"."question_publicNumber_seq"',
  (SELECT max("publicNumber") FROM "public"."question"),
  true
);

CREATE UNIQUE INDEX "question_publicNumber_key"
ON "public"."question"("publicNumber");

UPDATE "public"."question"
SET "name" = regexp_replace(
  regexp_replace("name", '^[0-9]{2}[[:space:]]+', ''),
  '^R[0-9]{1,2}[.\-:)]?[[:space:]]+',
  '',
  'i'
)
WHERE "name" ~ '^[0-9]{2}[[:space:]]+'
   OR "name" ~* '^R[0-9]{1,2}[.\-:)]?[[:space:]]+';

UPDATE "metrics"."metricDefinition"
SET "name" = regexp_replace(
  regexp_replace("name", '^[0-9]{2}[[:space:]]+', ''),
  '^R[0-9]{1,2}[.\-:)]?[[:space:]]+',
  '',
  'i'
)
WHERE "name" ~ '^[0-9]{2}[[:space:]]+'
   OR "name" ~* '^R[0-9]{1,2}[.\-:)]?[[:space:]]+';

UPDATE "metrics"."metricVerification"
SET
  "status" = 'PENDING',
  "evidence" = jsonb_build_object(
    'reason',
    'The query ran successfully but returned no rows for this period. Confirm whether zero rows are expected or make the query return an explicit zero.'
  ),
  "verifiedBy" = NULL,
  "verifiedAt" = NULL
WHERE "name" = 'result_non_empty'
  AND "status" = 'FAILED';

UPDATE "metrics"."metricSnapshot" AS snapshot
SET "trustStatus" = 'PENDING'
WHERE snapshot."trustStatus" = 'FAILED'
  AND NOT EXISTS (
    SELECT 1
    FROM "metrics"."metricVerification" AS verification
    WHERE verification."metricRunId" = snapshot."metricRunId"
      AND verification."status" = 'FAILED'
  );
