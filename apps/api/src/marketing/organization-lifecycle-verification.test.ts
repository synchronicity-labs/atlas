import { describe, expect, test } from "bun:test";
import { buildSubscriptionLifecycle } from "./organization-lifecycle";
import { organizationLifecycleVerificationChecks } from "./organization-lifecycle-verification";

describe("organization lifecycle verification", () => {
	test("accepts reconciled lifecycle rows", () => {
		const subscription = buildSubscriptionLifecycle({
			asOf: new Date("2026-09-04T00:00:00.000Z"),
			organizations: [
				{
					id: "org-1",
					signupCohort: "2026-01-01",
					billingVersion: "v3",
					plan: "pro",
					segment: "app",
				},
			],
			subscriptions: [
				{
					id: "sub-1",
					organizationId: "org-1",
					createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
					currentPeriodEnd: Date.parse("2026-10-01T00:00:00.000Z"),
					cancelAt: null,
					canceledAt: null,
					plan: "pro",
				},
			],
		});
		const seriesIndex = subscription.columns.findIndex(
			(column) => column.name === "lifecycle_series",
		);
		const rows = [
			...subscription.rows,
			...subscription.rows.slice(0, 1).map((row) => {
				const copy = [...row];
				copy[seriesIndex] = "product_usage";
				return copy;
			}),
			...subscription.rows.slice(0, 1).map((row) => {
				const copy = [...row];
				copy[seriesIndex] = "professional_qualification";
				return copy;
			}),
		];
		const checks = organizationLifecycleVerificationChecks({
			columns: subscription.columns,
			rows,
		});
		expect(checks.every((check) => check.status === "PASSED")).toBe(true);
	});
});
