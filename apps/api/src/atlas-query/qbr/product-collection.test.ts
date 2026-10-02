import { describe, expect, it } from "bun:test";
import {
	productCollectionDiagnostics,
	productCollectionQueries,
} from "./product-collection";

describe("product collection queries", () => {
	const now = new Date("2026-10-02T12:00:00.000Z");

	it("returns monthly feedback, attribution, and mature return-lift metrics", () => {
		const queries = productCollectionQueries("2026-10-01", now);
		expect(Object.keys(queries).sort()).toEqual([
			"product_attribution",
			"product_feedback_coverage",
			"product_return_lift",
		]);
		for (const id of ["product_attribution", "product_feedback_coverage"]) {
			const query = queries[id];
			if (!query) throw new Error(`Missing ${id} query.`);
			expect(query.databaseExternalId).toBe("34");
			expect(query.queryText).toMatch(/group by\s+(?:e\.)?period_start/);
			expect(query.queryText).toContain(
				"select period_start, numerator, denominator",
			);
			expect(query.queryText).not.toContain("sum(numerator)");
		}
		const returnLift = queries.product_return_lift;
		if (!returnLift) throw new Error("Missing product return-lift query.");
		expect(returnLift.databaseExternalId).toBe("34");
	});

	it("caps future collection at the Q3 end", () => {
		const query = productCollectionQueries("2026-11-01", now)
			.product_feedback_coverage?.queryText;
		expect(query).toContain(
			"g.finished_at < timestamptz '2026-10-01 00:00:00+00'",
		);
	});

	it("stops at the current month boundary before that month is complete", () => {
		const query = productCollectionQueries(
			"2026-10-01",
			new Date("2026-09-17T12:00:00.000Z"),
		).product_feedback_coverage?.queryText;
		expect(query).toContain(
			"g.finished_at < timestamptz '2026-09-01 00:00:00+00'",
		);
		expect(query).not.toContain(
			"g.finished_at < timestamptz '2026-10-01 00:00:00+00'",
		);
	});

	it("stops at an explicit September month boundary", () => {
		const query = productCollectionQueries("2026-09-01", now)
			.product_feedback_coverage?.queryText;
		expect(query).toContain(
			"g.finished_at < timestamptz '2026-09-01 00:00:00+00'",
		);
	});

	it("rejects windows that end before Q3", () => {
		expect(() => productCollectionQueries("2026-07-01", now)).toThrow(
			"No complete Q3 month is available.",
		);
		expect(() => productCollectionQueries("2026-06-01", now)).toThrow(
			"No complete Q3 month is available.",
		);
	});

	it("keeps upvote and return analysis outside the main metric map", () => {
		const diagnostics = productCollectionDiagnostics("2026-10-01", now);
		expect(Object.keys(diagnostics).sort()).toEqual([
			"product_return_lift",
			"product_upvotes",
		]);
		expect(diagnostics.product_return_lift?.queryText).toContain(
			"mature_assignments",
		);
	});

	it("publishes only complete, nonzero-arm months using exact relative-lift counts", () => {
		const result = productCollectionQueries(
			"2026-10-01",
			now,
		).product_return_lift;
		if (!result) throw new Error("Missing product return-lift query.");
		const query = result.queryText;
		expect(query).toContain("treated_assignments > 0");
		expect(query).toContain("holdback_assignments > 0");
		expect(query).toContain("holdback_returned > 0");
		expect(query).toContain("treated_assignments = treated_mature_assignments");
		expect(query).toContain(
			"holdback_assignments = holdback_mature_assignments",
		);
		expect(query).toContain("ambiguous_pair_organizations = 0");
		expect(query).toContain(
			"treated_returned::numeric * holdback_mature_assignments",
		);
		expect(query).toContain(
			"treated_mature_assignments::numeric * holdback_returned",
		);
		expect(query).not.toContain("as numerator");
		expect(query).not.toContain("as denominator");
		expect(query).toContain(
			"assigned_at <= timestamptz '2026-10-02T12:00:00.000Z' - interval '14 days'",
		);
		expect(100 * (166 / 5254 / (33 / 949) - 1)).toBeCloseTo(-9.14, 2);
	});
});
