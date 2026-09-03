import { describe, expect, it } from "bun:test";
import { buildChartData, isPercentMetric } from "../lib/chart-visualization";

const columns = [
	{ name: "model" },
	{ name: "terminal_generations" },
	{ name: "completed_generations" },
	{ name: "rated_generations" },
	{ name: "ratings" },
	{ name: "coverage_of_completed_pct" },
	{ name: "coverage_of_terminal_pct" },
	{ name: "upvote_pct" },
];

const rows = [
	["sync-3", 261_000, 258_000, 9_100, 9_000, 3.53, 3.48, 59.43],
	["sync-2-pro", 120_000, 118_000, 1_230, 1_200, 1.04, 1.03, 59.48],
];

describe("saved chart visualization settings", () => {
	it("plots only Q137's selected percentage metrics", () => {
		const result = buildChartData(columns, rows, {
			"graph.dimensions": ["model"],
			"graph.metrics": ["coverage_of_completed_pct", "upvote_pct"],
		});

		expect(result.xKey).toBe("model");
		expect(result.series).toEqual(["coverage_of_completed_pct", "upvote_pct"]);
		expect(result.data[0]?.terminal_generations).toBe(261_000);
	});

	it("keeps an explicit empty metric selection empty", () => {
		const result = buildChartData(columns, rows, {
			"graph.dimensions": ["model"],
			"graph.metrics": [],
		});

		expect(result.series).toEqual([]);
	});

	it("infers numeric series only when no metric selection exists", () => {
		const result = buildChartData(columns, rows, {
			"graph.dimensions": ["model"],
		});

		expect(result.series).toEqual(
			columns.slice(1).map((column) => column.name),
		);
	});

	it("recognizes Atlas percentage field names", () => {
		expect(isPercentMetric("coverage_of_completed_pct")).toBe(true);
		expect(isPercentMetric("upvote_rate")).toBe(true);
		expect(isPercentMetric("completed_generations")).toBe(false);
	});
});
