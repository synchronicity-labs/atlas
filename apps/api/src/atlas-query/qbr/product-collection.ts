type ProductQuery = { databaseExternalId: string; queryText: string };

const databaseExternalId = "34";
const quarterStart = "2026-07-01";
const firstTouchTimestampPattern =
	"^([0-9]{4}-((01|03|05|07|08|10|12)-(0[1-9]|[12][0-9]|3[01])|(04|06|09|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-8]))|([0-9]{2}(0[48]|[2468][048]|[13579][26])|(0[48]|[2468][048]|[13579][26])00)-02-29)T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$";

function queryWindow(through: string | undefined, now: Date) {
	if (!Number.isFinite(now.getTime()))
		throw new Error("Invalid collection time.");
	const currentMonth = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
	)
		.toISOString()
		.slice(0, 10);
	const requested = through ?? currentMonth;
	const parsed = new Date(`${requested}T00:00:00.000Z`);
	if (
		!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(requested) ||
		Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== requested ||
		parsed.getUTCDate() !== 1
	)
		throw new Error("Collection through must be a UTC month boundary.");
	const end = requested < currentMonth ? requested : currentMonth;
	if (end <= quarterStart)
		throw new Error("No complete Q3 month is available.");
	return end > "2026-10-01" ? "2026-10-01" : end;
}

function eligibleGenerations(through: string) {
	return `select g.id, date_trunc('month', g.finished_at at time zone 'UTC') at time zone 'UTC' as period_start
  from public.generations g
  where g.finished_at >= timestamptz '${quarterStart} 00:00:00+00'
    and g.finished_at < timestamptz '${through} 00:00:00+00'
    and g.status = 'COMPLETED'
    and g.deleted_at is null
    and g.api_key_id is null
    and coalesce(g.source, '') <> 'api'`;
}

function feedbackCoverage(through: string) {
	return `with eligible_generations as (
  ${eligibleGenerations(through)}
), rated_generations as (
  select generation_id
  from public.generation_feedback
  where generation_id is not null
    and feedback_type in ('upvote', 'downvote')
  union
  select generation_id
  from public.generation_score
), monthly as (
  select e.period_start,
    count(*) filter (where r.generation_id is not null)::bigint as numerator,
    count(*)::bigint as denominator
  from eligible_generations e
  left join rated_generations r on r.generation_id = e.id
  group by e.period_start
)
select period_start, numerator, denominator,
  round(100.0 * numerator / nullif(denominator, 0), 2) as value
from monthly
order by period_start`;
}

function attributionCoverage(through: string) {
	return `with eligible_organizations as (
  select date_trunc('month', o.created_at at time zone 'UTC') at time zone 'UTC' as period_start,
    o.attribution
  from public.organizations o
  where o.created_at >= timestamptz '${quarterStart} 00:00:00+00'
    and o.created_at < timestamptz '${through} 00:00:00+00'
    and coalesce(o.attribution ->> 'origin', '') not in ('partner_provisioning', 'backfill')
), monthly as (
  select period_start,
    count(*) filter (where nullif(attribution ->> 'source', '') is not null
      and attribution ->> 'first_touch_at' ~ '${firstTouchTimestampPattern}')::bigint as numerator,
    count(*)::bigint as denominator
  from eligible_organizations
  group by period_start
)
select period_start, numerator, denominator,
  round(100.0 * numerator / nullif(denominator, 0), 2) as value
from monthly
order by period_start`;
}

function upvoteDiagnostic(through: string) {
	return `with eligible_generations as (
  ${eligibleGenerations(through)}
), events as (
  select f.generation_id, f.feedback_type = 'upvote' as positive
  from public.generation_feedback f
  where f.generation_id is not null
    and f.feedback_type in ('upvote', 'downvote')
  union all
  select s.generation_id, s.score >= 4
  from public.generation_score s
), per_generation as (
  select e.generation_id,
    bool_or(e.positive) as has_positive,
    bool_or(not e.positive) as has_negative
  from events e
  join eligible_generations g on g.id = e.generation_id
  group by e.generation_id
), totals as (
  select count(*)::bigint as rated_generations,
    count(*) filter (where has_positive)::bigint as any_positive,
    count(*) filter (where has_positive and not has_negative)::bigint as positive_only,
    count(*) filter (where has_positive and has_negative)::bigint as conflicting,
    count(*) filter (where not has_positive)::bigint as negative_only
  from per_generation
), event_total as (
  select count(*)::bigint as rating_events
  from events e
  join eligible_generations g on g.id = e.generation_id
)
select *, round(100.0 * positive_only / nullif(rated_generations, 0), 2) as positive_only_rate,
  round(100.0 * any_positive / nullif(rated_generations, 0), 2) as any_positive_rate
from totals cross join event_total`;
}

