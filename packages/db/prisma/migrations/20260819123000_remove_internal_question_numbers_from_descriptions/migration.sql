UPDATE "public"."question"
SET "description" = regexp_replace(
  "description",
  '^The governed result for Atlas question [0-9]+, ',
  'The governed result for '
)
WHERE "description" ~ '^The governed result for Atlas question [0-9]+, ';

UPDATE "metrics"."metricDefinition"
SET "description" = regexp_replace(
  "description",
  '^The governed result for Atlas question [0-9]+, ',
  'The governed result for '
)
WHERE "description" ~ '^The governed result for Atlas question [0-9]+, ';
