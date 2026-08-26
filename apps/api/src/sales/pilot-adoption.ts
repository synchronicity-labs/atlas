import type {
	ActivePilotRegistry,
	HubspotSalesResult,
} from "@crm/db/hubspot-sales";

function textLiteral(value: string): string {
	return `'${value.replaceAll("'", "''").replaceAll("\0", "")}'`;
}

function timestampLiteral(value: Date | null): string {
	return value ? `${textLiteral(value.toISOString())}::timestamptz` : "null";
}

export function buildPilotAdoptionQuery(registry: ActivePilotRegistry): string {
	if (registry.entries.length === 0) return "";
	const values = registry.entries
		.map(
			(entry, index) =>
				`(${index + 1}, ${textLiteral(entry.account)}, ${
					entry.domain ? textLiteral(entry.domain) : "null"
				}, ${textLiteral(entry.owner)}, ${timestampLiteral(entry.pilotStartedAt)})`,
		)
		.join(",\n    ");
	const dataThrough = timestampLiteral(registry.dataThrough);
	return `with registry (ordinal, account, domain, owner, pilot_started_at) as (
  values
    ${values}
),
proof_users as (
  select distinct r.ordinal, uo.organization_id
  from registry r
  join auth.users u
    on r.domain is not null
   and split_part(lower(u.email::text), '@', 2) = r.domain
  join public.user_organizations uo on uo.user_id = u.id
  where coalesce(u.banned, false) = false
    and coalesce(u.disabled, false) = false
    and coalesce(u.is_anonymous, false) = false
    and u.email is not null
    and split_part(lower(u.email::text), '@', 2) not in ('sync.so', 'sync.labs', 'synclabs.so')
),
matched_orgs as (
  select distinct ordinal, organization_id
  from proof_users
),
clean_members as (
  select distinct mo.ordinal, u.id as user_id, u.last_seen
  from matched_orgs mo
  join public.user_organizations uo on uo.organization_id = mo.organization_id
  join auth.users u on u.id = uo.user_id
  where coalesce(u.banned, false) = false
    and coalesce(u.disabled, false) = false
    and coalesce(u.is_anonymous, false) = false
    and u.email is not null
    and split_part(lower(u.email::text), '@', 2) not in ('sync.so', 'sync.labs', 'synclabs.so')
),
user_summary as (
  select
    ordinal,
    count(distinct user_id)::int as users,
    count(distinct user_id) filter (where last_seen >= now() - interval '24 hours')::int as active_users_24h,
    max(last_seen) as latest_user_activity
  from clean_members
  group by ordinal
),
pending_invite_summary as (
  select
    mo.ordinal,
    count(distinct oi.id)::int as pending_invites
  from matched_orgs mo
  join public.organization_invitations oi on oi.organization_id = mo.organization_id
  where lower(coalesce(oi.status, '')) = 'pending'
    and oi.expires_at > now()
    and split_part(lower(oi.email), '@', 2) not in ('sync.so', 'sync.labs', 'synclabs.so')
  group by mo.ordinal
),
clean_generations as (
  select mo.ordinal, g.*
  from matched_orgs mo
  join public.generations g on g.organization_id = mo.organization_id
  join auth.users u on u.id = g.user_id
  where g.deleted_at is null
    and coalesce(u.banned, false) = false
    and coalesce(u.disabled, false) = false
    and coalesce(u.is_anonymous, false) = false
    and u.email is not null
    and split_part(lower(u.email::text), '@', 2) not in ('sync.so', 'sync.labs', 'synclabs.so')
),
generation_summary as (
  select
    ordinal,
    count(*) filter (where created_at >= now() - interval '24 hours')::int as generations_24h,
    count(*)::int as generations_to_date,
    count(*) filter (where status = 'COMPLETED')::int as completed_generations,
    count(*) filter (where status in ('FAILED', 'REJECTED'))::int as failed_generations,
    round((coalesce(sum(output_media_length) filter (where status = 'COMPLETED'), 0) / 3600.0)::numeric, 2) as output_hours,
    max(created_at) as latest_generation_activity
  from clean_generations
  group by ordinal
),
model_counts as (
  select ordinal, coalesce(nullif(model_name, ''), 'unknown') as model, count(*)::int as generations
  from clean_generations
  group by ordinal, coalesce(nullif(model_name, ''), 'unknown')
),
model_summary as (
  select ordinal, string_agg(model || ':' || generations, ', ' order by generations desc, model) as model_usage
  from model_counts
  group by ordinal
),
surface_counts as (
  select ordinal, coalesce(nullif(source, ''), 'app') as surface, count(*)::int as generations
  from clean_generations
  group by ordinal, coalesce(nullif(source, ''), 'app')
),
surface_summary as (
  select ordinal, string_agg(surface || ':' || generations, ', ' order by generations desc, surface) as surface_usage
  from surface_counts
  group by ordinal
),
workspace_summary as (
  select ordinal, count(*)::int as matched_workspaces
  from matched_orgs
  group by ordinal
)
select
  r.account,
  'active'::text as pilot_status,
  r.pilot_started_at as pilot_start,
  null::timestamptz as pilot_end,
  r.owner,
  case when coalesce(ws.matched_workspaces, 0) > 0 then 'domain_verified' else 'not_verified' end as workspace_mapping,
  coalesce(ws.matched_workspaces, 0) as matched_workspaces,
  coalesce(us.users, 0) as users,
  coalesce(us.active_users_24h, 0) as active_users_24h,
  coalesce(pi.pending_invites, 0) as pending_invites,
  coalesce(gs.generations_24h, 0) as generations_24h,
  coalesce(gs.generations_to_date, 0) as generations_to_date,
  coalesce(gs.completed_generations, 0) as completed_generations,
  coalesce(gs.failed_generations, 0) as failed_generations,
  coalesce(gs.output_hours, 0) as output_hours,
  coalesce(ms.model_usage, '') as model_usage,
  coalesce(ss.surface_usage, '') as surface_usage,
  greatest(us.latest_user_activity, gs.latest_generation_activity) as latest_activity_at,
  ${dataThrough} as data_through
from registry r
left join workspace_summary ws on ws.ordinal = r.ordinal
left join user_summary us on us.ordinal = r.ordinal
left join pending_invite_summary pi on pi.ordinal = r.ordinal
left join generation_summary gs on gs.ordinal = r.ordinal
left join model_summary ms on ms.ordinal = r.ordinal
left join surface_summary ss on ss.ordinal = r.ordinal
order by r.ordinal`;
}

