import { describe, expect, test } from "bun:test";
import { buildBillingScorecard } from "./billing-scorecard";

describe("billing experiment scorecard", () => {
	test("joins the live readout to diagnostic summary, tier, and reason rows", () => {
		const result = buildBillingScorecard({
			asOf: "2026-09-04T00:00:00.000Z",
			arms: [
				{
					arm: "v2_control",
					assignedOrgs: 100,
					paidOrgs: 25,
					paidConversionPct: 25,
					cashEligibleOrgs: 20,
					cashUsd: 2000,
					paidMonths: 40,
					cashPerPaidOrgMonthUsd: 50,
					eligible30d: 20,
					churned30d: 5,
					churn30dPct: 25,
					churn30dLowPct: 10,
					churn30dHighPct: 40,
					eligible60d: 10,
					churned60d: 4,
					churn60dPct: 40,
					impliedLifetimeMonths: 4,
					impliedCashLtvUsd: 200,
				},
			],
			diagnostics: {
				columns: [
					{ name: "section", displayName: "Section", baseType: "type/Text" },
					{ name: "arm", displayName: "Arm", baseType: "type/Text" },
					{ name: "tier", displayName: "Tier", baseType: "type/Text" },
					{
						name: "assigned",
						displayName: "Assigned",
						baseType: "type/Integer",
					},
					{
						name: "paid_converters",
						displayName: "Paid",
						baseType: "type/Integer",
					},
					{
						name: "topup_users",
						displayName: "Top-ups",
						baseType: "type/Integer",
					},
					{
						name: "topup_revenue_usd",
						displayName: "Top-up revenue",
						baseType: "type/Decimal",
					},
					{
						name: "repeat_topup_orgs",
						displayName: "Repeat",
						baseType: "type/Integer",
					},
					{
						name: "canceled",
						displayName: "Canceled",
						baseType: "type/Integer",
					},
					{
						name: "pending_cancel",
						displayName: "Pending",
						baseType: "type/Integer",
					},
					{
						name: "renewal_eligible",
						displayName: "Renewal eligible",
						baseType: "type/Integer",
					},
					{ name: "renewed", displayName: "Renewed", baseType: "type/Integer" },
					{
						name: "failed_invoice_count",
						displayName: "Failed",
						baseType: "type/Integer",
					},
					{
						name: "failed_invoice_amount_usd",
						displayName: "Failed amount",
						baseType: "type/Decimal",
					},
					{
						name: "cancellation_reason",
						displayName: "Reason",
						baseType: "type/Text",
					},
					{
						name: "cancellation_reason_count",
						displayName: "Reason count",
						baseType: "type/Integer",
					},
					{
						name: "data_through",
						displayName: "Data through",
						baseType: "type/DateTime",
					},
				],
				rows: [
					[
						"summary",
						"v2 control",
						null,
						100,
						25,
						0,
						0,
						0,
						5,
						2,
						20,
						15,
						3,
						75,
						null,
						null,
						"2026-09-04T00:00:00.000Z",
					],
					[
						"tier",
						"v2 control",
						"creator",
						100,
						25,
						null,
						null,
						null,
						null,
						null,
						null,
						null,
						null,
						null,
						null,
						null,
						"2026-09-04T00:00:00.000Z",
					],
				],
			},
		});
		const columns = result.columns.map((column) => column.name);
		const summary = Object.fromEntries(
			columns.map((column, index) => [column, result.rows[0]?.[index]]),
		);
		const tier = Object.fromEntries(
			columns.map((column, index) => [column, result.rows[1]?.[index]]),
		);
		expect(summary).toMatchObject({
			eligible_organizations: 100,
			paid_converters: 25,
			paid_conversion_pct: 25,
			subscription_retention_30d_pct: 75,
			subscription_retention_60d_pct: 60,
			renewal_rate_pct: 75,
			failed_invoice_amount_usd: 75,
		});
		expect(tier).toMatchObject({
			tier: "creator",
			eligible_organizations: 100,
			paid_converters: 25,
			paid_conversion_pct: null,
		});
	});
});
