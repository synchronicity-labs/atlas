import { expect, test } from "bun:test";
import { isQbrPlgQuestion, qbrQuarterValue, qbrQueries } from "./queries";
import registry from "./registry.json";

test("QBR queries cover exactly the automated metrics with closed UTC month boundaries", () => {
	const queries = qbrQueries(new Date("2026-09-30T23:59:59Z"));
	expect(Object.keys(queries).sort()).toEqual(
		registry.metrics
			.filter((m) => m.automated)
			.map((m) => m.id)
			.sort(),
	);
	for (const [id, query] of Object.entries(queries)) {
		expect(query.queryText).toContain("2026-09-01");
		if (id === "product_return_lift") {
			expect(query.queryText).toContain(
				"sentAt')::timestamptz < timestamptz '2026-09-01",
			);
		} else if (id === "enterprise_usage_retention") {
			expect(query.queryText).toContain(
				"periods.period_start < toDate('2026-09-01')",
			);
			expect(query.queryText).not.toContain("toDate('2026-10-01')");
		} else {
			expect(query.queryText).not.toContain("2026-10-01");
		}
		expect(isQbrPlgQuestion(`qbr:${id}`)).toBe(
			query.databaseExternalId === "166" && id !== "enterprise_usage_retention",
		);
	}
	expect(
		qbrQueries(new Date("2026-10-01T00:00:00Z")).plg_teams?.queryText,
	).toContain("2026-10-01");
	expect(
		qbrQueries(new Date("2027-01-01T00:00:00Z")).plg_teams?.queryText,
	).not.toContain("2027-01-01");
	expect(() => qbrQueries(new Date("2026-07-01T00:00:00Z"))).toThrow(
		"No complete",
	);
	expect(isQbrPlgQuestion("other:product_m3_ndr")).toBe(false);
});

test("Q3 aggregates require all three months and use the authored aggregation", () => {
	const now = new Date("2026-10-01T00:00:00Z");
	const months = [
		{ period: "2026-07", value: 3, numerator: 1, denominator: 2 },
		{ period: "2026-08", value: 6, numerator: 9, denominator: 10 },
		{ period: "2026-09", value: 9, numerator: 9, denominator: 10 },
	];
	expect(
		qbrQuarterValue("plg_teams", months, new Date("2026-09-30T23:59:59Z")),
	).toBeNull();
	expect(qbrQuarterValue("plg_teams", months.slice(0, 2), now)).toBeNull();
	expect(qbrQuarterValue("plg_teams", months, now)?.value).toBe(6);
	expect(qbrQuarterValue("plg_teams_period_end", months, now)?.value).toBe(9);
	expect(qbrQuarterValue("plg_active_rate", months, now)).toBeNull();
	const movements = [
		{
			period: "2026-07",
			value: 3,
			numerator: 1,
			denominator: 2,
			quarterValue: null,
		},
		{
			period: "2026-08",
			value: 6,
			numerator: 9,
			denominator: 10,
			quarterValue: null,
		},
		{
			period: "2026-09",
			value: 9,
			numerator: null,
			denominator: null,
			quarterValue: 12,
		},
	];
	expect(qbrQuarterValue("plg_teams_adds", movements, now)).toEqual({
		period: "2026-Q3",
		value: 12,
		numerator: null,
		denominator: null,
	});
	expect(qbrQuarterValue("plg_teams_losses", movements, now)?.value).toBe(12);
	expect(qbrQuarterValue("plg_teams_net", movements, now)?.value).toBe(12);
	expect(
		qbrQuarterValue("plg_teams_adds", movements.slice(0, 2), now),
	).toBeNull();
	for (const metric of [
		"platform_completion",
		"product_feedback_coverage",
		"product_attribution",
	])
		expect(qbrQuarterValue(metric, months, now)).toEqual({
			period: "2026-Q3",
			value: 86.36,
			numerator: 19,
			denominator: 22,
		});
	expect(qbrQuarterValue("product_m3_ndr", months, now)).toBeNull();
});

test("Q3 movement SQL compares September and June membership sets", () => {
	const queries = qbrQueries(new Date("2026-10-01T00:00:00Z"));
	for (const id of ["plg_teams_adds", "plg_teams_losses", "plg_teams_net"]) {
		const query = queries[id]?.queryText ?? "";
		expect(query).toContain("quarter_value");
		expect(query).toContain("month = toDate('2026-06-01')");
		expect(query).toContain("month = toDate('2026-09-01')");
		expect(query).not.toContain("sum(gross_adds)");
		expect(query).not.toContain("sum(gross_losses)");
	}
});

