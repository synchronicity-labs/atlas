import { describe, expect, it } from "bun:test";
import {
	commercialFindingDrafts,
	contractCommercialBaseline,
	contractFramePrices,
	type ReconciliationDocument,
} from "../agent/lib/contracts-reconciliation";

function document(
	parsed: ReconciliationDocument["parsed"],
): ReconciliationDocument {
	return {
		sourceRecordId: "contract_1",
		name: "Order Form",
		sourceUpdatedAt: new Date("2026-01-01T00:00:00Z"),
		parsed,
	};
}

describe("contract reconciliation", () => {
	it("monthlyizes the latest annual commitment", () => {
		const baseline = contractCommercialBaseline([
			document({
				documentType: "ORDER_FORM",
				effectiveDate: "2026-01-01",
				currency: "USD",
				annualCommitmentAmountMinor: 1_200_000,
			}),
		]);
		expect(baseline?.monthlyAmountMinor).toBe(100_000);
		expect(baseline?.basis).toBe("annual commitment");
	});

	it("extracts a per-frame price in Product millicents", () => {
		const prices = contractFramePrices([
			document({
				currency: "USD",
				commercialTerms: [
					{
						label: "Synced ADR per frame",
						amountMinor: 35,
						currency: "USD",
						evidenceQuote: "$0.35 per frame",
					},
				],
			}),
		]);
		expect(prices[0]?.amountMillicents).toBe(35_000);
	});

	it("keeps sub-cent frame prices at millicent precision", () => {
		const prices = contractFramePrices([
			document({
				commercialTerms: [
					{
						label: "Per frame",
						amountMillicents: 500,
						currency: "USD",
						evidenceQuote: "$0.005 per frame",
					},
				],
			}),
		]);
		expect(prices[0]?.amountMillicents).toBe(500);
	});

	it("recovers a sub-cent frame price from the evidence quote", () => {
		const prices = contractFramePrices([
			document({
				commercialTerms: [
					{
						label: "Per frame",
						currency: "USD",
						evidenceQuote: "$0.005 per frame",
					},
				],
			}),
		]);
		expect(prices[0]?.amountMillicents).toBe(500);
	});

	it("uses the amount beside per frame instead of another amount", () => {
		const prices = contractFramePrices([
			document({
				commercialTerms: [
					{
						label: "Annual usage fee",
						amountMinor: 5_000_000,
						currency: "USD",
						evidenceQuote: "lipsync-2 | $0.0008/frame | Up to $50,000 annually",
					},
				],
			}),
		]);
		expect(prices[0]?.amountMillicents).toBe(80);
	});

	it("uses the quoted frame price when the structured amount is per minute", () => {
		const prices = contractFramePrices([
			document({
				commercialTerms: [
					{
						label: "lipsync-2 rate",
						amountMillicents: 60_000,
						currency: "USD",
						unit: "MINUTE",
						evidenceQuote: "$0.60/min ($0.0004/frame at 25fps)",
					},
				],
			}),
		]);
		expect(prices[0]?.amountMillicents).toBe(40);
	});

	it("uses the last stated frame price when a discount follows list price", () => {
		const prices = contractFramePrices([
			document({
				commercialTerms: [
					{
						label: "lipsync-3 usage rate",
						amountMinor: 0,
						currency: "USD",
						evidenceQuote:
							"$0.00533/frame or $8/min, 50% off, $0.00266/frame or $4/min",
					},
				],
			}),
		]);
		expect(prices[0]?.amountMillicents).toBe(266);
	});

	it("flags both a frame mismatch and a possible missing addendum", () => {
		const framePrices = contractFramePrices([
			document({
				effectiveDate: "2026-01-01",
				currency: "USD",
				commercialTerms: [
					{
						label: "Per frame",
						amountMinor: 35,
						currency: "USD",
						evidenceQuote: "$0.35 per frame",
					},
				],
			}),
		]);
		const findings = commercialFindingDrafts({
			customerId: "customer_1",
			customerName: "Customer",
			productOrganizationId: "product_1",
			productOrganizationExternalId: "org_1",
			productOrganizationName: "Customer",
			baseline: null,
			framePrices,
			activity: {
				organizationId: "org_1",
				stripeCustomerId: "cus_1",
				stripeSubscriptionId: null,
				subscription: null,
				invoices: null,
				usage: {
					organization_id: "org_1",
					last_usage_at: "2026-08-01T00:00:00Z",
					usage_30d_usd: 100,
					usage_365d_usd: 200,
					current_cost_per_frame_millicents: 25_000,
					recent_costs_per_frame_millicents: [25_000],
				},
			},
		});
		expect(findings.map((finding) => finding.kind)).toEqual([
			"PRICE_MISMATCH",
			"POSSIBLE_MISSING_ADDENDUM",
		]);
	});

	it("flags a verified Product organization without a Stripe customer ID", () => {
		const findings = commercialFindingDrafts({
			customerId: "customer_1",
			customerName: "Customer",
			productOrganizationId: "product_1",
			productOrganizationExternalId: "org_1",
			productOrganizationName: "Customer",
			baseline: null,
			framePrices: [],
			activity: {
				organizationId: "org_1",
				stripeCustomerId: null,
				stripeSubscriptionId: null,
				subscription: null,
				invoices: null,
				usage: null,
			},
		});

		expect(findings).toHaveLength(1);
		expect(findings[0]?.kind).toBe("NO_STRIPE_ACCOUNT");
	});

	it("does not compare a contract commitment with the Stripe base license", () => {
		const baseline = contractCommercialBaseline([
			document({
				documentType: "ORDER_FORM",
				effectiveDate: "2026-01-01",
				serviceEndDate: "2027-01-01",
				currency: "USD",
				annualCommitmentAmountMinor: 1_200_000,
			}),
		]);
		const findings = commercialFindingDrafts({
			customerId: "customer_1",
			customerName: "Customer",
			productOrganizationId: "product_1",
			productOrganizationExternalId: "org_1",
			productOrganizationName: "Customer",
			baseline,
			framePrices: [],
			activity: {
				organizationId: "org_1",
				stripeCustomerId: "cus_1",
				stripeSubscriptionId: "sub_1",
				subscription: {
					organization_id: "org_1",
					customer_id: "cus_1",
					subscription_id: "sub_1",
					subscription_status: "active",
					plan: "enterprise",
					monthly_licensed_usd: 5,
					subscription_observed_at: "2026-08-01T00:00:00Z",
				},
				invoices: null,
				usage: {
					organization_id: "org_1",
					last_usage_at: "2026-08-01T00:00:00Z",
					usage_30d_usd: 1_000,
					usage_365d_usd: 10_000,
					current_cost_per_frame_millicents: null,
					recent_costs_per_frame_millicents: [],
				},
			},
		});

		expect(findings).toEqual([]);
	});

	it("flags old unpaid invoices with no recent usage as critical", () => {
		const findings = commercialFindingDrafts({
			customerId: "customer_1",
			customerName: "Customer",
			productOrganizationId: "product_1",
			productOrganizationExternalId: "org_1",
			productOrganizationName: "Customer",
			baseline: null,
			framePrices: [],
			activity: {
				organizationId: "org_1",
				stripeCustomerId: "cus_1",
				stripeSubscriptionId: null,
				subscription: null,
				invoices: {
					organization_id: "org_1",
					last_invoice_at: "2026-08-01T00:00:00Z",
					latest_invoice_amount_due_usd: 250,
					invoices_due_30d_usd: 250,
					invoices_due_365d_usd: 1_500,
					invoices_paid_365d_usd: 0,
					open_invoice_count: 6,
					open_invoice_amount_usd: 1_500,
					oldest_open_invoice_at: "2026-01-01T00:00:00Z",
				},
				usage: {
					organization_id: "org_1",
					last_usage_at: "2026-03-01T00:00:00Z",
					usage_30d_usd: 0,
					usage_365d_usd: 100,
					current_cost_per_frame_millicents: null,
					recent_costs_per_frame_millicents: [],
				},
			},
		});
		expect(findings).toHaveLength(1);
		expect(findings[0]?.kind).toBe("PAYMENT_RISK");
		expect(findings[0]?.severity).toBe("CRITICAL");
	});
});
