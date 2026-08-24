import type { StripeCustomerBillingCountryRow } from "./stripe-customer-billing-country";

const STRIPE_API_URL = "https://api.stripe.com/v1";
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30_000;

type StripeList = {
	data?: unknown;
	has_more?: unknown;
};

type ParsedStripeList = {
	data: unknown[];
	has_more: boolean;
};

type StripeCharge = {
	id?: unknown;
	created?: unknown;
	customer?: unknown;
	paid?: unknown;
	status?: unknown;
	billing_details?: {
		address?: { country?: unknown } | null;
	} | null;
};

type StripeInvoice = {
	id?: unknown;
	created?: unknown;
	customer?: unknown;
	customer_address?: { country?: unknown } | null;
	customer_shipping?: {
		address?: { country?: unknown } | null;
	} | null;
};

export type StripeBillingCountryPage = {
	rows: StripeCustomerBillingCountryRow[];
	processed: number;
	hasMore: boolean;
	nextCursor: string | null;
};

export type StripeBillingCountryPageInput = {
	startingAfter?: string | null;
	createdGte?: Date;
	createdLte?: Date;
	dataThrough: Date;
};

export class StripeBillingCountryClient {
	constructor(private readonly secretKey: string) {}

	async chargePage(
		input: StripeBillingCountryPageInput,
	): Promise<StripeBillingCountryPage> {
		return parseStripeChargeCountryPage(
			await this.page("charges", input),
			input.dataThrough,
		);
	}

	async invoicePage(
		input: StripeBillingCountryPageInput,
	): Promise<StripeBillingCountryPage> {
		return parseStripeInvoiceCountryPage(
			await this.page("invoices", input),
			input.dataThrough,
		);
	}

	private async page(
		resource: "charges" | "invoices",
		input: StripeBillingCountryPageInput,
	) {
		const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
		if (input.startingAfter) {
			query.set("starting_after", input.startingAfter);
		}
		if (input.createdGte) {
			query.set(
				"created[gte]",
				String(Math.floor(input.createdGte.getTime() / 1000)),
			);
		}
		if (input.createdLte) {
			query.set(
				"created[lte]",
				String(Math.floor(input.createdLte.getTime() / 1000)),
			);
		}

		const response = await fetch(`${STRIPE_API_URL}/${resource}?${query}`, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${this.secretKey}`,
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(
				`Stripe ${resource} request failed (${response.status}).`,
			);
		}

		return response.json();
	}
}

export function parseStripeChargeCountryPage(
	value: unknown,
	dataThrough: Date,
): StripeBillingCountryPage {
	const response = stripeList(value, "charge");
	const charges = response.data as StripeCharge[];
	const rows = charges.flatMap((charge) => {
		if (charge.paid !== true && charge.status !== "succeeded") return [];
		const stripeCustomerId = customerId(charge.customer);
		const countryCode = country(charge.billing_details?.address?.country);
		const sourceExternalId = externalId(charge.id, "ch_");
		const observedAt = stripeDate(charge.created);
		if (!stripeCustomerId || !countryCode || !sourceExternalId || !observedAt) {
			return [];
		}
		return [
			{
				stripeCustomerId,
				countryCode,
				evidenceKind: "SUCCESSFUL_CHARGE_BILLING" as const,
				sourceExternalId,
				observedAt,
				dataThrough,
			},
		];
	});

	return pageResult(response, charges, rows, "ch_");
}

export function parseStripeInvoiceCountryPage(
	value: unknown,
	dataThrough: Date,
): StripeBillingCountryPage {
	const response = stripeList(value, "invoice");
	const invoices = response.data as StripeInvoice[];
	const rows = invoices.flatMap((invoice) => {
		const stripeCustomerId = customerId(invoice.customer);
		const billingCountry = country(invoice.customer_address?.country);
		const shippingCountry = country(
			invoice.customer_shipping?.address?.country,
		);
		const sourceExternalId = externalId(invoice.id, "in_");
		const observedAt = stripeDate(invoice.created);
		if (
			!stripeCustomerId ||
			(!billingCountry && !shippingCountry) ||
			!sourceExternalId ||
			!observedAt
		) {
			return [];
		}
		return [
			{
				stripeCustomerId,
				countryCode: billingCountry ?? shippingCountry ?? "",
				evidenceKind: billingCountry
					? ("INVOICE_BILLING" as const)
					: ("INVOICE_SHIPPING" as const),
				sourceExternalId,
				observedAt,
				dataThrough,
			},
		];
	});

	return pageResult(response, invoices, rows, "in_");
}

function stripeList(value: unknown, resource: string): ParsedStripeList {
	const response = value as StripeList;
	if (!Array.isArray(response.data)) {
		throw new Error(`Stripe ${resource} response has no data array.`);
	}
	return {
		data: response.data,
		has_more: response.has_more === true,
	};
}

function pageResult<T extends { id?: unknown }>(
	response: ParsedStripeList,
	items: T[],
	rows: StripeCustomerBillingCountryRow[],
	prefix: "ch_" | "in_",
): StripeBillingCountryPage {
	return {
		rows,
		processed: items.length,
		hasMore: response.has_more,
		nextCursor: externalId(items.at(-1)?.id, prefix),
	};
}

function customerId(value: unknown): string | null {
	const id =
		typeof value === "string"
			? value
			: value &&
					typeof value === "object" &&
					"id" in value &&
					typeof value.id === "string"
				? value.id
				: null;
	return id && /^cus_[A-Za-z0-9]+$/.test(id) ? id : null;
}

function country(value: unknown): string | null {
	const code = String(value ?? "")
		.trim()
		.toUpperCase();
	return /^[A-Z]{2}$/.test(code) ? code : null;
}

function externalId(value: unknown, prefix: "ch_" | "in_"): string | null {
	const id = typeof value === "string" ? value : "";
	return id.startsWith(prefix) && /^[A-Za-z0-9_]+$/.test(id) ? id : null;
}

function stripeDate(value: unknown): Date | null {
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds > 0
		? new Date(seconds * 1000)
		: null;
}
