INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-studio-product-source',
  'atlas:studio-product',
  'ATLAS',
  'PostHog Studio delivery and subscription events',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "question"
SET
  "name" = 'Weekly Studio delivery and logo movement',
  "description" = 'Complete Monday-Sunday UTC Studio product periods. It reports generated hours after excluding Premiere-plugin activity, unique subscription-created events, and organization-deduplicated new, expanded, churned, and net logo movement. Activation speed, conversion cohorts, retention, and booked commitments remain separate governed questions.',
  "connector" = 'ATLAS',
  "sourceId" = (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:studio-product'),
  "sourceExternalId" = 'cron:studio:period-kpis',
  "sourceDashboardExternalId" = 'atlas:studio-product:delivery',
  "databaseExternalId" = NULL,
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-cron-question-studio-period-pack';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-cron-question-studio-period-pack-v2',
  'atlas-cron-question-studio-period-pack',
  2,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'posthog',
    'personPolicy', 'exclude_banned_product_users',
    'query', $hog$select
  toStartOfWeek(toTimeZone(timestamp, 'UTC')) as period_start,
  round(
    sumIf(
      toFloatOrZero(toString(properties.output_duration_secs)),
      event = 'playground_completed_generation'
        and coalesce(toString(properties.source), '') != 'plugin_premiere'
    ) / 3600,
    2
  ) as generated_hours,
  uniqExactIf(uuid, event = 'subscription_created') as new_subscriptions,
  uniqExactIf(
    toString(properties.organization_id),
    event = 'subscription_created'
      and nullIf(toString(properties.organization_id), '') is not null
  ) as new_logos,
  uniqExactIf(
    toString(properties.organization_id),
    event = 'subscription_updated'
      and nullIf(toString(properties.organization_id), '') is not null
      and indexOf(
        ['hobbyist', 'creator', 'growth', 'scale'],
        toString(properties.old_plan)
      ) > 0
      and indexOf(
        ['hobbyist', 'creator', 'growth', 'scale'],
        toString(properties.plan)
      ) > indexOf(
        ['hobbyist', 'creator', 'growth', 'scale'],
        toString(properties.old_plan)
      )
  ) as expanded_logos,
  uniqExactIf(
    toString(properties.organization_id),
    event = 'subscription_canceled'
      and nullIf(toString(properties.organization_id), '') is not null
  ) as churned_logos,
  new_logos + expanded_logos - churned_logos as net_logo_growth,
  toDateTime(
    toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
    'UTC'
  ) as data_through
from events
where event in (
    'playground_completed_generation',
    'subscription_created',
    'subscription_updated',
    'subscription_canceled'
  )
  and toTimeZone(timestamp, 'UTC') >= toDateTime(
    toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
    'UTC'
  ) - interval 18 week
  and toTimeZone(timestamp, 'UTC') < toDateTime(
    toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
    'UTC'
  )
  and {{atlas_product_user_eligible}}
group by period_start
order by period_start
limit 100$hog$
  )),
  'table',
  '{"columns":["period_start","generated_hours","new_subscriptions","new_logos","expanded_logos","churned_logos","net_logo_growth","data_through"]}'::jsonb,
  NULL,
  'atlas-studio-product-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "question" (
  "id", "number", "publicNumber", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "purpose", "status",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-studio-question-monthly-delivery',
  7041,
  271,
  'Monthly Studio delivery and logo movement',
  'Complete UTC calendar months for Studio product delivery and subscription movement. It uses the same generated-hour, clean-user, plan-order, and organization-deduplication rules as the weekly question.',
  'ATLAS',
  (SELECT "id" FROM "dataSource" WHERE "key" = 'atlas:studio-product'),
  'cron:studio:monthly-period-kpis',
  'atlas:studio-product:delivery',
  'RECONCILIATION',
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "connector" = EXCLUDED."connector",
  "sourceId" = EXCLUDED."sourceId",
  "sourceExternalId" = EXCLUDED."sourceExternalId",
  "sourceDashboardExternalId" = EXCLUDED."sourceDashboardExternalId",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-studio-question-monthly-delivery-v1',
  (SELECT "id" FROM "question" WHERE "number" = 7041),
  1,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'posthog',
    'personPolicy', 'exclude_banned_product_users',
    'query', $hog$select
  toStartOfMonth(toTimeZone(timestamp, 'UTC')) as period_start,
  round(
    sumIf(
      toFloatOrZero(toString(properties.output_duration_secs)),
      event = 'playground_completed_generation'
        and coalesce(toString(properties.source), '') != 'plugin_premiere'
    ) / 3600,
    2
  ) as generated_hours,
  uniqExactIf(uuid, event = 'subscription_created') as new_subscriptions,
  uniqExactIf(
    toString(properties.organization_id),
    event = 'subscription_created'
      and nullIf(toString(properties.organization_id), '') is not null
  ) as new_logos,
  uniqExactIf(
    toString(properties.organization_id),
    event = 'subscription_updated'
      and nullIf(toString(properties.organization_id), '') is not null
      and indexOf(
        ['hobbyist', 'creator', 'growth', 'scale'],
        toString(properties.old_plan)
      ) > 0
      and indexOf(
        ['hobbyist', 'creator', 'growth', 'scale'],
        toString(properties.plan)
      ) > indexOf(
        ['hobbyist', 'creator', 'growth', 'scale'],
        toString(properties.old_plan)
      )
  ) as expanded_logos,
  uniqExactIf(
    toString(properties.organization_id),
    event = 'subscription_canceled'
      and nullIf(toString(properties.organization_id), '') is not null
  ) as churned_logos,
  new_logos + expanded_logos - churned_logos as net_logo_growth,
  toDateTime(
    toUnixTimestamp(toStartOfMonth(toTimeZone(now(), 'UTC'))),
    'UTC'
  ) as data_through
