import { describe, expect, test } from "bun:test";
import type {
	MetabaseClient,
	MetabaseResult,
} from "../metabase/metabase.client";
import {
	apiAdoptionVerificationChecks,
	apiAdoptionWeeklyReport,
} from "./api-adoption";

const query = {
	source: "api_adoption" as const,
	report: "weekly-adoption" as const,
	version: 1 as const,
};

describe("API adoption weekly report", () => {
	test("publishes two complete weeks under the governed endpoint registry", async () => {
		const report = await apiAdoptionWeeklyReport({
			query,
			now: new Date("2026-08-26T12:00:00.000Z"),
			metabase: fakeMetabase(),
		});
		const rows = records(report);
		const checks = apiAdoptionVerificationChecks(report, query);

		expect(rows).toHaveLength(6);
		expect(checks.every((check) => check.status === "PASSED")).toBe(true);
		expect(
			rows.find(
				(row) =>
					row.week_start === "2026-08-17T00:00:00.000Z" &&
					row.endpoint === "api_asset_generation",
			),
		).toMatchObject({
			requests: 2,
			successful_jobs: 1,
			failed_jobs: 1,
			active_organizations: 1,
			accrued_usage_usd: 2.5,
		});
		expect(report.columns.map((column) => column.name)).not.toContain(
			"api_key_id",
		);
	});

	test("fails closed when an activity principal cannot be resolved", async () => {
		const metabase = fakeMetabase(false);
		expect(
			apiAdoptionWeeklyReport({
				query,
				now: new Date("2026-08-26T12:00:00.000Z"),
				metabase,
			}),
		).rejects.toThrow("API adoption identity join is incomplete");
	});

	test("attributes asset-backed generations through the qualifying asset key", async () => {
		let generationQuery = "";
		await apiAdoptionWeeklyReport({
			query,
			now: new Date("2026-08-26T12:00:00.000Z"),
			metabase: fakeMetabase(true, (queryText) => {
				if (queryText.includes("from public.generations")) {
					generationQuery = queryText;
				}
			}),
		});

		expect(generationQuery).toContain("video.api_key_id");
		expect(generationQuery).toContain("audio.api_key_id");
		expect(generationQuery).toContain("__IDENTITY_CONFLICT__");
		expect(generationQuery.indexOf("video.api_key_id::text")).toBeLessThan(
			generationQuery.indexOf("g.api_key_id::text"),
		);
	});
});

function fakeMetabase(
	resolvePrincipal = true,
	onQuery?: (queryText: string) => void,
) {
	return {
		preview: async (input: { queryText: string }) => {
			onQuery?.(input.queryText);
			if (input.queryText.includes("sync_usage_integration_tts")) {
				return activity([
					["2026-08-10", "user-1", "key-1", "org-1", 8, 8, 0, 800, 1.25],
					["2026-08-17", "user-1", "key-1", "org-1", 10, 10, 0, 1000, 1.5],
				]);
			}
			if (input.queryText.includes("sync_usage3")) {
				return activity([
					["2026-08-17", "user-1", "key-1", "org-1", 0, 0, 0, 1, 2.5],
				]);
			}
			if (input.queryText.includes("from public.assets")) {
				return activity([
					["2026-08-17", "user-1", "key-1", "org-1", 3, 3, 0, 3, 0],
				]);
			}
			if (input.queryText.includes("from public.generations")) {
				return activity([
					["2026-08-17", "user-1", "key-1", "org-1", 2, 1, 1, 0, 0],
				]);
			}
			if (input.queryText.includes("from public.api_keys")) {
				return result(
					[
						"principal_type",
						"principal_id",
						"owner_user_id",
						"organization_id",
						"eligible",
					],
					resolvePrincipal ? [["api", "key-1", "user-1", "org-1", true]] : [],
				);
			}
			throw new Error(`Unexpected test query: ${input.queryText}`);
		},
	} as unknown as MetabaseClient;
}

function activity(rows: unknown[][]) {
	return result(
		[
			"week_start",
			"user_id",
			"api_key_id",
			"organization_id",
			"requests",
			"successful_jobs",
			"failed_jobs",
			"usage_amount",
			"accrued_usage_usd",
		],
		rows,
	);
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
