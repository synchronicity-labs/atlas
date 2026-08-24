import { describe, expect, test } from "bun:test";
import {
	parseStripeChargeCountryPage,
	parseStripeInvoiceCountryPage,
} from "./stripe-charge-country.client";

describe("Stripe charge country client", () => {
	test("uses the billing country from successful charges", () => {
		const dataThrough = new Date("2026-08-24T20:00:00.000Z");
		const page = parseStripeChargeCountryPage(
			{
				data: [
					{
						id: "ch_newest",
						created: 1_777_000_000,
						customer: "cus_customer1",
						paid: true,
						status: "succeeded",
						billing_details: { address: { country: "us" } },
					},
				],
				has_more: true,
			},
			dataThrough,
		);

		expect(page).toEqual({
			rows: [
				{
					stripeCustomerId: "cus_customer1",
					countryCode: "US",
					evidenceKind: "SUCCESSFUL_CHARGE_BILLING",
					sourceExternalId: "ch_newest",
					observedAt: new Date(1_777_000_000_000),
					dataThrough,
				},
			],
			processed: 1,
			hasMore: true,
			nextCursor: "ch_newest",
		});
	});

	test("skips failed, customerless, and countryless charges", () => {
		const page = parseStripeChargeCountryPage(
			{
				data: [
					{
						id: "ch_failed",
						created: 1_777_000_000,
						customer: "cus_customer1",
						paid: false,
						status: "failed",
						billing_details: { address: { country: "US" } },
					},
					{
						id: "ch_nocountry",
						created: 1_777_000_001,
						customer: "cus_customer2",
						paid: true,
						status: "succeeded",
						billing_details: { address: { country: null } },
					},
				],
				has_more: false,
			},
			new Date("2026-08-24T20:00:00.000Z"),
		);

		expect(page.rows).toEqual([]);
		expect(page.processed).toBe(2);
		expect(page.nextCursor).toBe("ch_nocountry");
	});
});

describe("Stripe invoice country client", () => {
	test("prefers invoice billing country over shipping country", () => {
		const dataThrough = new Date("2026-08-24T20:00:00.000Z");
		const page = parseStripeInvoiceCountryPage(
			{
				data: [
					{
						id: "in_invoice1",
						created: 1_777_000_000,
						customer: "cus_customer1",
						customer_address: { country: "gb" },
						customer_shipping: { address: { country: "us" } },
					},
				],
				has_more: true,
			},
			dataThrough,
		);

		expect(page).toEqual({
			rows: [
				{
					stripeCustomerId: "cus_customer1",
					countryCode: "GB",
					evidenceKind: "INVOICE_BILLING",
					sourceExternalId: "in_invoice1",
					observedAt: new Date(1_777_000_000_000),
					dataThrough,
				},
			],
			processed: 1,
			hasMore: true,
			nextCursor: "in_invoice1",
		});
	});

	test("uses invoice shipping country as the fallback", () => {
		const dataThrough = new Date("2026-08-24T20:00:00.000Z");
		const page = parseStripeInvoiceCountryPage(
			{
				data: [
					{
						id: "in_shipping",
						created: 1_777_000_000,
						customer: { id: "cus_customer2" },
						customer_address: null,
						customer_shipping: { address: { country: "ca" } },
					},
					{
						id: "in_countryless",
						created: 1_777_000_001,
						customer: "cus_customer3",
					},
				],
				has_more: false,
			},
			dataThrough,
		);

		expect(page.rows).toEqual([
			{
				stripeCustomerId: "cus_customer2",
				countryCode: "CA",
				evidenceKind: "INVOICE_SHIPPING",
				sourceExternalId: "in_shipping",
				observedAt: new Date(1_777_000_000_000),
				dataThrough,
			},
		]);
		expect(page.processed).toBe(2);
		expect(page.nextCursor).toBe("in_countryless");
	});
});
