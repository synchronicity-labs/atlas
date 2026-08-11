import { describe, expect, test } from "bun:test";
import { FactGrain } from "@crm/db";
import {
	hasRequiredEligibilityPredicates,
	inferMetricWindow,
	preferredAtlasQuestionNumber,
} from "../src/metabase/product-metric.publisher";
import { assertReadOnlyQuery } from "../src/questions/read-only-query";

describe("Product metric publication", () => {
	test("preserves stable Atlas numbers from immutable source card IDs", () => {
		expect(preferredAtlasQuestionNumber("8164")).toBe(15);
		expect(preferredAtlasQuestionNumber("8177")).toBe(8);
		expect(preferredAtlasQuestionNumber("unknown")).toBeNull();
	});

	test("certifies only queries with the canonical user exclusions", () => {
		expect(
			hasRequiredEligibilityPredicates(`
				where banned = false
				and disabled = false
				and is_anonymous = false
				and email not like '%@sync.so'
			`),
		).toBe(true);
		expect(
			hasRequiredEligibilityPredicates(
				"select count(*) from sync_prod.sync_usage3",
			),
		).toBe(false);
	});

	test("uses UTC half-open monthly windows and the latest complete month label", () => {
		const window = inferMetricWindow(
			{
				columns: [
					{ name: "month", displayName: "Month", baseType: "type/Date" },
					{ name: "value", displayName: "Value", baseType: "type/Integer" },
				],
				rows: [
					["2026-01-01T00:00:00Z", 10],
					["2026-07-01T00:00:00Z", 20],
				],
			},
			FactGrain.MONTH,
			new Date("2026-08-11T14:00:00Z"),
		);
		expect(window.periodStart.toISOString()).toBe("2026-01-01T00:00:00.000Z");
		expect(window.periodEnd.toISOString()).toBe("2026-08-01T00:00:00.000Z");
		expect(window.dataThrough.toISOString()).toBe("2026-08-01T00:00:00.000Z");
		expect(window.reportingPeriod).toBe("2026-07");
	});

	test("allows source notes before a read and still rejects a commented write", () => {
		expect(() =>
			assertReadOnlyQuery("SQL", "-- canonical source\nselect 1"),
		).not.toThrow();
		expect(() =>
			assertReadOnlyQuery("SQL", "/* source */\ndelete from users"),
		).toThrow("read-only SQL");
	});
});
