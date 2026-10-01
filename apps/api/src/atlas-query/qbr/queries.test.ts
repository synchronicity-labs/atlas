import { expect, test } from "bun:test";
import { isQbrPlgQuestion, qbrQueries } from "./queries";
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
