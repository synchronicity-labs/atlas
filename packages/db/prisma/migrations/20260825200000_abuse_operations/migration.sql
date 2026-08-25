UPDATE "question"
SET
  "name" = 'Signup abuse rings and blocked-attempt detail',
  "description" = 'Rolling 24-hour blocked signup attempts by reason, thresholded domain ring, thresholded IP ring, and bot user agent. Common mailbox providers are excluded from domain rings. Customer, user, organization, and email identifiers are not published.',
  "connector" = 'ATLAS',
  "sourceId" = (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:abuse'),
  "sourceDashboardExternalId" = 'atlas:abuse:operations',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-abuse-detail';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-abuse-detail-v2',
  'atlas-cron-question-abuse-detail',
  2,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'posthog',
    'personPolicy', 'all_events',
    'query', $hog$with blocked as (
  select
    coalesce(nullIf(toString(properties.reason), ''), '(blank)') as reason,
    lower(toString(properties.domain)) as domain,
    toString(properties.ip) as ip,
    toString(properties.user_agent) as user_agent
  from events
  where event = 'signup_blocked'
    and timestamp >= now() - interval 1 day
    and timestamp < now()
), totals as (
  select count() as headline_total
  from blocked
), detail as (
  select
    0 as section_order,
    'summary' as section,
    'all blocked attempts' as dimension_value,
    count() as blocked_attempts,
    uniqExact(domain) as related_count,
    'domains' as related_dimension
  from blocked
  union all
  select
    1,
    'reason',
    reason,
    count(),
    uniqExact(domain),
    'domains'
  from blocked
  group by reason
  union all
  select
    2,
    'domain_ring',
    domain,
    count(),
    uniqExact(ip),
    'ips'
  from blocked
  where nullIf(trim(domain), '') is not null
    and domain not in (
      'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
      'msn.com', 'icloud.com', 'me.com', 'yahoo.com', 'ymail.com', 'aol.com',
      'proton.me', 'protonmail.com', 'qq.com', '163.com', 'naver.com',
      'duck.com', 'mail.ru', 'yandex.ru'
    )
  group by domain
  having count() >= 5
  union all
  select
    3,
    'ip_ring',
    ip,
    count(),
    uniqExact(domain),
    'domains'
  from blocked
  where nullIf(trim(ip), '') is not null
  group by ip
  having count() >= 5
  union all
  select
    4,
    'bot_user_agent',
    user_agent,
    count(),
    0,
    'none'
  from blocked
  where reason = 'bot_user_agent'
    and nullIf(trim(user_agent), '') is not null
  group by user_agent
)
select
  section,
  dimension_value,
  blocked_attempts,
  related_count,
  related_dimension,
  totals.headline_total,
  now() as data_through
from detail
cross join totals
order by section_order, blocked_attempts desc, dimension_value
limit 1000$hog$
  )),
  'table',
  '{"columns":["section","dimension_value","blocked_attempts","related_count","related_dimension","headline_total","data_through"]}'::jsonb,
  NULL,
  'atlas-abuse-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "question" (
  "id", "number", "publicNumber", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES (
  'atlas-abuse-question-enforcement-detail',
  7017,
  270,
  'Signup abuse enforcement and fresh-ring diagnostics',
  'Rolling 24-hour learned blocks and bans, seven-day auto-bans, fresh IP-ring candidates and verdicts, and generation distribution for newly banned users. Operational domain, IP, and user-agent values may appear. Email, customer, user, and organization identifiers are not published.',
  'METABASE',
  (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:abuse'),
  'cron:abuse:enforcement-detail',
  'atlas:abuse:operations',
  '34',
  'ACTIVE',
  'RECONCILIATION',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "connector" = EXCLUDED."connector",
  "sourceId" = EXCLUDED."sourceId",
  "sourceExternalId" = EXCLUDED."sourceExternalId",
  "sourceDashboardExternalId" = EXCLUDED."sourceDashboardExternalId",
  "databaseExternalId" = EXCLUDED."databaseExternalId",
  "status" = EXCLUDED."status",
  "purpose" = EXCLUDED."purpose",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-abuse-question-enforcement-detail-v1',
  'atlas-abuse-question-enforcement-detail',
  1,
  'SQL',
  $sql$with cutoff as (
  select date_trunc('minute', now()) as data_through
), learned as (
  select b.type, coalesce(b.reason, '(none)') as reason, count(*)::int as item_count
  from auth.abuse_blocklist b cross join cutoff c
  where b.created_at >= c.data_through - interval '1 day'
    and b.created_at < c.data_through
    and b.active = true
    and b.source in ('auto_signup_guard', 'admin_internal')
  group by b.type, coalesce(b.reason, '(none)')
), recent_learned as (
  select b.type, b.value, coalesce(b.reason, '') as reason,
    coalesce(b.source, '') as source,
    row_number() over (order by b.created_at desc) as rank
  from auth.abuse_blocklist b cross join cutoff c
  where b.created_at >= c.data_through - interval '1 day'
    and b.created_at < c.data_through
    and b.active = true
    and b.source in ('auto_signup_guard', 'admin_internal')
    and b.type in ('domain', 'ip', 'user_agent')
), maintenance as (
  select coalesce(b.source, '(none)') as source, count(*)::int as item_count
  from auth.abuse_blocklist b cross join cutoff c
  where b.created_at >= c.data_through - interval '1 day'
    and b.created_at < c.data_through
    and b.source in ('github_disposable_sync', 'baseline_seed')
  group by coalesce(b.source, '(none)')
), banned_24h as (
  select coalesce(u.ban_reason, '(none)') as reason, count(*)::int as user_count
  from auth.users u cross join cutoff c
  where u.banned = true
    and u.updated_at >= c.data_through - interval '1 day'
    and u.updated_at < c.data_through
  group by coalesce(u.ban_reason, '(none)')
), free_users as (
  select u.id, lower(split_part(u.email, '@', 2)) as domain,
    lower(u.signup_ip) as signup_ip, u.created_at, u.banned
  from auth.users u cross join cutoff c
  where u.created_at >= c.data_through - interval '7 days'
    and u.created_at < c.data_through
    and u.is_anonymous = false
    and u.signup_ip is not null
    and btrim(u.signup_ip) <> ''
    and not exists (
      select 1 from auth.abuse_blocklist b
      where b.type = 'ban_exempt'
        and b.value = lower(u.email)
        and b.active = true
        and (b.expires_at is null or b.expires_at > c.data_through)
    )
    and not exists (
      select 1
      from public.user_organizations uo
      join public.organizations o on o.id = uo.organization_id
      where uo.user_id = u.id
        and o.first_subscribed_at is not null
    )
), ip_activity as (
  select fu.signup_ip as ip,
    count(distinct fu.id)::int as signup_count,
    count(distinct fu.domain)::int as distinct_domains,
    count(distinct fu.id) filter (where fu.banned is true)::int as banned_count,
    count(distinct ak.user_id) filter (
      where ak.created_at <= fu.created_at + interval '5 minutes'
    )::int as fast_api_key_users,
    count(distinct g.user_id) filter (where g.api_key_id is not null)::int as api_generation_users
  from free_users fu
  left join public.generations g
    on g.user_id = fu.id and g.created_at >= fu.created_at
  left join public.api_keys ak
    on ak.user_id = fu.id and ak.created_at >= fu.created_at
  group by fu.signup_ip
), fresh_candidates as (
  select *
  from ip_activity
  where signup_count >= 20
    and distinct_domains >= 10
    and banned_count::float / signup_count < 0.8
    and (fast_api_key_users >= 10 or api_generation_users >= 10)
), fresh_verdict as (
  select
    count(*) filter (
      where b.active = true
        and (b.expires_at is null or b.expires_at > c.data_through)
    )::int as active_total,
    count(*) filter (
      where b.created_at >= c.data_through - interval '1 day'
        and b.created_at < c.data_through
    )::int as created_in_window
  from auth.abuse_blocklist b cross join cutoff c
  where b.type = 'ip' and b.source = 'auto_fresh_ip_ring'
), autoban_day as (
  select date_trunc('day', u.updated_at)::date as day, count(*)::int as user_count
  from auth.users u cross join cutoff c
  where u.banned = true
    and u.updated_at >= c.data_through - interval '7 days'
    and u.updated_at < c.data_through
    and coalesce(u.ban_reason, '') like 'recent_abuse_auto:%'
  group by 1
), autoban_reason as (
  select substring(
      coalesce(u.ban_reason, '') from length('recent_abuse_auto:') + 1
    ) as reason,
    count(*)::int as user_count
  from auth.users u cross join cutoff c
  where u.banned = true
    and u.updated_at >= c.data_through - interval '7 days'
    and u.updated_at < c.data_through
    and coalesce(u.ban_reason, '') like 'recent_abuse_auto:%'
  group by 1
), cohorts as (
  select 'all' as cohort, u.id
  from auth.users u cross join cutoff c
  where u.banned = true
    and u.updated_at >= c.data_through - interval '1 day'
    and u.updated_at < c.data_through
  union all
  select 'free_ex_chargeback', u.id
  from auth.users u
  left join public.organizations o on o.id = u.organization_id
  cross join cutoff c
  where u.banned = true
    and u.updated_at >= c.data_through - interval '1 day'
    and u.updated_at < c.data_through
    and o.first_subscribed_at is null
    and coalesce(u.ban_reason, '') <> 'Repeat chargeback (>=2 disputes)'
), gen_counts as (
  select c.cohort, c.id, count(g.id)::int as generations
  from cohorts c
  left join public.generations g on g.user_id = c.id
  group by c.cohort, c.id
), gen_distribution as (
  select cohort,
    count(*)::int as users,
    sum(generations)::int as total_generations,
    round(avg(generations)::numeric, 2) as avg_generations,
    percentile_disc(0.5) within group (order by generations)::int as median_generations,
    sum((generations = 0)::int)::int as users_0,
    sum((generations = 1)::int)::int as users_1,
    sum((generations = 2)::int)::int as users_2,
    sum((generations = 3)::int)::int as users_3,
    sum((generations between 4 and 9)::int)::int as users_4_9,
    sum((generations >= 10)::int)::int as users_10_plus
  from gen_counts
  group by cohort
), detail as (
  select 0 as section_order, 'summary'::text as section, 'all'::text as dimension_value,
    null::text as reason, null::text as source,
    jsonb_build_object(
      'banned_users_24h', coalesce((select sum(user_count) from banned_24h), 0),
      'autobans_7d', coalesce((select sum(user_count) from autoban_day), 0),
      'new_domain_blocks', coalesce((select sum(item_count) from learned where type = 'domain'), 0),
      'new_ip_blocks', coalesce((select sum(item_count) from learned where type = 'ip'), 0),
      'fresh_ring_candidates', (select count(*) from fresh_candidates),
      'fresh_ring_candidate_accounts', coalesce((select sum(signup_count) from fresh_candidates), 0),
      'fresh_ring_active', (select active_total from fresh_verdict),
      'fresh_ring_created_24h', (select created_in_window from fresh_verdict)
    ) as metrics
  union all
  select 1, 'new_block', type, reason, null,
    jsonb_build_object('count', item_count) from learned
  union all
  select 2, 'recent_block', type || ':' || value, reason, source,
    jsonb_build_object('count', 1, 'rank', rank) from recent_learned where rank <= 12
  union all
  select 3, 'maintenance', source, null, source,
    jsonb_build_object('count', item_count) from maintenance
  union all
  select 4, 'banned_reason_24h', reason, reason, null,
    jsonb_build_object('users', user_count) from banned_24h
  union all
  select 5, 'fresh_ring_candidate', ip, null, null,
    jsonb_build_object(
      'signup_count', signup_count,
      'distinct_domains', distinct_domains,
      'banned_count', banned_count,
      'fast_api_key_users', fast_api_key_users,
      'api_generation_users', api_generation_users
    ) from fresh_candidates
  union all
  select 6, 'fresh_ring_verdict', 'all', null, null,
    jsonb_build_object('active', active_total, 'created_24h', created_in_window)
    from fresh_verdict
  union all
  select 7, 'autoban_day_7d', day::text, null, null,
    jsonb_build_object('users', user_count) from autoban_day
  union all
  select 8, 'autoban_reason_7d', reason, reason, null,
    jsonb_build_object('users', user_count) from autoban_reason
  union all
  select 9, 'ban_generation_distribution_24h', cohort, null, null,
    jsonb_build_object(
      'users', users,
      'total_generations', total_generations,
      'avg_generations', avg_generations,
      'median_generations', median_generations,
      'users_0', users_0,
      'users_1', users_1,
      'users_2', users_2,
      'users_3', users_3,
      'users_4_9', users_4_9,
      'users_10_plus', users_10_plus
    ) from gen_distribution
)
select d.section, d.dimension_value, d.reason, d.source, d.metrics, c.data_through
from detail d cross join cutoff c
order by d.section_order, d.dimension_value$sql$,
  'table',
  '{"columns":["section","dimension_value","reason","source","metrics","data_through"]}'::jsonb,
  NULL,
  'atlas-abuse-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-abuse-tab-operations',
  (SELECT "id" FROM "dashboard" WHERE "number" = 5),
  2,
  'Operations',
  1,
  'atlas:abuse:operations'
)
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position",
  "x", "y", "width", "height", "visualization", "displaySettings",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-abuse-card-operational-rings',
    (SELECT "id" FROM "dashboard" WHERE "number" = 5),
    'atlas-abuse-tab-operations',
    'atlas-cron-question-abuse-detail',
    0, 0, 0, 24, 12, 'TABLE', '{"compact":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-abuse-card-enforcement-detail',
    (SELECT "id" FROM "dashboard" WHERE "number" = 5),
    'atlas-abuse-tab-operations',
    'atlas-abuse-question-enforcement-detail',
    1, 0, 12, 24, 14, 'TABLE', '{"compact":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE SET
  "dashboardId" = EXCLUDED."dashboardId",
  "tabId" = EXCLUDED."tabId",
  "questionId" = EXCLUDED."questionId",
  "position" = EXCLUDED."position",
  "x" = EXCLUDED."x",
  "y" = EXCLUDED."y",
  "width" = EXCLUDED."width",
  "height" = EXCLUDED."height",
  "visualization" = EXCLUDED."visualization",
  "displaySettings" = EXCLUDED."displaySettings",
  "updatedAt" = CURRENT_TIMESTAMP;
