import { describe, expect, test } from "bun:test";
import type {
	MetabaseClient,
	MetabaseResult,
} from "../metabase/metabase.client";
import {
	adobePluginVerificationChecks,
	adobePluginWeeklyReport,
} from "./adobe-plugin";

const query = {
	source: "adobe_plugin" as const,
	report: "weekly-kpis" as const,
	version: 1 as const,
};

describe("Adobe plugin weekly report", () => {
	test("publishes complete governed sections without customer text", async () => {
		const result = await report();
		const checks = adobePluginVerificationChecks(result, query);

		expect(new Set(records(result).map((row) => row.section))).toEqual(
			new Set([
				"installs",
				"retention",
				"power_retention",
				"activation",
				"two_day_activation",
				"post_generation",
				"nps",
				"nps_distribution",
				"nps_response",
			]),
		);
		expect(checks.every((check) => check.status === "PASSED")).toBe(true);
		expect(result.columns.map((column) => column.name)).not.toContain(
			"comment",
		);
		expect(new Set(records(result).map((row) => row.data_through))).toEqual(
			new Set(["2026-08-24T00:00:00.000Z"]),
		);
	});

	test("fails verification when a published rate does not reconcile", async () => {
		const result = await report();
		const rateIndex = result.columns.findIndex(
			(column) => column.name === "rate_pct",
		);
		const row = result.rows.find((values) => values[rateIndex] !== null);
		if (!row) throw new Error("expected a rate row");
		row[rateIndex] = 99;

		const check = adobePluginVerificationChecks(result, query).find(
			(candidate) => candidate.name === "metric_reconciliation",
		);
		expect(check?.status).toBe("FAILED");
	});

	test("accepts a valid negative NPS score", async () => {
		const result = await report(metabasePreviewNegative);
		const checks = adobePluginVerificationChecks(result, query);

		expect(checks.every((check) => check.status === "PASSED")).toBe(true);
		expect(
			records(result).find((row) => row.metric === "nps_score")?.value,
		).toBe(-30);
	});
});

async function report(preview: typeof metabasePreview = metabasePreview) {
	return adobePluginWeeklyReport({
		query,
		now: new Date("2026-08-26T12:00:00.000Z"),
		nativeInsight,
		metabase: { preview } as unknown as MetabaseClient,
	});
}

async function metabasePreviewNegative(input: {
	queryText: string;
}): Promise<MetabaseResult> {
	if (input.queryText.includes("as nps_score")) {
		return result(
			["total", "promoters", "passives", "detractors", "nps_score"],
			[[10, 2, 3, 5, -30]],
		);
	}
	return metabasePreview(input);
}

async function nativeInsight(queryValue: unknown): Promise<unknown> {
	const source = object(object(queryValue).source);
	const series = Array.isArray(source.series) ? source.series.map(object) : [];
	if (source.kind === "RetentionQuery") {
		return retention(
			Boolean(object(source.retentionFilter).minimumOccurrences),
		);
	}
	if (source.kind === "FunnelsQuery") {
		if (series.length === 2) {
			return [step("generated", 50), step("returned", 35)];
		}
		return [
			step("plugin_installed", 40),
			step("plugin_signin_initiated", 32),
			step("plugin_signin_completed", 30),
			step("playground_started_generation", 24),
			step("playground_completed_generation", 20),
			step("plugin_used_downloaded_generation", 16),
		];
	}
	if (series.length === 4) {
		return [
			trend("plugin_generation_previewed", 60),
			trend("plugin_generation_downloaded", 40),
			trend("plugin_generation_inserted", 10),
			trend("playground_completed_generation", 50),
		];
	}
	const dateFrom = String(object(source.dateRange).date_from);
	if (dateFrom === "all") return [trend("plugin_installed", 100)];
	if (dateFrom.startsWith("2026-08-17")) return [trend("plugin_installed", 20)];
	return [trend("plugin_installed", 15)];
}

async function metabasePreview(input: {
	queryText: string;
}): Promise<MetabaseResult> {
	if (input.queryText.includes("as nps_score")) {
		return result(
			["total", "promoters", "passives", "detractors", "nps_score"],
			[[10, 6, 2, 2, 40]],
		);
	}
	if (input.queryText.includes("as score,")) {
		return result(
			["score", "responses"],
			[
				[6, 2],
				[7, 2],
				[9, 3],
				[10, 3],
			],
		);
	}
	return result(
		["status", "responses"],
		[
			["dismissed", 5],
			["submitted", 10],
		],
	);
}

function retention(power: boolean) {
	const multiplier = power ? 0.5 : 1;
	return ["2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03"].map(
		(date) => ({
			date: `${date}T00:00:00-04:00`,
			values: [
				{ label: "Week 0", count: 20 * multiplier },
				{ label: "Week 1", count: 10 * multiplier },
				{ label: "Week 2", count: 8 * multiplier },
				{ label: "Week 3", count: 6 * multiplier },
			],
		}),
	);
}

function trend(label: string, aggregatedValue: number) {
	return { label, aggregated_value: aggregatedValue };
}

function step(name: string, count: number) {
	return { name, count };
}

function result(names: string[], rows: unknown[][]): MetabaseResult {
	return {
		columns: names.map((name) => ({ name, displayName: name, baseType: null })),
		rows,
	};
}

function records(value: MetabaseResult) {
	return value.rows.map((row) =>
		Object.fromEntries(
			value.columns.map((column, index) => [column.name, row[index] ?? null]),
		),
	);
}

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
