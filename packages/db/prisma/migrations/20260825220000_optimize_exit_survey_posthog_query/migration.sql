INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-exit-survey-v3',
  'atlas-cron-question-exit-survey',
  3,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'posthog',
    'personPolicy', 'exclude_banned_product_users',
    'query', $hog$with event_groups as (
  select
    toStartOfWeek(toTimeZone(timestamp, 'UTC')) as week_start,
    if(
      event = 'exit_survey_dismissed',
      '__dismissal__',
      if(
        properties.survey_completed = true,
        coalesce(nullIf(toString(properties.survey_reason), ''), 'unknown'),
        'no_response'
      )
    ) as reason,
    if(
      event = 'exit_survey_dismissed',
      '__dismissal__',
      if(
        properties.survey_completed = true,
        coalesce(nullIf(toString(properties.plan), ''), 'unknown'),
        'no_response'
      )
    ) as plan,
    countIf(event = 'subscription_cancel_pending') as source_event_rows,
    uniqExactIf(uuid, event = 'subscription_cancel_pending') as cancellation_requests,
    uniqExactIf(
      uuid,
      event = 'subscription_cancel_pending' and properties.survey_completed = true
    ) as responses,
    uniqExactIf(
      uuid,
      event = 'subscription_cancel_pending' and properties.survey_completed = true
    ) as response_group_count,
    uniqExactIf(uuid, event = 'exit_survey_dismissed') as dismissed_feedback_forms
  from events
  where event in ('subscription_cancel_pending', 'exit_survey_dismissed')
    and timestamp >= toStartOfWeek(toTimeZone(now(), 'UTC')) - interval 12 week
    and timestamp < toStartOfWeek(toTimeZone(now(), 'UTC'))
    and {{atlas_product_user_eligible}}
  group by week_start, reason, plan
), weekly as (
  select
    *,
    sum(source_event_rows) over (partition by week_start) as weekly_source_event_rows,
    sum(cancellation_requests) over (partition by week_start) as weekly_cancellation_requests,
    sum(responses) over (partition by week_start) as weekly_responses,
    sum(response_group_count) over (partition by week_start, reason) as reason_count,
    sum(response_group_count) over (partition by week_start, plan) as plan_count,
    sum(dismissed_feedback_forms) over (partition by week_start) as weekly_dismissed_feedback_forms
  from event_groups
)
select
  week_start,
  weekly_cancellation_requests as cancellation_requests,
  weekly_responses as responses,
  round(
    weekly_responses / nullIf(weekly_cancellation_requests, 0) * 100,
    2
  ) as response_rate_pct,
  reason,
  reason_count,
  plan,
  plan_count,
  response_group_count,
  weekly_dismissed_feedback_forms as dismissed_feedback_forms,
  replaceAll(reason, '_', ' ') as structured_theme,
  weekly_source_event_rows as source_event_rows,
  toStartOfWeek(toTimeZone(now(), 'UTC')) as data_through
from weekly
where reason != '__dismissal__'
order by week_start desc, reason_count desc, plan_count desc
limit 1000$hog$
  )),
  'table',
  '{"columns":["week_start","cancellation_requests","responses","response_rate_pct","reason","reason_count","plan","plan_count","dismissed_feedback_forms","data_through"]}'::jsonb,
  NULL,
  'atlas-exit-survey-query-optimizer',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;
