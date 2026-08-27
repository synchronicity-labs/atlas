import { describe, expect, test } from "bun:test";
import type {
	MetabaseClient,
	MetabaseResult,
} from "../metabase/metabase.client";
import {
	cancellationFeedbackIncentiveVerificationChecks,
	cancellationFeedbackIncentiveWeeklyReport,
} from "./cancellation-feedback-incentive";
import type { MarketingClient } from "./marketing.client";

const query = {
	source: "automated_report" as const,
	recipe: "product.cancellation-feedback-incentive-weekly" as const,
	version: 1 as const,
};

describe("cancellation feedback incentive weekly report", () => {
	test("publishes twelve complete governed weeks with verified source parity", async () => {
		const { report, productQuery, posthogQuery } = await build();
		const rows = records(report);
		const totals = rows.filter((row) => row.row_kind === "weekly_total");
		const checks = cancellationFeedbackIncentiveVerificationChecks(
			report,
			query,
		);

		expect(totals).toHaveLength(12);
		expect(checks.every((check) => check.status === "PASSED")).toBe(true);
		expect(new Set(rows.map((row) => row.data_through))).toEqual(
			new Set(["2026-08-24T00:00:00.000Z"]),
		);
		expect(report.columns.map((column) => column.name)).not.toContain(
			"organization_id",
		);
		expect(productQuery).toContain("public.cancellation_feedback");
		expect(productQuery).toContain("coalesce(banned, false)");
		expect(productQuery).not.toContain("additional_comments");
		expect(posthogQuery).toContain("person_id not in");
		expect(posthogQuery).toContain("limit 100");
		expect(posthogQuery).toContain("arrayJoin([");
		expect(posthogQuery).toContain("toTimeZone(timestamp, 'UTC'), 1");
		expect(productQuery).toContain("generate_series(");
	});

	for (const source of ["posthogRows", "productRows"] as const) {
		test(`rejects empty or truncated ${source}`, async () => {
			await expect(build({ [source]: () => [] })).rejects.toThrow(
				"all twelve requested weeks",
			);
			await expect(
				build({ [source]: (rows: unknown[][]) => rows.slice(1) }),
			).rejects.toThrow("all twelve requested weeks");
		});
	}

	test("rejects a missing week even when the source returns twelve rows", async () => {
		await expect(
			build({
				posthogRows: (rows) =>
					rows.map((row, index) =>
						index === 0 ? ["2026-08-24T00:00:00.000Z", ...row.slice(1)] : row,
					),
			}),
		).rejects.toThrow("missing the requested week");
	});

	test("rejects null measurements instead of inventing zero", async () => {
		await expect(
			build({
				posthogRows: (rows) =>
					rows.map((row, index) =>
						index === 0 ? [row[0], null, ...row.slice(2)] : row,
					),
			}),
		).rejects.toThrow("invalid measure");
	});

	test("fails verification when PostHog and Product rewards diverge", async () => {
		const { report } = await build();
		const row = records(report).find(
			(value) =>
				value.row_kind === "weekly_total" &&
				value.week_start === "2026-08-17T00:00:00.000Z",
		);
		if (!row) throw new Error("expected weekly total");
		const index = report.columns.findIndex(
			(column) => column.name === "posthog_reward_claims",
		);
		const source = report.rows.find(
			(values) =>
				values[0] === "2026-08-17T00:00:00.000Z" &&
				values[1] === "weekly_total",
		);
		if (!source) throw new Error("expected weekly source row");
		source[index] = 2;

		const check = cancellationFeedbackIncentiveVerificationChecks(
			report,
			query,
		).find((value) => value.name === "product_posthog_parity");
		expect(check?.status).toBe("FAILED");
	});
});

async function build(
	options: {
		posthogRows?: (rows: unknown[][]) => unknown[][];
		productRows?: (rows: unknown[][]) => unknown[][];
	} = {},
) {
	let productQuery = "";
	let posthogQuery = "";
	const marketing = {
		execute: async (input: { query: string }) => {
			posthogQuery = input.query;
			const payload = result(
				[
					"week_start",
					"offer_shown_organizations",
					"incentive_declines",
					"continued_cancellations",
					"saved_after_reward",
					"posthog_reward_claims",
					"posthog_call_requests",
					"posthog_reward_granted_cents",
				],
				[
					...zeroWeeks().map((week) => [week, 0, 0, 0, 0, 0, 0, 0]),
					["2026-08-17T00:00:00.000Z", 2, 1, 1, 1, 1, 1, 2500],
				],
			);
			payload.rows = options.posthogRows?.(payload.rows) ?? payload.rows;
			return payload;
		},
	} as unknown as MarketingClient;
	const metabase = {
		preview: async (input: { queryText: string }) => {
			productQuery = input.queryText;
			const payload = result(
				[
					"week_start",
					"row_kind",
					"reason",
					"feedback_submissions",
					"completed_feedback_submissions",
					"written_reward_claims",
					"call_requests",
					"reward_granted_cents",
					"reward_reversed_cents",
					"reason_responses",
				],
				[
					...zeroWeeks().map((week) => [
						week,
						"weekly_total",
						"all",
						0,
						0,
						0,
						0,
						0,
						0,
						0,
					]),
					[
						"2026-08-17T00:00:00.000Z",
						"weekly_total",
						"all",
						2,
						1,
						1,
						1,
						2500,
						0,
						0,
					],
					[
						"2026-08-17T00:00:00.000Z",
						"reason",
						"too_expensive",
						0,
						0,
						0,
						0,
						0,
						0,
						1,
					],
				],
			);
			payload.rows = options.productRows?.(payload.rows) ?? payload.rows;
			return payload;
		},
	} as unknown as MetabaseClient;
	const report = await cancellationFeedbackIncentiveWeeklyReport({
		query,
		marketing,
		metabase,
		productUserPredicate: "person_id not in ('internal-user')",
		now: new Date("2026-08-26T12:00:00.000Z"),
	});
	return { report, productQuery, posthogQuery };
}

function zeroWeeks() {
	return Array.from({ length: 11 }, (_, index) =>
		new Date(
			Date.parse("2026-06-01T00:00:00.000Z") + index * 7 * 24 * 60 * 60 * 1000,
		).toISOString(),
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
