import { describe, expect, test } from "bun:test";
import { buildSubscriptionLifecycle } from "./organization-lifecycle";

describe("organization lifecycle", () => {
	test("separates subscription retention, churn, and resubscription", () => {
		const result = buildSubscriptionLifecycle({
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
					createdAt: Date.parse("2026-01-10T00:00:00.000Z"),
					currentPeriodEnd: Date.parse("2026-04-15T00:00:00.000Z"),
					cancelAt: null,
					canceledAt: Date.parse("2026-04-10T00:00:00.000Z"),
					plan: "creator",
				},
				{
					id: "sub-2",
					organizationId: "org-1",
					createdAt: Date.parse("2026-06-05T00:00:00.000Z"),
					currentPeriodEnd: Date.parse("2026-10-05T00:00:00.000Z"),
					cancelAt: null,
					canceledAt: null,
					plan: "pro",
				},
			],
		});
		const records = result.rows.map((values) =>
			Object.fromEntries(
				result.columns.map((column, index) => [column.name, values[index]]),
			),
		);
		expect(
			records.find(
				(record) =>
					record.period_start === "2026-04-01" && record.plan === "creator",
			),
		).toMatchObject({
			starting_organizations: 1,
			retained_organizations: 0,
			churned_organizations: 1,
			churn_pct: 100,
		});
		expect(
			records.find(
				(record) =>
					record.period_start === "2026-06-01" && record.plan === "pro",
			),
		).toMatchObject({
			resubscription_eligible_organizations: 1,
			resubscribed_organizations: 1,
			resubscription_pct: 100,
		});
		expect(
			records.find(
				(record) =>
					record.period_start === "2026-07-01" && record.plan === "pro",
			),
		).toMatchObject({
			starting_organizations: 1,
			retained_organizations: 1,
			retention_pct: 100,
		});
	});
});
