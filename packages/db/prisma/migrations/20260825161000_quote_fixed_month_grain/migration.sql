-- The direct Metabase runner needs the fixed grain as a SQL string literal.
UPDATE public."questionVersion" AS qv
SET "queryText" = replace(qv."queryText", 'month::text', '''month''::text')
FROM public.question AS q
WHERE qv."questionId" = q.id
  AND q.number IN (
    5032,
    5035,
    5036,
    5039,
    5041,
    5043,
    5046,
    6013,
    6014,
    6015,
    6016
  )
  AND qv."queryText" LIKE '%month::text%';
