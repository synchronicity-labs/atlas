import { describe, expect, test } from "bun:test";
import { buildBillingExperimentReadout } from "../src/billing-experiment/billing-experiment.service";

describe("billing experiment readout", () => {
	test("uses valid assignment arms and fixed maturity windows", () => {
		const asOf = new Date("2026-08-01T00:00:00.000Z");
		const readout = buildBillingExperimentReadout({
			asOf,
			assignments: [
				{
					organizationId: "control-org",
					arm: "v2_control",
					assignmentAt: Date.parse("2026-06-01T00:00:00.000Z"),
					firstSubscribedAt: Date.parse("2026-06-15T00:00:00.000Z"),
					currentPlan: "creator",
				},
				{
					organizationId: "treatment-org",
					arm: "v3_treatment",
					assignmentAt: Date.parse("2026-06-01T00:00:00.000Z"),
					firstSubscribedAt: Date.parse("2026-06-15T00:00:00.000Z"),
					currentPlan: "pro",
				},
			],
			invoices: [
				{
					id: "control-invoice",
					organizationId: "control-org",
					billingReason: "subscription_create",
					amountUsd: 100,
					createdAt: Date.parse("2026-06-15T00:00:00.000Z"),
					plan: "creator",
				},
				{
					id: "treatment-invoice",
					organizationId: "treatment-org",
					billingReason: "subscription_create",
					amountUsd: 60,
					createdAt: Date.parse("2026-06-15T00:00:00.000Z"),
					plan: "pro",
				},
			],
			payments: [],
			cancellations: [
				{
					id: "control-cancel",
					organizationId: "control-org",
					canceledAt: Date.parse("2026-07-01T00:00:00.000Z"),
				},
			],
		});
		expect(readout.arms[0]).toMatchObject({
			arm: "v2_control",
			assignedOrgs: 1,
			paidOrgs: 1,
			cashEligibleOrgs: 1,
			eligible30d: 1,
			churned30d: 1,
			churn30dPct: 100,
		});
		expect(readout.arms[1]).toMatchObject({
			arm: "v3_treatment",
			assignedOrgs: 1,
			paidOrgs: 1,
			cashEligibleOrgs: 1,
			eligible30d: 1,
			churned30d: 0,
			churn30dPct: 0,
		});
	});

	test("keeps v2 hobbyist conversions out of paid comparison samples", () => {
		const readout = buildBillingExperimentReadout({
			asOf: new Date("2026-08-01T00:00:00.000Z"),
			assignments: [
				{
					organizationId: "hobbyist-org",
					arm: "v2_control",
					assignmentAt: Date.parse("2026-06-01T00:00:00.000Z"),
					firstSubscribedAt: Date.parse("2026-06-15T00:00:00.000Z"),
					currentPlan: "hobbyist",
				},
			],
			invoices: [
				{
					id: "hobbyist-invoice",
					organizationId: "hobbyist-org",
					billingReason: "subscription_create",
					amountUsd: 5,
					createdAt: Date.parse("2026-06-15T00:00:00.000Z"),
					plan: "hobbyist",
				},
			],
			payments: [],
			cancellations: [],
		});
		expect(readout.arms[0]).toMatchObject({
			paidOrgs: 1,
			cashEligibleOrgs: 0,
			eligible30d: 0,
		});
	});
});