function returnLiftDiagnostic(through: string, now: Date) {
	const asOf = now.toISOString();
	return `with assigned as (
  select f.organization_id,
    stamp.key as assignment_key,
    stamp.value ->> 'arm' as arm,
    (stamp.value ->> 'sentAt')::timestamptz as assigned_at
  from public.organization_features f
  cross join lateral jsonb_each(coalesce(f.emails_received, '{}'::jsonb)) as stamp(key, value)
  where (stamp.key like 'firstGenerationDropOff:%'
      or stamp.key like 'generationCompletedUnviewed:%')
    and stamp.value ->> 'arm' in ('treated', 'holdback')
    and (stamp.value ->> 'sentAt')::timestamptz >= timestamptz '${quarterStart} 00:00:00+00'
    and (stamp.value ->> 'sentAt')::timestamptz < timestamptz '${through} 00:00:00+00'
), per_organization as (
  select organization_id,
    min(arm) as arm,
    min(assigned_at) as assigned_at,
    count(*)::bigint as pair_stamps,
    count(distinct arm)::bigint as arms
  from assigned
  group by organization_id
), integrity as (
  select count(*) filter (where pair_stamps <> 1 or arms <> 1)::bigint as ambiguous_pair_organizations
  from per_organization
), unique_assignments as (
  select a.organization_id, a.arm, a.assigned_at,
    exists (
      select 1 from public.generations g
      where g.organization_id = a.organization_id
        and g.created_at > a.assigned_at
        and g.created_at <= a.assigned_at + interval '14 days'
    ) as returned
  from per_organization a
  where a.pair_stamps = 1 and a.arms = 1
), monthly as (
  select date_trunc('month', assigned_at at time zone 'UTC') at time zone 'UTC' as period_start,
    arm,
    count(*)::bigint as assignments,
    count(*) filter (where assigned_at <= timestamptz '${asOf}' - interval '14 days')::bigint as mature_assignments,
    count(*) filter (where assigned_at <= timestamptz '${asOf}' - interval '14 days' and returned)::bigint as returned
  from unique_assignments
  group by 1, 2
), months as (
  select generate_series(
    timestamp '${quarterStart} 00:00:00',
    timestamp '${through} 00:00:00' - interval '1 month',
    interval '1 month'
  ) as period_start
), arms as (
  select unnest(array['treated', 'holdback']::text[]) as arm
)
select m.period_start, a.arm,
  coalesce(r.assignments, 0)::bigint as assignments,
  coalesce(r.mature_assignments, 0)::bigint as mature_assignments,
  coalesce(r.returned, 0)::bigint as returned,
  case when coalesce(r.mature_assignments, 0) = 0 then null
    else round(100.0 * r.returned / r.mature_assignments, 4) end as value,
  i.ambiguous_pair_organizations
from months m
cross join arms a
left join monthly r on r.period_start = m.period_start and r.arm = a.arm
cross join integrity i
order by m.period_start, a.arm`;
}

function returnLiftByMonth(through: string, now: Date) {
	return `with diagnostic as (
  ${returnLiftDiagnostic(through, now)}
), monthly as (
  select period_start,
    max(ambiguous_pair_organizations)::bigint as ambiguous_pair_organizations,
    max(assignments) filter (where arm = 'treated')::bigint as treated_assignments,
    max(mature_assignments) filter (where arm = 'treated')::bigint as treated_mature_assignments,
    max(returned) filter (where arm = 'treated')::bigint as treated_returned,
    max(assignments) filter (where arm = 'holdback')::bigint as holdback_assignments,
    max(mature_assignments) filter (where arm = 'holdback')::bigint as holdback_mature_assignments,
    max(returned) filter (where arm = 'holdback')::bigint as holdback_returned
  from diagnostic
  group by period_start
)
select period_start,
  round(100.0 * (
    treated_returned::numeric * holdback_mature_assignments
      / nullif(treated_mature_assignments::numeric * holdback_returned, 0) - 1
  ), 2) as value,
  treated_returned,
  treated_mature_assignments as treated_assignments,
  holdback_returned,
  holdback_mature_assignments as holdback_assignments,
  ambiguous_pair_organizations
from monthly
where treated_assignments > 0
  and holdback_assignments > 0
  and holdback_returned > 0
  and treated_assignments = treated_mature_assignments
  and holdback_assignments = holdback_mature_assignments
  and ambiguous_pair_organizations = 0
order by period_start`;
}

function productQueries(
	queries: Record<string, string>,
): Record<string, ProductQuery> {
	return Object.fromEntries(
		Object.entries(queries).map(([id, queryText]) => [
			id,
			{ databaseExternalId, queryText },
		]),
	);
}

export function productCollectionQueries(): Record<string, ProductQuery>;
export function productCollectionQueries(
	through: string,
	now: Date,
): Record<string, ProductQuery>;
export function productCollectionQueries(through?: string, now = new Date()) {
	const end = queryWindow(through, now);
	return productQueries({
		product_feedback_coverage: feedbackCoverage(end),
		product_attribution: attributionCoverage(end),
		product_return_lift: returnLiftByMonth(end, now),
	});
}

export function productCollectionDiagnostics(through: string, now: Date) {
	const end = queryWindow(through, now);
	return productQueries({
		product_upvotes: upvoteDiagnostic(end),
		product_return_lift: returnLiftDiagnostic(end, now),
	});
}
