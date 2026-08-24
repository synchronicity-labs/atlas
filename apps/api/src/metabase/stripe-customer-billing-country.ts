import type { MetabaseResult } from "./metabase.client";

export const STRIPE_CUSTOMER_BILLING_COUNTRY_SOURCE_KEY =
	"stripe:billing-country";
export const STRIPE_CUSTOMER_BILLING_COUNTRY_SCOPE =
	"stripe-customer-billing-country";
export const STRIPE_CUSTOMER_BILLING_COUNTRY_CHARGE_SCOPE =
	"stripe-customer-billing-country-charges";
export const STRIPE_CUSTOMER_BILLING_COUNTRY_INVOICE_SCOPE =
	"stripe-customer-billing-country-invoices";
export const STRIPE_CUSTOMER_BILLING_COUNTRY_DATASET_KEY =
	"customer-billing-country";
export const STRIPE_CUSTOMER_BILLING_COUNTRY_BATCH_SIZE = 2_000;

export type StripeCustomerBillingCountryEvidenceKind =
	| "SUCCESSFUL_CHARGE_BILLING"
	| "INVOICE_BILLING"
	| "INVOICE_SHIPPING";

export type StripeCustomerBillingCountryRow = {
	stripeCustomerId: string;
	countryCode: string;
	evidenceKind: StripeCustomerBillingCountryEvidenceKind;
	sourceExternalId: string;
	observedAt: Date;
	dataThrough: Date;
};

const EVIDENCE_KINDS = new Set<StripeCustomerBillingCountryEvidenceKind>([
	"SUCCESSFUL_CHARGE_BILLING",
	"INVOICE_BILLING",
	"INVOICE_SHIPPING",
]);

export function stripeCustomerBillingCountryEvidencePriority(
	evidenceKind: StripeCustomerBillingCountryEvidenceKind,
): number {
	return evidenceKind === "SUCCESSFUL_CHARGE_BILLING" ? 2 : 1;
}

export function preferredStripeCustomerBillingCountryRow(
	left: StripeCustomerBillingCountryRow,
	right: StripeCustomerBillingCountryRow,
): StripeCustomerBillingCountryRow {
	const priorityDifference =
		stripeCustomerBillingCountryEvidencePriority(left.evidenceKind) -
		stripeCustomerBillingCountryEvidencePriority(right.evidenceKind);
	if (priorityDifference !== 0) return priorityDifference > 0 ? left : right;
	const timeDifference = left.observedAt.getTime() - right.observedAt.getTime();
	if (timeDifference !== 0) return timeDifference > 0 ? left : right;
	return left.sourceExternalId >= right.sourceExternalId ? left : right;
}

export function dedupeStripeCustomerBillingCountryRows(
	rows: StripeCustomerBillingCountryRow[],
): StripeCustomerBillingCountryRow[] {
	const selected = new Map<string, StripeCustomerBillingCountryRow>();
	for (const row of rows) {
		const current = selected.get(row.stripeCustomerId);
		selected.set(
			row.stripeCustomerId,
			current ? preferredStripeCustomerBillingCountryRow(current, row) : row,
		);
	}
	return [...selected.values()];
}

function sqlLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function dateValue(value: unknown, field: string): Date {
	const parsed = new Date(String(value));
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Stripe customer billing country has an invalid ${field}.`);
	}
	return parsed;
}

export function stripeCustomerBillingCountryQuery(
	cursor: string | null,
	limit: number,
): string {
	if (cursor && !/^cus_[A-Za-z0-9]+$/.test(cursor)) {
		throw new Error("Stripe customer billing country cursor is invalid.");
	}
	if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
		throw new Error("Stripe customer billing country batch size is invalid.");
	}

	return `with country_candidates as (
  select
    customerId as customer_id,
    upper(JSONExtractString(payload, 'billing_details', 'address', 'country')) as country_code,
    'SUCCESSFUL_CHARGE_BILLING' as evidence_kind,
    toString(id) as source_external_id,
    "createdAt" as observed_at,
    2 as source_priority
  from sync_prod.sync_stripe_payments
  where customerId != ''
    and lower(status) = 'succeeded'
    and JSONExtractString(payload, 'billing_details', 'address', 'country') != ''
  union all
  select
    customerId as customer_id,
    upper(coalesce(
      nullIf(JSONExtractString(payload, 'customer_address', 'country'), ''),
      nullIf(JSONExtractString(payload, 'customer_shipping', 'address', 'country'), ''),
      ''
    )) as country_code,
    if(
      JSONExtractString(payload, 'customer_address', 'country') != '',
      'INVOICE_BILLING',
      'INVOICE_SHIPPING'
    ) as evidence_kind,
    toString(id) as source_external_id,
    "createdAt" as observed_at,
    1 as source_priority
  from sync_prod.sync_stripe_invoices
  where customerId != ''
    and coalesce(
      nullIf(JSONExtractString(payload, 'customer_address', 'country'), ''),
      nullIf(JSONExtractString(payload, 'customer_shipping', 'address', 'country'), ''),
      ''
    ) != ''
), customer_country as (
  select
    customer_id,
    argMax(
      tuple(country_code, evidence_kind, source_external_id, observed_at),
      tuple(source_priority, observed_at, source_external_id)
    ) as selected
  from country_candidates
  group by customer_id
)
select
  customer_id,
  tupleElement(selected, 1) as country_code,
  tupleElement(selected, 2) as evidence_kind,
  tupleElement(selected, 3) as source_external_id,
  tupleElement(selected, 4) as observed_at,
  toStartOfMinute(toTimeZone(now(), 'UTC')) as data_through
from customer_country
where customer_id > ${sqlLiteral(cursor ?? "")}
order by customer_id
limit ${limit}`;
}

export function parseStripeCustomerBillingCountryResult(
	result: MetabaseResult,
): StripeCustomerBillingCountryRow[] {
	const columns = new Map(
		result.columns.map((column, index) => [column.name.toLowerCase(), index]),
	);
	const required = [
		"customer_id",
		"country_code",
		"evidence_kind",
		"source_external_id",
		"observed_at",
		"data_through",
	];
	for (const column of required) {
		if (!columns.has(column)) {
			throw new Error(
				`Stripe customer billing country result is missing ${column}.`,
			);
		}
	}

	return result.rows.map((values) => {
		const value = (column: string) => values[columns.get(column) ?? -1];
		const stripeCustomerId = String(value("customer_id") ?? "").trim();
		const countryCode = String(value("country_code") ?? "")
			.trim()
			.toUpperCase();
		const evidenceKind = String(
			value("evidence_kind") ?? "",
		).trim() as StripeCustomerBillingCountryEvidenceKind;
		const sourceExternalId = String(value("source_external_id") ?? "").trim();

		if (!/^cus_[A-Za-z0-9]+$/.test(stripeCustomerId)) {
			throw new Error(
				"Stripe customer billing country has an invalid customer ID.",
			);
		}
		if (!/^[A-Z]{2}$/.test(countryCode)) {
			throw new Error(
				"Stripe customer billing country has an invalid country code.",
			);
		}
		if (!EVIDENCE_KINDS.has(evidenceKind)) {
			throw new Error(
				"Stripe customer billing country has an invalid evidence kind.",
			);
		}
		if (!sourceExternalId) {
			throw new Error(
				"Stripe customer billing country has no source record ID.",
			);
		}

		return {
			stripeCustomerId,
			countryCode,
			evidenceKind,
			sourceExternalId,
			observedAt: dateValue(value("observed_at"), "observed time"),
			dataThrough: dateValue(value("data_through"), "data-through time"),
		};
	});
}
