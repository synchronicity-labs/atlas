UPDATE "questionVersion"
SET "queryText" = replace(
  replace(
    "queryText",
    'any(totals.report_total) as report_total_usage,',
    'any(totals.report_total) as report_total_usage_accrual,'
  ),
  'any(totals.report_total) - sum(retained_value) as usage_outside_starting_cohort,',
  'any(totals.report_total) - sum(retained_value) as usage_outside_starting_cohort_accrual,'
)
WHERE "questionId" = 'atlas-revenue-question-weekly-retention-bridge'
  AND "version" = 1;
