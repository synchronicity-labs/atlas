INSERT INTO "dataSource" ("id", "key", "kind", "label", "state", "createdAt", "updatedAt")
VALUES (
  'atlas-marketing-conversion-rate-source',
  'atlas:marketing:conversion-rate',
  'ATLAS',
  'Marketing visitor-to-signup rate',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

UPDATE "question"
SET "sourceId" = 'atlas-marketing-conversion-rate-source',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-question-conversion-rate'
  AND "sourceId" = 'atlas-marketing-source';
