UPDATE "question"
SET
  "name" = BTRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE("name", '^[0-9]{2}[[:space:]]+', '', 'i'),
      '^api split[[:space:]]*[-–—:][[:space:]]*',
      '',
      'i'
    )
  ),
  "updatedAt" = NOW()
WHERE
  "connector" = 'METABASE'
  AND (
    "name" ~ '^[0-9]{2}[[:space:]]+'
    OR "name" ~* '^api split[[:space:]]*[-–—:]'
  );
