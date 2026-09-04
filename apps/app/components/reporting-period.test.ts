import { describe, expect, test } from "bun:test";
import {
	filterReportingRows,
	reportingDateColumnIndex,
} from "./reporting-period";

describe("dashboard reporting periods", () => {
	test("filters dated card rows to a custom UTC range", () => {
		const result = filterReportingRows(
			[{ name: "month" }, { name: "value" }],
			[
				["2026-06-01", 10],
				["2026-07-01", 20],
				["2026-08-01", 30],
			],
			{ range: "all", from: "2026-07-01", to: "2026-07-31" },
		);

		expect(result.rows).toEqual([["2026-07-01", 20]]);
	});

	test("detects cohort dates but not freshness timestamps", () => {
		expect(
			reportingDateColumnIndex([
				{ name: "data_through" },
				{ name: "cohort_month" },
			]),
		).toBe(1);
	});

	test("detects compact Metabase period aliases", () => {
		expect(reportingDateColumnIndex([{ name: "mo" }, { name: "value" }])).toBe(
			0,
		);
		expect(reportingDateColumnIndex([{ name: "wk" }, { name: "value" }])).toBe(
			0,
		);
	});

	test("leaves questions without a reporting date unchanged", () => {
		const rows = [["Creator", 10]];
		const result = filterReportingRows(
			[{ name: "plan" }, { name: "value" }],
			rows,
			{ range: "3m", from: null, to: null },
		);

		expect(result.dateColumnIndex).toBeNull();
		expect(result.rows).toBe(rows);
	});
});
