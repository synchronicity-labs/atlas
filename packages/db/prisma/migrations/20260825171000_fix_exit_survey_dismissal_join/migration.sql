UPDATE "questionVersion"
SET "queryText" = replace(
  "queryText",
  'on dismissals.week_start = groups.week_start',
  'on dismissals.week_start = totals.week_start'
)
WHERE "id" = 'atlas-cron-question-exit-survey-v2'
  AND "queryText" LIKE '%on dismissals.week_start = groups.week_start%';
