import { describe, expect, test } from "bun:test";
import {
	dedupeStripeCustomerBillingCountryRows,
	parseStripeCustomerBillingCountryResult,
	stripeCustomerBillingCountryQuery,
} from "./stripe-customer-billing-country";

describe("stripe customer billing country", () => {
	test("uses successful charges before the latest invoice fallback", () => {
		const query = stripeCustomerBillingCountryQuery("cus_abc123", 500);

		expect(query).toContain("sync_prod.sync_stripe_payments");
		expect(query).toContain("lower(status) = 'succeeded'");
		expect(query).toContain("'SUCCESSFUL_CHARGE_BILLING'");
		expect(query).toContain("sync_prod.sync_stripe_invoices");
		expect(query).toContain("'INVOICE_BILLING'");
		expect(query).toContain("'INVOICE_SHIPPING'");
		expect(query).toContain("tuple(source_priority, observed_at");
		expect(query).toContain("where customer_id > 'cus_abc123'");
		expect(query).toContain("limit 500");
	});

	test("rejects an unsafe cursor", () => {
		expect(() =>
			stripeCustomerBillingCountryQuery("cus_bad'; drop table x", 500),
		).toThrow("cursor is invalid");
	});

	test("parses a canonical country row", () => {
		const rows = parseStripeCustomerBillingCountryResult({
			columns: [
				{ name: "customer_id", displayName: null, baseType: null },
				{ name: "country_code", displayName: null, baseType: null },
				{ name: "evidence_kind", displayName: null, baseType: null },
				{ name: "source_external_id", displayName: null, baseType: null },
				{ name: "observed_at", displayName: null, baseType: null },
				{ name: "data_through", displayName: null, baseType: null },
			],
			rows: [
				[
					"cus_abc123",
					"us",
					"SUCCESSFUL_CHARGE_BILLING",
					"ch_123",
					"2026-08-24T12:00:00.000Z",
					"2026-08-24T12:05:00.000Z",
				],
			],
		});

		expect(rows).toEqual([
			{
				stripeCustomerId: "cus_abc123",
				countryCode: "US",
				evidenceKind: "SUCCESSFUL_CHARGE_BILLING",
				sourceExternalId: "ch_123",
				observedAt: new Date("2026-08-24T12:00:00.000Z"),
				dataThrough: new Date("2026-08-24T12:05:00.000Z"),
			},
		]);
	});

	test("rejects malformed source data", () => {
		expect(() =>
			parseStripeCustomerBillingCountryResult({
				columns: [
					{ name: "customer_id", displayName: null, baseType: null },
					{ name: "country_code", displayName: null, baseType: null },
					{ name: "evidence_kind", displayName: null, baseType: null },
					{ name: "source_external_id", displayName: null, baseType: null },
					{ name: "observed_at", displayName: null, baseType: null },
					{ name: "data_through", displayName: null, baseType: null },
				],
				rows: [
					[
						"cus_abc123",
						"USA",
						"UNKNOWN",
						"ch_123",
						"not-a-date",
						"not-a-date",
					],
				],
			}),
		).toThrow("invalid country code");
	});

	test("keeps successful charge evidence ahead of newer invoice fallbacks", () => {
		const dataThrough = new Date("2026-08-24T20:00:00.000Z");
		const rows = dedupeStripeCustomerBillingCountryRows([
			{
				stripeCustomerId: "cus_abc123",
				countryCode: "US",
				evidenceKind: "SUCCESSFUL_CHARGE_BILLING",
				sourceExternalId: "ch_123",
				observedAt: new Date("2026-08-20T12:00:00.000Z"),
				dataThrough,
			},
			{
				stripeCustomerId: "cus_abc123",
				countryCode: "CA",
				evidenceKind: "INVOICE_BILLING",
				sourceExternalId: "in_456",
				observedAt: new Date("2026-08-24T12:00:00.000Z"),
				dataThrough,
			},
		]);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.countryCode).toBe("US");
		expect(rows[0]?.evidenceKind).toBe("SUCCESSFUL_CHARGE_BILLING");
	});
});
