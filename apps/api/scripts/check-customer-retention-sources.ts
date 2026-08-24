import { MetabaseClient } from "../src/metabase/metabase.client";
import { metabaseConfig } from "../src/metabase/metabase.config";

const config = metabaseConfig();
if (!config) throw new Error("Metabase is not configured.");

const client = new MetabaseClient(config);

const checks = {
	chargeAndPaymentTables: `select name from system.tables where database = 'sync_prod' and (lower(name) like '%charge%' or lower(name) like '%payment%') order by name`,
	stripePaymentsSchema: `describe table sync_prod.sync_stripe_payments`,
	stripePaymentPayloadKeys: `select key, count() as rows
from sync_prod.sync_stripe_payments
array join JSONExtractKeys(payload) as key
group by key
order by rows desc
limit 80`,
	stripePaymentCountryCoverage: `select
  countDistinct(id) as payments,
  countDistinctIf(id, billing_country != '') as payments_with_billing_country,
  countDistinctIf(customerId, billing_country != '') as customers_with_billing_country,
  countDistinctIf(billing_country, billing_country != '') as countries
from (
  select
    id,
    customerId,
    upper(coalesce(nullIf(JSONExtractString(payload, 'billing_details', 'address', 'country'), ''), '')) as billing_country
  from sync_prod.sync_stripe_payments
  where lower(status) = 'succeeded'
)`,
	stripeInvoiceActualCountryCoverage: `select
  countDistinct(id) as invoices,
  countDistinctIf(id, country != '') as invoices_with_country,
  countDistinctIf(customerId, country != '') as customers_with_country,
  countDistinctIf(country, country != '') as countries
from (
  select
    id,
    customerId,
    upper(coalesce(
      nullIf(JSONExtractString(payload, 'customer_address', 'country'), ''),
      nullIf(JSONExtractString(payload, 'customer_shipping', 'address', 'country'), ''),
      ''
    )) as country
  from sync_prod.sync_stripe_invoices
)`,
	customerTables: `select name from system.tables where database = 'sync_prod' and lower(name) like '%customer%' order by name`,
	subscriptionSchema: `describe table sync_prod.sync_stripe_subscriptions_with_plan`,
	paidInvoiceSchema: `describe table sync_prod.sync_stripe_invoices_paid`,
	invoiceSchema: `describe table sync_prod.sync_stripe_invoices`,
	invoiceItemSchema: `describe table sync_prod.sync_stripe_invoice_items`,
	paidCustomerMonthlyRevenueSchema: `describe table sync_prod.paid_customer_monthly_revenue`,
	paidCustomerMonthlyRevenueRange: `select
  min(month) as first_month,
  max(month) as latest_month,
  count() as rows,
  countDistinct(customer_id) as customers,
  countDistinct(plan) as plans
from sync_prod.paid_customer_monthly_revenue`,
	usageSchema: `describe table sync_prod.sync_usage3`,
	countryCoverage: `select
  countDistinct(id) as invoices,
  countDistinctIf(id, country != '') as invoices_with_country,
  countDistinctIf("organizationId", country != '') as organizations_with_country,
  countDistinctIf(country, country != '') as countries
from (
  select
    id,
    "organizationId",
    upper(coalesce(
      nullIf(JSONExtractString(payload, 'customer_address', 'country'), ''),
      nullIf(JSONExtractString(payload, 'customer_shipping', 'address', 'country'), ''),
      nullIf(JSONExtractString(payload, 'account_country'), ''),
      ''
    )) as country
  from sync_prod.sync_stripe_invoices
)`,
	cancellationJoin: `with created as (
  select
    subscriptionId,
    any("organizationId") as organization_id,
    any(customerId) as customer_id,
    any(orgPlan) as plan,
    min(createdAt) as created_at
  from sync_prod.sync_stripe_subscription_creation_invoices
  where subscriptionId is not null and subscriptionId != ''
  group by subscriptionId
), canceled as (
  select
    id as subscription_id,
    any("organizationId") as organization_id,
    any(customerId) as customer_id,
    any(orgPlan) as plan,
    max(coalesce(canceledAt, createdAt)) as canceled_at
  from sync_prod.sync_stripe_subscription_cancellations
  group by id
)
select
  count() as cancellation_records,
  countIf(created.subscriptionId is not null) as joined_to_creation,
  countIf(created.organization_id is not null and created.organization_id != '') as joined_with_organization,
  countIf(coalesce(created.plan, canceled.plan, '') != '') as rows_with_plan
from canceled
left join created on created.subscriptionId = canceled.subscription_id`,
	invoiceDedupe: `select
  count() as event_rows,
  countDistinct(id) as invoices,
  countDistinctIf("organizationId", "organizationId" != '') as organizations,
  countDistinctIf(customerId, customerId != '') as customers
from sync_prod.sync_stripe_invoices`,
	subscriptionCoverage: `select
  countDistinct(id) as subscriptions,
  countDistinctIf(id, "organizationId" != '') as subscriptions_with_organization,
  countDistinctIf(id, plan != '') as subscriptions_with_plan,
  countDistinctIf("organizationId", "organizationId" != '') as organizations,
  countDistinctIf(plan, plan != '') as plans
from sync_prod.sync_stripe_subscriptions_with_plan`,
	creationInvoiceCoverage: `select
  countDistinctIf(subscriptionId, subscriptionId is not null and subscriptionId != '') as subscriptions,
  countDistinctIf(subscriptionId, "organizationId" != '') as subscriptions_with_organization,
  countDistinctIf(subscriptionId, orgPlan != '') as subscriptions_with_plan,
  countDistinctIf("organizationId", "organizationId" != '') as organizations
from sync_prod.sync_stripe_subscription_creation_invoices`,
	subscriptionEventTypes: `select
  eventType,
  status,
  count() as rows,
  countDistinct(id) as subscriptions
from sync_prod.sync_stripe_subscriptions_with_plan
group by eventType, status
order by rows desc
limit 20`,
} as const;

const results: Record<string, unknown> = {};
for (const [name, queryText] of Object.entries(checks)) {
	const result = await client.preview({
		language: "SQL",
		queryText,
		databaseExternalId: "166",
	});
	results[name] = {
		columns: result.columns.map((column) => column.name),
		rows: result.rows,
	};
}

console.log(JSON.stringify(results, null, 2));
