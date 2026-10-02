import { describe, expect, it } from "bun:test";
import {
	productCollectionDiagnostics,
	productCollectionQueries,
} from "./product-collection";

describe("product collection queries", () => {
	const now = new Date("2026-10-02T12:00:00.000Z");

	it("returns only monthly feedback and attribution metrics", () => {
		const queries = productCollectionQueries("2026-10-01", now);
		expect(Object.keys(queries).sort()).toEqual([
			"product_attribution",
			"product_feedback_coverage",
		]);
		for (const query of Object.values(queries)) {
			expect(query.databaseExternalId).toBe("34");
			expect(query.queryText).toMatch(/group by\s+(?:e\.)?period_start/);
			expect(query.queryText).toContain(
				"select period_start, numerator, denominator",
			);
			expect(query.queryText).not.toContain("sum(numerator)");
		}
	});

	it("caps future collection at the Q3 end", () => {
		const query = productCollectionQueries("2026-11-01", now)
			.product_feedback_coverage!.queryText;
		expect(query).toContain(
			"g.finished_at < timestamptz '2026-10-01 00:00:00+00'",
		);
	});

	it("stops at the current month boundary before that month is complete", () => {
		const query = productCollectionQueries(
			"2026-10-01",
			new Date("2026-09-17T12:00:00.000Z"),
		).product_feedback_coverage!.queryText;
		expect(query).toContain(
			"g.finished_at < timestamptz '2026-09-01 00:00:00+00'",
		);
		expect(query).not.toContain(
			"g.finished_at < timestamptz '2026-10-01 00:00:00+00'",
		);
	});

	it("stops at an explicit September month boundary", () => {
		const query = productCollectionQueries("2026-09-01", now)
			.product_feedback_coverage!.queryText;
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
		expect(diagnostics.product_return_lift!.queryText).toContain(
			"mature_assignments",
		);
	});
});
