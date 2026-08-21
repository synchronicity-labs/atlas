UPDATE "questionVersion"
SET "queryText" = split_part("queryText", ', revenue_values as (', 1) || $query$
select
  usage.period_start,
  subscription_base.subscription_run_rate
    + if(
        usage.is_current = 1,
        usage.usage_actual * dateDiff('second', usage.period_start, addMonths(usage.period_start, 1)) / nullIf(dateDiff('second', usage.period_start, usage.period_end), 0),
        usage.usage_actual
      )
    + if(
        topups.is_current = 1,
        topups.top_up_actual * dateDiff('second', topups.period_start, addMonths(topups.period_start, 1)) / nullIf(dateDiff('second', topups.period_start, topups.period_end), 0),
        topups.top_up_actual
      ) as product_run_rate,
  usage.period_end,
  bounds.data_through as data_through
from usage
inner join topups on topups.period_start = usage.period_start
inner join subscription_base on subscription_base.period_start = usage.period_start
cross join bounds
order by usage.period_start$query$
WHERE "id" = 'atlas-weekly-revenue-version-run-rate-v4';

UPDATE "questionVersion"
SET "queryText" = split_part("queryText", ', revenue_values as (', 1) || $query$
select
  usage.period_start,
  if(
    usage.is_current = 1,
    usage.usage_actual * dateDiff('second', usage.period_start, addMonths(usage.period_start, 1)) / nullIf(dateDiff('second', usage.period_start, usage.period_end), 0),
    usage.usage_actual
  ) + if(
    topups.is_current = 1,
    topups.top_up_actual * dateDiff('second', topups.period_start, addMonths(topups.period_start, 1)) / nullIf(dateDiff('second', topups.period_start, topups.period_end), 0),
    topups.top_up_actual
  ) as variable_revenue_run_rate,
  usage.period_end,
  bounds.data_through as data_through
from usage
inner join topups on topups.period_start = usage.period_start
cross join bounds
order by usage.period_start$query$
WHERE "id" = 'atlas-weekly-revenue-version-variable-run-rate-v1';