export function emptyPilotAdoptionResult(): HubspotSalesResult {
	const column = (name: string, displayName: string, baseType: string) => ({
		name,
		displayName,
		baseType,
	});
	return {
		columns: [
			column("account", "Account", "type/Text"),
			column("pilot_status", "Pilot status", "type/Text"),
			column("pilot_start", "Pilot start", "type/DateTime"),
			column("pilot_end", "Pilot end", "type/DateTime"),
			column("owner", "Owner", "type/Text"),
			column("workspace_mapping", "Workspace mapping", "type/Text"),
			column("matched_workspaces", "Matched workspaces", "type/Integer"),
			column("users", "Users", "type/Integer"),
			column("active_users_24h", "Active users 24h", "type/Integer"),
			column("pending_invites", "Pending invites", "type/Integer"),
			column("generations_24h", "Generations 24h", "type/Integer"),
			column("generations_to_date", "Generations to date", "type/Integer"),
			column("completed_generations", "Completed generations", "type/Integer"),
			column("failed_generations", "Failed generations", "type/Integer"),
			column("output_hours", "Output hours", "type/Decimal"),
			column("model_usage", "Model usage", "type/Text"),
			column("surface_usage", "Surface usage", "type/Text"),
			column("latest_activity_at", "Latest activity", "type/DateTime"),
			column("data_through", "Data through", "type/DateTime"),
		],
		rows: [],
	};
}
