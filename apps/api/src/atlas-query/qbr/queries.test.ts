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
		expect(query.queryText).not.toContain("2026-10-01");
		expect(isQbrPlgQuestion(`qbr:${id}`)).toBe(
			query.databaseExternalId === "166",
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
	expect(qbrQuarterValue("platform_completion", months, now)).toEqual({
		period: "2026-Q3",
		value: 86.36,
		numerator: 19,
		denominator: 22,
	});
	expect(qbrQuarterValue("product_m3_ndr", months, now)).toBeNull();
});
