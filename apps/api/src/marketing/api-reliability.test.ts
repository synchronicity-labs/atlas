import { describe, expect, mock, test } from "bun:test";
import {
	apiReliabilityVerificationChecks,
	apiReliabilityWeeklyReport,
	canReuseApiReliability,
} from "./api-reliability";
import type { BetterStackClient } from "./betterstack.client";

const query = {
	source: "api_reliability" as const,
	report: "weekly-reliability" as const,
	version: 1 as const,
};

describe("API reliability weekly report", () => {
	test("publishes two governed weeks for all and API-key traffic", async () => {
		const source = mock().mockResolvedValue({
			id: "1018705",
			name: "[Prod] Sync API V2",
			dataRegion: "eu-central-1a",
			tableName: "prod_sync_api_v2",
			teamId: "202575",
		});
		const sql = mock()
			.mockResolvedValueOnce(aggregateRows())
			.mockResolvedValueOnce([
				{
					source_rows: 2000,
					eligible_rows: 1800,
					classified_rows: 1200,
					unmapped_relevant_rows: 0,
					covered_hours: 336,
					excluded_health_sse: 150,
					excluded_bots: 50,
					window_min: "2026-08-10 00:00:00",
					window_max: "2026-08-23 23:59:59",
				},
			]);
		const result = await apiReliabilityWeeklyReport({
			query,
			betterstack: { source, sql } as unknown as BetterStackClient,
			now: new Date("2026-08-26T12:00:00Z"),
		});

		expect(result.rows).toHaveLength(28);
		expect(source).toHaveBeenCalledWith("[Prod] Sync API V2");
		expect(sql).toHaveBeenCalledTimes(2);
		for (const call of sql.mock.calls) {
			const queryText = String(call[1]);
			expect(queryText).toContain(
				"s3Cluster(primary, t202575_prod_sync_api_v2_s3)",
			);
			expect(queryText).toContain("_row_type = 1");
			expect(queryText).toContain(
				"JSONExtractString(raw, 'message') = 'api_response'",
			);
			expect(queryText).toContain("remote(t202575_prod_sync_api_v2_logs)");
			expect(queryText).toContain("union all");
			expect(
				queryText.match(/dt >= toDateTime\('2026-08-10 00:00:00'/g),
			).toHaveLength(2);
			expect(
				queryText.match(/dt < toDateTime\('2026-08-24 00:00:00'/g),
			).toHaveLength(2);
		}
		expect(
			apiReliabilityVerificationChecks(result, query).map((check) => [
				check.name,
				check.status,
			]),
		).toEqual([
			["betterstack_adapter", "PASSED"],
			["endpoint_registry_review", "PASSED"],
			["bot_and_healthcheck_exclusion", "PASSED"],
			["error_taxonomy_review", "PASSED"],
			["latency_population_review", "PASSED"],
			["oldest_complete_watermark", "PASSED"],
		]);
		for (const row of result.rows) row[27] = "us-west-2";
		expect(
			apiReliabilityVerificationChecks(result, query).find(
				(check) => check.name === "betterstack_adapter",
			)?.status,
		).toBe("FAILED");
		const set = (name: string, value: unknown) => {
			const index = result.columns.findIndex((column) => column.name === name);
			for (const row of result.rows) row[index] = value as string;
		};
		set("source_region", "eu-central-1a");
		set("covered_hours", 321);
		set("source_window_max", "2026-08-23T09:23:48.104Z");
		expect(
			apiReliabilityVerificationChecks(result, query).find(
				(check) => check.name === "oldest_complete_watermark",
			)?.status,
		).toBe("FAILED");
		set("source_window_max", "2026-08-23T23:59:59.949Z");
		expect(
			apiReliabilityVerificationChecks(result, query).find(
				(check) => check.name === "oldest_complete_watermark",
			)?.status,
		).toBe("FAILED");
		set("covered_hours", 336);
		expect(
			apiReliabilityVerificationChecks(result, query).every(
				(check) => check.status === "PASSED",
			),
		).toBe(true);
	});

	test("fails closed when BetterStack has no covered source window", async () => {
		const betterstack = {
			source: mock().mockResolvedValue({
				id: "1018705",
				name: "[Prod] Sync API V2",
				dataRegion: "eu-central-1a",
				tableName: "prod_sync_api_v2",
				teamId: "202575",
			}),
			sql: mock().mockResolvedValue([]),
		} as unknown as BetterStackClient;

		await expect(
			apiReliabilityWeeklyReport({
				query,
				betterstack,
				now: new Date("2026-08-26T12:00:00Z"),
			}),
		).rejects.toThrow("complete reliability window");
	});

	test("fails closed when SQL omits a registry row", async () => {
		const betterstack = {
			source: mock().mockResolvedValue({
				id: "1018705",
				name: "[Prod] Sync API V2",
				dataRegion: "eu-central-1a",
				tableName: "prod_sync_api_v2",
				teamId: "202575",
			}),
			sql: mock()
				.mockResolvedValueOnce(aggregateRows().slice(1))
				.mockResolvedValueOnce([
					{
						source_rows: 2000,
						eligible_rows: 1800,
						classified_rows: 1200,
						unmapped_relevant_rows: 0,
						covered_hours: 336,
						excluded_health_sse: 150,
						excluded_bots: 50,
						window_min: "2026-08-10 00:00:00",
						window_max: "2026-08-23 23:59:59",
					},
				]),
		} as unknown as BetterStackClient;

		await expect(
			apiReliabilityWeeklyReport({
				query,
				betterstack,
				now: new Date("2026-08-26T12:00:00Z"),
			}),
		).rejects.toThrow("exact endpoint registry");
	});
});

describe("API reliability refresh reuse", () => {
	const now = new Date("2026-09-07T12:00:00Z");
	const current = {
		now,
		lastCheckedAt: new Date("2026-09-07T11:00:00Z"),
		dataThrough: new Date("2026-09-07T00:00:00Z"),
		versionCreatedAt: new Date("2026-08-26T00:00:00Z"),
	};
	test("reuses a checked current-week result for six hours", () => {
		expect(canReuseApiReliability(current)).toBe(true);
		expect(
			canReuseApiReliability({
				...current,
				lastCheckedAt: new Date("2026-09-07T06:00:00Z"),
			}),
		).toBe(false);
	});
	test("refreshes after rollover, a definition edit, or a missing successful check", () => {
		expect(
			canReuseApiReliability({
				...current,
				dataThrough: new Date("2026-08-31T00:00:00Z"),
			}),
		).toBe(false);
		expect(canReuseApiReliability({ ...current, versionCreatedAt: now })).toBe(
			false,
		);
		expect(canReuseApiReliability({ ...current, lastCheckedAt: null })).toBe(
			false,
		);
		expect(canReuseApiReliability({ ...current, dataThrough: null })).toBe(
			false,
		);
		expect(
			canReuseApiReliability({
				...current,
				lastCheckedAt: new Date("2026-09-08T00:00:00Z"),
			}),
		).toBe(false);
	});
});

function aggregateRows() {
	const weeks = ["2026-08-10 00:00:00", "2026-08-17 00:00:00"];
	const endpoints = [
		"public_api_tts",
		"voice_clone",
		"asset_upload",
		"asset_management",
		"api_asset_generation",
		"error_catalog",
		"cors_preflight",
	];
	return weeks.flatMap((weekStart) =>
		endpoints.flatMap((endpoint) =>
			["all", "api_key"].map((trafficScope) => {
				const populated =
					weekStart === "2026-08-17 00:00:00" &&
					endpoint === "api_asset_generation" &&
					trafficScope === "all";
				return {
					week_start: weekStart,
					endpoint,
					traffic_scope: trafficScope,
					requests: populated ? 100 : 0,
					errors: populated ? 5 : 0,
					client_errors: populated ? 4 : 0,
					server_errors: populated ? 1 : 0,
					error_rate_pct: populated ? 5 : 0,
					p50_latency_ms: populated ? 120 : 0,
					p95_latency_ms: populated ? 450 : 0,
					top_error_class: populated ? "client_validation_error" : "none",
					asset_patch_5xx: 0,
					asset_project_not_found_422: 0,
					asset_auth_abuse_errors: 0,
					tts_voice_errors: 0,
					invalid_asset_generation_errors: populated ? 2 : 0,
					cors_5xx: 0,
				};
			}),
		),
	);
}
