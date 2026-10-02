import type { MarketingQuery } from "../../marketing/marketing.contracts";

export type QbrQueryDefinition = {
	queryText: string;
	databaseExternalId: string;
};

export function qbrLatencyDiagnosticSql(period: "month" | "quarter") {
	const grouping = period === "quarter" ? "quarter" : "month";
	return `select date_trunc('${grouping}', g.created_at at time zone 'UTC') as period_start,
  g.model_name,
  case
    when g.duration <= 5 then '0-5s'
    when g.duration <= 10 then '>5-10s'
    when g.duration <= 30 then '>10-30s'
    when g.duration <= 60 then '>30-60s'
    else '>60s'
  end as duration_bucket,
  count(*)::int as sample_count,
  round((percentile_cont(0.95) within group (order by extract(epoch from (g.finished_at - g.started_at)) * 1000))::numeric, 1)::float as p95_generation_latency_ms
from public.generations g
where g.created_at >= timestamptz '2026-07-01 00:00:00+00'
  and g.created_at < timestamptz '2026-10-01 00:00:00+00'
  and g.deleted_at is null
  and g.status::text = 'COMPLETED'
  and g.started_at is not null
  and g.finished_at is not null
  and g.finished_at >= g.started_at
  and g.duration >= 0
  and g.model_name is not null
group by 1, 2, 3
order by 1, 2, min(case
  when g.duration <= 5 then 1
  when g.duration <= 10 then 2
  when g.duration <= 30 then 3
  when g.duration <= 60 then 4
  else 5
end)`;
}

type QbrMarketingQuery = MarketingQuery & {
	exactRange?: { startDate: string; endDateExclusive: string };
};

export const additionalQbrQueries: Record<string, QbrQueryDefinition> = {
	platform_latency_by_model_duration: {
		databaseExternalId: "34",
		queryText: qbrLatencyDiagnosticSql("month"),
	},
	platform_latency_by_model_duration_q3: {
		databaseExternalId: "34",
		queryText: qbrLatencyDiagnosticSql("quarter"),
	},
	platform_generation_status_diagnostic: {
		databaseExternalId: "34",
		queryText: `select date_trunc('month', g.created_at at time zone 'UTC') as period_start,
  g.status::text as generation_status,
  count(*)::int as generation_count,
  min(g.created_at) as first_created_at,
  max(g.updated_at) as last_updated_at
from public.generations g
where g.created_at >= timestamptz '2026-07-01 00:00:00+00'
  and g.created_at < timestamptz '2026-10-01 00:00:00+00'
  and g.deleted_at is null
group by 1, 2
order by 1, 2`,
	},
	platform_output_minutes_diagnostic: {
		databaseExternalId: "34",
		queryText: `select date_trunc('month', g.created_at at time zone 'UTC') as period_start,
  g.model_name,
  count(*)::int as completed_generations_with_output,
  sum(g.output_media_length) / 60.0 as completed_output_minutes
from public.generations g
where g.created_at >= timestamptz '2026-07-01 00:00:00+00'
  and g.created_at < timestamptz '2026-10-01 00:00:00+00'
  and g.deleted_at is null
  and g.status::text = 'COMPLETED'
  and g.output_media_length > 0
group by 1, 2
order by 1, 2`,
	},
};

export const additionalMarketingQueries: Record<string, QbrMarketingQuery> = {
	marketing_visitors_by_site_month: {
		source: "ga4",
		exactRange: { startDate: "2026-07-01", endDateExclusive: "2026-10-01" },
		properties: ["landing", "blog", "playground", "docs", "lipsync", "support"],
		dateRange: "90_days",
		dimensions: ["yearMonth"],
		metrics: ["totalUsers"],
		merge: "rows",
		completeMonthsOnly: true,
		limit: 1000,
	},
	marketing_clean_signups_by_month: {
		source: "posthog",
		personPolicy: "exclude_banned_product_users",
		query: `with signup_people as (
  select person_id,
    min(toTimeZone(timestamp, 'UTC')) as signup_at,
    argMin(if(properties.first_touch_at is not null
      and timestamp >= properties.first_touch_at
      and timestamp < properties.first_touch_at + interval 7 day,
      coalesce(nullIf(lower(toString(properties.source)), ''), 'missing'), 'missing'), timestamp) as first_touch_source
  from events
  where event = 'user_signed_up'
    and timestamp >= toDateTime('2026-07-01 00:00:00', 'UTC')
    and timestamp < toDateTime('2026-10-01 00:00:00', 'UTC')
    and {{atlas_product_user_eligible}}
  group by person_id
)
select toStartOfMonth(toTimeZone(signup_at, 'UTC')) as period_start,
  count() as unique_signup_people,
  countIf(first_touch_source = 'missing') as missing_first_touch_people
from signup_people
group by period_start
order by period_start`,
	},
};
