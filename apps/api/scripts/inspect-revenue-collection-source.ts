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
    addMonths(toStartOfMonth(toTimeZone(now(), 'UTC')), -5) as start_at,
    toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
), invoice_states as (
  select
    id,
    argMax(
      status,
      tuple(
        amountPaid,
        multiIf(status = 'paid', 5, status = 'open', 4, status = 'uncollectible', 3, status = 'void', 2, 1),
        eventType
      )
    ) as invoice_status,
    max(amountDue) as amount_due_cents,
    max(amountPaid) as amount_paid_cents,
    greatest(max(amountDue) - max(amountPaid), 0) as amount_remaining_cents,
    any("organizationId") as organization_id,
    any("customerId") as customer_id,
    min(createdAt) as invoice_created_at
  from sync_prod.sync_stripe_invoices
  cross join bounds
  where createdAt >= bounds.start_at
    and createdAt < bounds.data_through
  group by id
), item_states as (
  select
    id,
    any("invoiceId") as invoice_id,
    argMax("priceType", tuple(createdAt, status, amount)) as price_type,
    max(amount) as amount_cents
  from sync_prod.sync_stripe_invoice_items
  cross join bounds
  where createdAt >= bounds.start_at
    and createdAt < bounds.data_through
  group by id
), invoice_type_lines as (
  select
    invoice_id,
    multiIf(
      price_type = 'licensed', 'subscription',
      price_type = 'metered', 'usage',
      'other'
    ) as revenue_type,
    sum(abs(amount_cents)) as line_amount_cents
  from item_states
  group by invoice_id, revenue_type
), invoice_type_weights as (
  select
    invoice_id,
    revenue_type,
    line_amount_cents,
    sum(line_amount_cents) over (partition by invoice_id) as invoice_line_total_cents
  from invoice_type_lines
), allocated as (
  select
    invoice_states.id as invoice_id,
    invoice_states.organization_id,
    invoice_states.customer_id,
    invoice_states.invoice_created_at,
    invoice_states.invoice_status,
    coalesce(invoice_type_weights.revenue_type, 'other') as revenue_type,
    if(
      invoice_type_weights.invoice_line_total_cents > 0,
      invoice_type_weights.line_amount_cents / invoice_type_weights.invoice_line_total_cents,
      1
    ) as allocation_share,
    invoice_states.amount_due_cents,
    invoice_states.amount_paid_cents,
    invoice_states.amount_remaining_cents
  from invoice_states
  left join invoice_type_weights on invoice_type_weights.invoice_id = invoice_states.id
)
select
  toStartOfMonth(toTimeZone(invoice_created_at, 'UTC')) as period_start,
  revenue_type,
  countDistinct(invoice_id) as invoices_with_type,
  round(sum(amount_due_cents * allocation_share) / 100.0, 2) as amount_due,
  round(sum(amount_paid_cents * allocation_share) / 100.0, 2) as amount_paid,
  round(sum(amount_remaining_cents * allocation_share) / 100.0, 2) as amount_uncollected,
  round(100 * amount_paid / nullIf(amount_due, 0), 2) as collection_rate_pct,
  bounds.data_through as data_through
from allocated
cross join bounds
where invoice_status in ('paid', 'open', 'uncollectible')
group by period_start, revenue_type, bounds.data_through
order by period_start, amount_due desc`,
});

process.stdout.write(
	`${JSON.stringify(
		{
			columns: result.columns.map((column) => column.name),
			rows: result.rows,
		},
		null,
		2,
	)}\n`,
);
