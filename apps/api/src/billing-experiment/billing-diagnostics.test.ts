import { describe, expect, test } from "bun:test";
import { buildBillingDiagnostics } from "./billing-diagnostics";

const day = 24 * 60 * 60 * 1000;
const asOf = new Date("2026-08-26T00:00:00.000Z");

describe("billing experiment diagnostics", () => {
	test("reconciles arm, tier, top-up, cancellation, and renewal rows", () => {
		const result = buildBillingDiagnostics({
			asOf,
			assignments: [
				{
					organizationId: "v2-paid",
					arm: "v2_control",
					assignmentAt: asOf.getTime() - 60 * day,
					firstSubscribedAt: asOf.getTime() - 45 * day,
					currentPlan: "creator",
				},
				{
					organizationId: "v3-paid",
					arm: "v3_treatment",
					assignmentAt: asOf.getTime() - 60 * day,
					firstSubscribedAt: asOf.getTime() - 40 * day,
					currentPlan: "pro",
				},
			],
			invoices: [
				{
					id: "v2-create",
					organizationId: "v2-paid",
					billingReason: "subscription_create",
					amountUsd: 29,
					amountRemainingUsd: 0,
					createdAt: asOf.getTime() - 45 * day,
					plan: "creator",
					status: "paid",
				},
				{
					id: "v3-cycle",
					organizationId: "v3-paid",
					billingReason: "subscription_cycle",
					amountUsd: 79,
					amountRemainingUsd: 0,
					createdAt: asOf.getTime() - 10 * day,
					plan: "pro",
					status: "paid",
				},
				{
					id: "v3-failed",
					organizationId: "v3-paid",
					billingReason: "subscription_cycle",
					amountUsd: 0,
					amountRemainingUsd: 79,
					createdAt: asOf.getTime() - day,
					plan: "pro",
					status: "open",
				},
			],
			payments: [
				{
					id: "topup-1",
					organizationId: "v3-paid",
					amountUsd: 20,
					createdAt: asOf.getTime() - 20 * day,
					status: "succeeded",
				},
				{
					id: "topup-2",
					organizationId: "v3-paid",
					amountUsd: 30,
					createdAt: asOf.getTime() - 5 * day,
					status: "succeeded",
				},
			],
			cancellations: [
				{
					id: "cancel-1",
					organizationId: "v2-paid",
					canceledAt: asOf.getTime() - 3 * day,
					reason: "too_expensive",
				},
			],
			subscriptions: [
				{
					organizationId: "v3-paid",
					status: "active",
					cancelAt: asOf.getTime() + 4 * day,
					canceledAt: null,
				},
			],
		});

		const records = result.rows.map((row) =>
			Object.fromEntries(
				result.columns.map((column, index) => [column.name, row[index]]),
			),
		);
		const v3 = records.find(
			(row) => row.section === "summary" && row.arm === "v3 treatment",
		);

		expect(v3).toMatchObject({
			assigned: 1,
			paid_converters: 1,
			topup_users: 1,
			topup_revenue_usd: 50,
			repeat_topup_orgs: 1,
			pending_cancel: 1,
			renewal_eligible: 1,
			renewed: 1,
			failed_invoice_count: 1,
			failed_invoice_amount_usd: 79,
		});
		expect(
			records.find(
				(row) => row.section === "reason" && row.arm === "v2 control",
			),
		).toMatchObject({
			cancellation_reason: "too_expensive",
			cancellation_reason_count: 1,
		});
	});

	test("does not count activity before assignment or raw cancellation comments", () => {
		const result = buildBillingDiagnostics({
			asOf,
			assignments: [
				{
					organizationId: "v3",
					arm: "v3_treatment",
					assignmentAt: asOf.getTime() - 10 * day,
					firstSubscribedAt: asOf.getTime() - 5 * day,
					currentPlan: "creator",
				},
			],
			invoices: [],
			payments: [
				{
					id: "old",
					organizationId: "v3",
					amountUsd: 100,
					createdAt: asOf.getTime() - 20 * day,
					status: "succeeded",
				},
			],
			cancellations: [],
			subscriptions: [],
		});

		expect(JSON.stringify(result)).not.toContain("comment");
		expect(result.rows[1]).not.toContain(100);
	});
});
