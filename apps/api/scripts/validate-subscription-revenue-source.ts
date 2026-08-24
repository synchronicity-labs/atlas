import { MetabaseClient } from "../src/metabase/metabase.client";
import { metabaseConfig } from "../src/metabase/metabase.config";

const config = metabaseConfig();
if (!config) throw new Error("Metabase is not configured.");

const client = new MetabaseClient(config);
const result = await client.preview({
	language: "SQL",
	databaseExternalId: "166",
queryText: `with bounds as (
  select
    toStartOfMonth(toTimeZone(now(), 'UTC')) as month_start,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), latest_subscription_payloads as (
  select
    id,
    argMax(
      organizationId,
      tuple(currentPeriodEnd, currentPeriodStart, createdAt, eventType)
    ) as organization_id,
    argMax(
      payload,
      tuple(currentPeriodEnd, currentPeriodStart, createdAt, eventType)
    ) as payload
  from sync_prod.sync_stripe_subscriptions
  cross join bounds
  where createdAt < bounds.data_through
  group by id
), latest_subscription_states as (
  select
    id,
    argMax(
      plan,
      tuple(currentPeriodEnd, currentPeriodStart, createdAt, eventType)
    ) as plan,
    argMax(
      status,
      tuple(currentPeriodEnd, currentPeriodStart, createdAt, eventType)
    ) as subscription_status
  from sync_prod.sync_stripe_subscriptions_with_plan
  cross join bounds
  where createdAt < bounds.data_through
  group by id
), licensed_items as (
  select
    latest_subscription_payloads.id,
    latest_subscription_payloads.organization_id,
    latest_subscription_states.subscription_status as status,
    latest_subscription_states.plan,
    arrayJoin(JSONExtractArrayRaw(latest_subscription_payloads.payload, 'items', 'data')) as item
  from latest_subscription_payloads
  inner join latest_subscription_states using (id)
  where latest_subscription_states.subscription_status in ('active', 'past_due')
)
select
  bounds.month_start as period_start,
  status,
  plan,
  countDistinctIf(id, JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed') as licensed_subscriptions,
  countDistinctIf(organization_id, JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed') as organizations,
  round(sumIf(
    JSONExtractInt(item, 'price', 'unit_amount')
      * greatest(JSONExtractInt(item, 'quantity'), 1)
      / 100.0
      / if(
        JSONExtractString(item, 'price', 'recurring', 'interval') = 'year',
        12 * greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1),
        greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1)
      ),
    JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed'
  ), 2) as monthly_value,
  bounds.data_through as period_end,
  bounds.data_through as data_through
from licensed_items
cross join bounds
group by bounds.month_start, bounds.data_through, status, plan
order by status, monthly_value desc`,
});

console.log(
	JSON.stringify(
		{
			columns: result.columns.map((column) => column.name),
			rows: result.rows,
		},
		null,
		2,
	),
);
