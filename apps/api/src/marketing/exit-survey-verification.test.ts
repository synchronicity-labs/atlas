import { VerificationStatus } from "@crm/db";
import { describe, expect, test } from "bun:test";
import type { MetabaseResult } from "../metabase/metabase.client";
import { exitSurveyVerificationChecks } from "./exit-survey-verification";

const columns = [
	"week_start",
	"cancellation_requests",
	"responses",
	"response_rate_pct",
	"reason",
	"reason_count",
	"plan",
	"plan_count",
	"response_group_count",
	"dismissed_feedback_forms",
	"structured_theme",
	"source_event_rows",
	"data_through",
];

function result(rows: unknown[][]): MetabaseResult {
	return {
		columns: columns.map((name) => ({
			name,
			displayName: name,
			baseType: null,
		})),
		rows,
	};
}

const validRows = [
	[
		"2026-08-10",
		10,
		7,
		70,
		"too_expensive",
		4,
		"creator",
		5,
		3,
		2,
		"too expensive",
		10,
		"2026-08-17",
	],
	[
		"2026-08-10",
		10,
		7,
		70,
		"too_expensive",
		4,
		"hobbyist",
		2,
		1,
		2,
		"too expensive",
		10,
		"2026-08-17",
	],
	[
		"2026-08-10",
		10,
		7,
		70,
		"not_using_enough",
		3,
		"creator",
		5,
		2,
		2,
		"not using enough",
		10,
		"2026-08-17",
	],
	[
		"2026-08-10",
		10,
		7,
		70,
		"not_using_enough",
		3,
		"hobbyist",
		2,
		1,
		2,
		"not using enough",
		10,
		"2026-08-17",
	],
];

describe("exit survey verification", () => {
	test("passes a complete deduplicated weekly result", () => {
		const checks = exitSurveyVerificationChecks(
			result(validRows),
			"select survey_reason, survey_completed from events",
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(5).fill(VerificationStatus.PASSED),
		);
	});

	test("fails when response groups do not reconcile", () => {
		const rows = structuredClone(validRows);
		rows[0]![8] = 2;

		const checks = exitSurveyVerificationChecks(
			result(rows),
			"select survey_reason, survey_completed from events",
		);

		expect(
			checks.find((check) => check.name === "response_deduplication")?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("keeps a complete week with no responses", () => {
		const checks = exitSurveyVerificationChecks(
			result([
				[
					"2026-08-10",
					10,
					0,
					0,
					"no_response",
					0,
					"no_response",
					0,
					0,
					2,
					"no response",
					10,
					"2026-08-17",
				],
			]),
			"select survey_reason, survey_completed from events",
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(5).fill(VerificationStatus.PASSED),
		);
	});

	test("joins dismissals to the retained weekly total", async () => {
		const migration = await Bun.file(
			new URL(
				"../../../../packages/db/prisma/migrations/20260825171000_fix_exit_survey_dismissal_join/migration.sql",
				import.meta.url,
			),
		).text();

		expect(migration).toContain("totals.week_start");
	});

	test("fails when the query requests customer detail", () => {
		const checks = exitSurveyVerificationChecks(
			result(validRows),
			"select survey_additional_comments from events",
		);

		expect(
			checks.find((check) => check.name === "comment_privacy_boundary")?.status,
		).toBe(VerificationStatus.FAILED);
	});
});