test("Q3 return lift pools counts only after all quarter assignments mature", () => {
	const monthly = [
		{
			period: "2026-08",
			value: 100,
			numerator: null,
			denominator: null,
			quarterValue: -70,
		},
		{
			period: "2026-09",
			value: -88.89,
			numerator: null,
			denominator: null,
			quarterValue: -70,
		},
	];
	const query = qbrQueries(new Date("2026-10-15T00:00:00Z")).product_return_lift
		?.queryText;
	expect(query).toContain("date '2026-10-01'");
	expect(query).toContain("timestamptz '2026-10-15 00:00:00+00'");
	expect(query).toContain("supported_months = 3");
	expect(query).toContain("supported_arm_months = 6");
	expect(query).toContain("treated_assignments = treated_mature_assignments");
	expect(query).toContain("holdback_assignments = holdback_mature_assignments");
	expect(query).toContain("treated_assignments > 0");
	expect(query).toContain("holdback_assignments > 0");
	expect(query).toContain("holdback_returned > 0");
	expect(query).toContain("ambiguous_pair_organizations = 0");
	expect(query).toContain("sum(returned) filter (where arm = 'treated')");
	expect(query).toContain("sum(assignments) filter (where arm = 'holdback')");
	expect(query).not.toContain("avg(value)");
	expect(
		qbrQuarterValue(
			"product_return_lift",
			monthly,
			new Date("2026-10-14T23:59:59Z"),
		),
	).toBeNull();
	expect(
		qbrQuarterValue(
			"product_return_lift",
			monthly,
			new Date("2026-10-15T00:00:00Z"),
		),
	).toEqual({
		period: "2026-Q3",
		value: -70,
		numerator: null,
		denominator: null,
	});
	expect(
		qbrQuarterValue(
			"product_return_lift",
			monthly.slice(0, 1),
			new Date("2026-10-15T00:00:00Z"),
		)?.value,
	).toBe(-70);
	expect((100 + -88.89) / 2).not.toBeCloseTo(-70, 0);
	expect(
		qbrQuarterValue(
			"product_return_lift",
			monthly.map((item) => ({ ...item, quarterValue: null })),
			new Date("2026-10-15T00:00:00Z"),
		),
	).toBeNull();
});

test("PLG active rate stays unavailable without subscription history", () => {
	expect(qbrQueries(new Date("2026-10-02T00:00:00Z"))).not.toHaveProperty(
		"plg_active_rate",
	);
});

test("Enterprise usage retention uses a fixed Stripe cohort for monthly and Q3 NDR", () => {
	const query = qbrQueries(
		new Date("2026-10-02T00:00:00Z"),
	).enterprise_usage_retention;
	expect(query?.databaseExternalId).toBe("166");
	expect(query?.queryText).toContain("stripeCustomerId as stripe_customer_id");
	expect(query?.queryText).toContain("generationCostMillicents / 100000.0");
	expect(query?.queryText).toContain("base.month_start = periods.cohort_month");
	expect(query?.queryText).toContain(
		"current.month_start = periods.period_start",
	);
	expect(query?.queryText).toContain("left join customer_usage current");
	expect(query?.queryText).toContain("q2_base as");
	expect(query?.queryText).toContain("q3_usage as");
	expect(query?.queryText).toContain("quarter_numerator");
	expect(query?.queryText).not.toContain("sync_stripe_invoice");
	expect(query?.queryText).not.toContain("netSyncRevenue");
	expect(
		registry.metrics.find(
			(metric) => metric.id === "enterprise_usage_retention",
		)?.automated,
	).toBe(true);
	expect(isQbrPlgQuestion("qbr:enterprise_usage_retention")).toBe(false);
});

test("Enterprise Q3 NDR pools usage over the Q2 Stripe cohort", () => {
	const result = qbrQuarterValue(
		"enterprise_usage_retention",
		[
			{
				period: "2026-07",
				value: 94.93,
				numerator: 12680.7,
				denominator: 13358.31,
			},
			{
				period: "2026-08",
				value: 85.82,
				numerator: 11026.21,
				denominator: 12847.98,
			},
			{
				period: "2026-09",
				value: 153.12,
				numerator: 17135.65,
				denominator: 11190.73,
				quarterValue: 91.63,
				quarterNumerator: 36884.11129,
				quarterDenominator: 40254.06514,
			},
		],
		new Date("2026-10-02T00:00:00Z"),
	);
	expect(result).toEqual({
		period: "2026-Q3",
		value: 91.63,
		numerator: 36884.11129,
		denominator: 40254.06514,
	});
	expect(result?.value).not.toBeCloseTo((94.93 + 85.82 + 153.12) / 3, 0);
});
