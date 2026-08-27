UPDATE "question"
SET "sourceId" = 'atlas-marketing-conversion-rate-source',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-question-conversion'
  AND "sourceId" = 'atlas-marketing-source';

UPDATE "dataSource"
SET "label" = 'Marketing visitor-to-signup conversion',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-marketing-conversion-rate-source';
