INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-abuse-source', 'atlas:abuse', 'ATLAS',
  'Product database and PostHog protection events', 'STALE',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-abuse-dashboard', 5, 'Abuse & signup protection',
  'Blocked signup attempts and product-account bans kept separate, versioned, and attributable to their canonical source.',
  1, 'atlas', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-abuse-tab-overview', 'atlas-abuse-dashboard', 1, 'Overview', 0, 'atlas:abuse:overview'
);

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "createdAt", "updatedAt"
) VALUES
  ('atlas-abuse-question-blocked-mtd', 4001, 'Blocked signup attempts MTD', 'PostHog signup_blocked events in the current UTC month. These are attempts rejected before an account exists and are not filtered through product-user eligibility.', 'ATLAS', 'atlas-abuse-source', 'abuse:signup-blocked:mtd', 'atlas:abuse:overview', NULL, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-question-block-rate', 4002, 'Signup block rate MTD', 'Blocked signup attempts divided by blocked attempts plus observed successful user_signed_up events in the current UTC month. Both sides come from PostHog.', 'ATLAS', 'atlas-abuse-source', 'abuse:signup-block-rate:mtd', 'atlas:abuse:overview', NULL, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-question-currently-banned', 4003, 'Currently banned accounts', 'Current product accounts with auth.users.banned = true. This is a state count, not a count of ban events.', 'METABASE', 'atlas-abuse-source', 'abuse:users:currently-banned', 'atlas:abuse:overview', '34', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-question-blocked-history', 4004, 'Signup blocks & successful signups', 'Daily PostHog event counts for signup_blocked and user_signed_up over the last 180 days, plus the attempt-level block rate.', 'ATLAS', 'atlas-abuse-source', 'abuse:signup-blocked:daily', 'atlas:abuse:overview', NULL, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-question-banned-history', 4005, 'Accounts marked banned over time', 'Daily count of currently banned accounts grouped by auth.users.updated_at over the last 180 days. This is the Sync Tracker v1 proxy because the source has no durable banned_at event.', 'METABASE', 'atlas-abuse-source', 'abuse:users:banned-updated-at-proxy', 'atlas:abuse:overview', '34', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-question-block-reasons', 4006, 'Signup block reasons', 'PostHog signup_blocked attempts by recorded reason during the last 90 days.', 'ATLAS', 'atlas-abuse-source', 'abuse:signup-blocked:reasons', 'atlas:abuse:overview', NULL, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-question-ban-reasons', 4007, 'Recent ban reasons', 'Currently banned product accounts updated in the last 30 days, grouped by the stored ban reason. Updated time is a proxy for ban time.', 'METABASE', 'atlas-abuse-source', 'abuse:users:ban-reasons', 'atlas:abuse:overview', '34', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "createdBy", "createdAt"
) VALUES
  ('atlas-abuse-version-blocked-mtd-v1', 'atlas-abuse-question-blocked-mtd', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'personPolicy', 'all_events', 'query', $hog$select count() as blocked_attempts
from events
where event = 'signup_blocked'
  and timestamp >= toStartOfMonth(now())$hog$)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-abuse-version-block-rate-v1', 'atlas-abuse-question-block-rate', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'personPolicy', 'all_events', 'query', $hog$select round(blocked_attempts / nullIf(blocked_attempts + successful_signups, 0) * 100, 2) as block_rate_pct
from (
  select
    countIf(event = 'signup_blocked') as blocked_attempts,
    countIf(event = 'user_signed_up') as successful_signups
  from events
  where event in ('signup_blocked', 'user_signed_up')
    and timestamp >= toStartOfMonth(now())
)$hog$)), 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-abuse-version-currently-banned-v1', 'atlas-abuse-question-currently-banned', 1, 'SQL', $sql$select count(*)::integer as currently_banned_accounts
from auth.users
where banned is true$sql$, 'smartscalar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-abuse-version-blocked-history-v1', 'atlas-abuse-question-blocked-history', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'personPolicy', 'all_events', 'query', $hog$select
  day,
  blocked_attempts,
  successful_signups,
  round(blocked_attempts / nullIf(blocked_attempts + successful_signups, 0) * 100, 2) as block_rate_pct
from (
  select
    toStartOfDay(timestamp) as day,
    countIf(event = 'signup_blocked') as blocked_attempts,
    countIf(event = 'user_signed_up') as successful_signups
  from events
  where event in ('signup_blocked', 'user_signed_up')
    and timestamp >= toStartOfDay(now()) - interval 180 day
  group by day
)
order by day$hog$)), 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-abuse-version-banned-history-v1', 'atlas-abuse-question-banned-history', 1, 'SQL', $sql$select
  date_trunc('day', updated_at)::date as day,
  count(*)::integer as accounts_marked_banned
from auth.users
where banned is true
  and updated_at >= current_date - interval '180 days'
group by 1
order by 1$sql$, 'line', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-abuse-version-block-reasons-v1', 'atlas-abuse-question-block-reasons', 1, 'API', jsonb_pretty(jsonb_build_object('source', 'posthog', 'personPolicy', 'all_events', 'query', $hog$select
  coalesce(nullIf(toString(properties.reason), ''), 'unknown') as reason,
  count() as blocked_attempts
from events
where event = 'signup_blocked'
  and timestamp >= now() - interval 90 day
group by reason
order by blocked_attempts desc$hog$)), 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP),
  ('atlas-abuse-version-ban-reasons-v1', 'atlas-abuse-question-ban-reasons', 1, 'SQL', $sql$select
  coalesce(nullif(btrim(ban_reason), ''), '(none)') as ban_reason,
  count(*)::integer as banned_accounts
from auth.users
where banned is true
  and updated_at >= current_date - interval '30 days'
group by 1
order by 2 desc$sql$, 'bar', '{}'::jsonb, 'atlas', CURRENT_TIMESTAMP);

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
) VALUES
  ('atlas-abuse-card-blocked-mtd', 'atlas-abuse-dashboard', 'atlas-abuse-tab-overview', 'atlas-abuse-question-blocked-mtd', 0, 0, 0, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-card-block-rate', 'atlas-abuse-dashboard', 'atlas-abuse-tab-overview', 'atlas-abuse-question-block-rate', 1, 8, 0, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-card-currently-banned', 'atlas-abuse-dashboard', 'atlas-abuse-tab-overview', 'atlas-abuse-question-currently-banned', 2, 16, 0, 8, 5, 'NUMBER', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-card-blocked-history', 'atlas-abuse-dashboard', 'atlas-abuse-tab-overview', 'atlas-abuse-question-blocked-history', 3, 0, 5, 12, 9, 'LINE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-card-banned-history', 'atlas-abuse-dashboard', 'atlas-abuse-tab-overview', 'atlas-abuse-question-banned-history', 4, 12, 5, 12, 9, 'LINE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-card-block-reasons', 'atlas-abuse-dashboard', 'atlas-abuse-tab-overview', 'atlas-abuse-question-block-reasons', 5, 0, 14, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('atlas-abuse-card-ban-reasons', 'atlas-abuse-dashboard', 'atlas-abuse-tab-overview', 'atlas-abuse-question-ban-reasons', 6, 12, 14, 12, 8, 'BAR', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
