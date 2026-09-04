import { describe, expect, it } from "bun:test";
import {
	buildChartData,
	columnVisualization,
	compatibleChartSeries,
	explicitRightAxisMetrics,
	isCurrencyMetric,
	isPercentMetric,
	metricDisplayFamily,
} from "../lib/chart-visualization";

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
		expect(result.series.map((series) => series.metric)).toEqual([
			"coverage_of_completed_pct",
			"upvote_pct",
		]);
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

		expect(result.series.map((series) => series.metric)).toEqual(
			columns.slice(1).map((column) => column.name),
		);
	});

	it("pivots a second dimension into separate chart series", () => {
		const result = buildChartData(
			[{ name: "week" }, { name: "surface" }, { name: "coverage_pct" }],
			[
				["2026-08-24", "app", 4.2],
				["2026-08-24", "api", 1.1],
				["2026-08-31", "app", 4.5],
				["2026-08-31", "api", 1.3],
			],
			{
				"graph.dimensions": ["week", "surface"],
				"graph.metrics": ["coverage_pct"],
			},
		);

		expect(result.series.map((series) => series.label)).toEqual(["app", "api"]);
		expect(result.data).toEqual([
			{
				week: "2026-08-24",
				'["coverage_pct","app"]': 4.2,
				'["coverage_pct","api"]': 1.1,
			},
			{
				week: "2026-08-31",
				'["coverage_pct","app"]': 4.5,
				'["coverage_pct","api"]': 1.3,
			},
		]);
	});

	it("reads saved titles, suffixes, precision, and explicit axes", () => {
		const visualization = {
			column_settings: {
				'["name","coverage_pct"]': {
					column_title: "Coverage",
					decimals: 3,
					suffix: "%",
				},
			},
			series_settings: {
				coverage_pct: { axis: "right" },
				completed: { axis: null },
			},
		};

		expect(columnVisualization(visualization, "coverage_pct")).toEqual({
			title: "Coverage",
			suffix: "%",
			decimals: 3,
			numberStyle: null,
		});
		expect([...explicitRightAxisMetrics(visualization)]).toEqual([
			"coverage_pct",
		]);
	});

	it("recognizes Atlas percentage field names", () => {
		expect(isPercentMetric("coverage_of_completed_pct")).toBe(true);
		expect(isPercentMetric("upvote_rate")).toBe(true);
		expect(isPercentMetric("completed_generations")).toBe(false);
		expect(isPercentMetric("retained_ndr_usd")).toBe(false);
	});

	it("does not treat words containing arr as currency", () => {
		expect(isCurrencyMetric("ratings_carrying_reason")).toBe(false);
		expect(isCurrencyMetric("arr_usd")).toBe(true);
		expect(isCurrencyMetric("retained_ndr_usd")).toBe(true);
		expect(isCurrencyMetric("revenue_per_all_users_usd")).toBe(true);
	});

	it("uses explicit display metadata before fallback field-name rules", () => {
		expect(
			metricDisplayFamily("value", {
				column_settings: {
					'["name","value"]': { suffix: "%" },
				},
			}),
		).toBe("percent");
		expect(metricDisplayFamily("ratings_carrying_reason")).toBe("number");
	});

	it("keeps one compatible unit family in single-axis charts", () => {
		const series = [
			{ key: "completed", metric: "completed_generations", label: "Completed" },
			{ key: "coverage", metric: "coverage_pct", label: "Coverage" },
			{ key: "upvote", metric: "upvote_pct", label: "Upvote" },
		];
		expect(compatibleChartSeries(series).map((item) => item.metric)).toEqual([
			"coverage_pct",
			"upvote_pct",
		]);
	});
});