from events
where event in (
    'playground_completed_generation',
    'subscription_created',
    'subscription_updated',
    'subscription_canceled'
  )
  and toTimeZone(timestamp, 'UTC') >= toDateTime(
    toUnixTimestamp(toStartOfMonth(toTimeZone(now(), 'UTC'))),
    'UTC'
  ) - interval 6 month
  and toTimeZone(timestamp, 'UTC') < toDateTime(
    toUnixTimestamp(toStartOfMonth(toTimeZone(now(), 'UTC'))),
    'UTC'
  )
  and {{atlas_product_user_eligible}}
group by period_start
order by period_start
limit 100$hog$
  )),
  'table',
  '{"columns":["period_start","generated_hours","new_subscriptions","new_logos","expanded_logos","churned_logos","net_logo_growth","data_through"]}'::jsonb,
  NULL,
  'atlas-studio-product-registry',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboard" (
  "id", "number", "name", "description", "layoutVersion", "createdBy",
  "createdAt", "updatedAt"
) VALUES (
  'atlas-studio-product-dashboard',
  11,
  'Studio product delivery',
  'Governed Studio delivery, activation, conversion, retention, and subscription movement metrics.',
  1,
  'atlas',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
) VALUES (
  'atlas-studio-product-tab-delivery',
  (SELECT "id" FROM "dashboard" WHERE "number" = 11),
  1,
  'Delivery and logo movement',
  0,
  'atlas:studio-product:delivery'
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
    'atlas-studio-product-card-weekly',
    (SELECT "id" FROM "dashboard" WHERE "number" = 11),
    (
      SELECT "id" FROM "dashboardTab"
      WHERE "dashboardId" = (SELECT "id" FROM "dashboard" WHERE "number" = 11)
        AND "number" = 1
    ),
    'atlas-cron-question-studio-period-pack',
    0, 0, 0, 12, 10, 'TABLE', '{"compact":true}'::jsonb,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-studio-product-card-monthly',
    (SELECT "id" FROM "dashboard" WHERE "number" = 11),
    (
      SELECT "id" FROM "dashboardTab"
      WHERE "dashboardId" = (SELECT "id" FROM "dashboard" WHERE "number" = 11)
        AND "number" = 1
    ),
    (SELECT "id" FROM "question" WHERE "number" = 7041),
    1, 12, 0, 12, 10, 'TABLE', '{"compact":true}'::jsonb,
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
