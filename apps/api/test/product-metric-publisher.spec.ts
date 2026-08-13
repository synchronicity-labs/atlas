import { describe, expect, test } from "bun:test";
import { FactGrain } from "@crm/db";
import {
	hasRequiredEligibilityPredicates,
	inferMetricWindow,
	preferredAtlasQuestionNumber,
	REVENUE_METRIC_SPECS,
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
				and is_anonymous = false
				and email not like '%@sync.so'
				and email not like '%@sync.labs'
			`),
		).toBe(true);
		expect(
			hasRequiredEligibilityPredicates(`
				where banned = false
				and is_anonymous = false
				and email not like '%@sync.so'
			`),
		).toBe(false);
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

	test("uses explicit report bounds and the oldest shared source cutoff", () => {
		const window = inferMetricWindow(
			{
				columns: [
					{
						name: "period_start",
						displayName: null,
						baseType: "type/DateTime",
					},
					{
						name: "period_end",
						displayName: null,
						baseType: "type/DateTime",
					},
					{
						name: "data_through",
						displayName: null,
						baseType: "type/DateTime",
					},
					{ name: "value", displayName: null, baseType: "type/Float" },
				],
				rows: [
					[
						"2026-08-03T00:00:00Z",
						"2026-08-10T00:00:00Z",
						"2026-08-10T00:00:00Z",
						88.7,
					],
					[
						"2026-08-03T00:00:00Z",
						"2026-08-10T00:00:00Z",
						"2026-08-09T23:58:00Z",
						81.4,
					],
				],
			},
			FactGrain.WEEK,
			new Date("2026-08-11T14:00:00Z"),
		);
		expect(window.periodStart.toISOString()).toBe("2026-08-03T00:00:00.000Z");
		expect(window.periodEnd.toISOString()).toBe("2026-08-10T00:00:00.000Z");
		expect(window.dataThrough.toISOString()).toBe("2026-08-09T23:58:00.000Z");
		expect(window.reportingPeriod).toBe("2026-08");
	});

	test("registers stable governed questions for the weekly revenue report", () => {
		expect(REVENUE_METRIC_SPECS.map((spec) => spec.questionNumber)).toEqual([
			1101, 1102, 1103, 1104, 1105, 1106, 1107, 1108, 1109,
		]);
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
