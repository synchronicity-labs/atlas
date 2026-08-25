-- Atlas executes these native SQL questions directly through Metabase without
-- dashboard filter parameters. Use a deterministic monthly grain until the
-- URL-backed period selector supplies explicit query parameters.
UPDATE public."questionVersion" AS qv
SET "queryText" = replace(qv."queryText", '{{bucket}}', 'month')
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
  AND qv."queryText" LIKE '%{{bucket}}%';
