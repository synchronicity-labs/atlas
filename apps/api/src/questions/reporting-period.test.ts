import { describe, expect, test } from "bun:test";
import { filterQuestionResult } from "./reporting-period";

const columns = [{ name: "period_start" }, { name: "value" }];
const rows = [
	["2026-03-01T00:00:00.000Z", 3],
	["2026-04-01T00:00:00.000Z", 4],
	["2026-05-01T00:00:00.000Z", 5],
	["2026-06-01T00:00:00.000Z", 6],
	["2026-07-01T00:00:00.000Z", 7],
	["2026-08-01T00:00:00.000Z", 8],
];

describe("filterQuestionResult", () => {
	test("applies a custom UTC range even when all history is selected", () => {
		expect(
			filterQuestionResult(columns, rows, {
				range: "all",
				from: "2026-05-01",
				to: "2026-06-30",
			}),
		).toEqual(rows.slice(2, 4));
	});

	test("selects the previous complete UTC month", () => {
		expect(
			filterQuestionResult(
				columns,
				rows,
				{ range: "previous-month", from: null, to: null },
				new Date("2026-08-25T12:00:00.000Z"),
			),
		).toEqual(rows.slice(4, 5));
	});

	test("anchors rolling month presets on the latest returned period", () => {
		expect(
			filterQuestionResult(columns, rows, {
				range: "3m",
				from: null,
				to: null,
			}),
		).toEqual(rows.slice(3));
	});

	test("leaves results unchanged when no reporting date is present", () => {
		expect(
			filterQuestionResult(
				[{ name: "category" }, { name: "value" }],
				[["one", 1]],
				{ range: "mtd", from: null, to: null },
			),
		).toEqual([["one", 1]]);
	});
});
