import { describe, expect, test } from "bun:test";
import type {
	MetabaseClient,
	MetabaseResult,
} from "../metabase/metabase.client";
import { gbrainEvidenceImport } from "./gbrain-evidence.contracts";
import type { GbrainEvidenceService } from "./gbrain-evidence.service";
import {
	modelFeedbackVerificationChecks,
	modelFeedbackWeeklyReport,
} from "./model-feedback";

const query = {
	source: "model_feedback" as const,
	report: "weekly-coverage" as const,
	version: 1 as const,
};

describe("model feedback weekly report", () => {
	test("keeps product feedback and deidentified support evidence separate", async () => {
		const report = await modelFeedbackWeeklyReport({
			query,
			now: new Date("2026-08-26T12:00:00.000Z"),
			metabase: fakeMetabase(),
			evidence: fakeEvidence(),
		});
		const rows = records(report);

		expect(
			rows.filter((row) => row.surface === "product_feedback"),
		).toHaveLength(4);
		expect(
			rows.filter((row) => row.surface === "support_negative"),
		).toHaveLength(2);
		expect(
			modelFeedbackVerificationChecks(report, query).map((check) => [
				check.name,
				check.status,
			]),
		).toEqual([
			["feedback_denominator_parity", "PASSED"],
			["model_mapping", "PASSED"],
			["support_evidence_join", "PASSED"],
			["customer_text_boundary", "PASSED"],
			["oldest_complete_watermark", "PASSED"],
		]);
		expect(report.columns.map((column) => column.name)).not.toContain("text");
		expect(
			rows.find(
				(row) => row.surface === "product_feedback" && row.model === "2-pro",
			),
		).toMatchObject({
			negative_rate_pct: 25,
			coverage_pct: 20,
			support_negative_tickets: 0,
		});
	});

	test("fails closed when the complete week has no gBrain snapshot", async () => {
		await expect(
			modelFeedbackWeeklyReport({
				query,
				now: new Date("2026-08-26T12:00:00.000Z"),
				metabase: fakeMetabase(),
				evidence: {
					latestForWeek: async () => null,
				} as unknown as GbrainEvidenceService,
			}),
		).rejects.toThrow("no gBrain evidence snapshot");
	});

	test("rejects duplicate or unreconciled support aggregates", () => {
		const payload = {
			weekStart: "2026-08-17T00:00:00.000Z",
			dataThrough: "2026-08-24T00:00:00.000Z",
			sourceItemCount: 3,
			rows: [
				{ model: "2", supportTheme: "general_quality", count: 1 },
				{ model: "2", supportTheme: "general_quality", count: 1 },
			],
		};

		expect(gbrainEvidenceImport.safeParse(payload).success).toBe(false);
	});
});

function fakeMetabase() {
	return {
		preview: async () =>
			result(
				[
					"model",
					"completed_generations",
					"rated_generations",
					"feedback_events",
					"positive_feedback",
					"negative_feedback",
					"negative_rate_pct",
					"coverage_pct",
				],
				[
					["1.9", 100, 10, 10, 8, 2, 20, 10],
					["2", 100, 20, 22, 20, 2, 9.09, 20],
					["2-pro", 100, 20, 20, 15, 5, 25, 20],
					["3", 100, 25, 30, 27, 3, 10, 25],
				],
			),
	} as unknown as MetabaseClient;
}

function fakeEvidence() {
	return {
		latestForWeek: async () => ({
			weekStart: "2026-08-17T00:00:00.000Z",
			dataThrough: "2026-08-24T00:00:00.000Z",
			sourceItemCount: 3,
			rows: [
				{ model: "2", supportTheme: "general_quality", count: 2 },
				{ model: "3", supportTheme: "visual_artifacts", count: 1 },
			],
		}),
	} as unknown as GbrainEvidenceService;
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
