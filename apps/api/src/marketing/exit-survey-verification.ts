import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";

const ALLOWED_REASONS = new Set([
	"confused_about_billing",
	"missing_features",
	"not_using_enough",
	"one_project_only",
	"other",
	"quality_not_good_enough",
	"switched_to_competitor",
	"technical_issues",
	"too_expensive",
]);

const FORBIDDEN_DETAIL = [
	"additional_comments",
	"survey_additional_comments",
	"competitor_name",
	"distinct_id",
	"email",
	"organization_id",
	"user_id",
];

type Row = Record<string, unknown>;

export function exitSurveyVerificationChecks(
	result: MetabaseResult,
	queryText: string,
): PublishVerificationCheck[] {
	const rows = records(result);
	const weekly = representativeWeeks(rows);
	const denominatorMatches = [...weekly.values()].every(
		(row) =>
			number(row.source_event_rows) === number(row.cancellation_requests) &&
			number(row.cancellation_requests) > 0,
	);
	const responseGroups = groupedSums(rows, "response_group_count");
	const responsesDeduplicated = [...weekly.entries()].every(
		([week, row]) =>
			number(row.responses) <= number(row.cancellation_requests) &&
			responseGroups.get(week) === number(row.responses),
	);
	const reasonsByWeek = uniqueDimensionSums(rows, "reason", "reason_count");
	const reasonsValid =
		rows.every((row) => {
			const reason = String(row.reason);
			const groupCount = number(row.response_group_count);
			return (
				(groupCount === 0 && reason === "no_response") ||
				(groupCount > 0 && ALLOWED_REASONS.has(reason))
			);
		}) &&
		[...weekly.entries()].every(
			([week, row]) => reasonsByWeek.get(week) === number(row.responses),
		);
	const normalizedQuery = queryText.toLowerCase();
	const detailPresent = [
		...result.columns.map((column) => column.name.toLowerCase()),
		...FORBIDDEN_DETAIL.filter((token) => normalizedQuery.includes(token)),
	].filter((value) => FORBIDDEN_DETAIL.includes(value));
	const privacyBoundary = detailPresent.length === 0;
	const watermarks = rows.map((row) => String(row.data_through));
	const completeWatermark =
		watermarks.length > 0 &&
		new Set(watermarks).size === 1 &&
		rows.every((row) => completeWeek(row.week_start, row.data_through));

	return [
		check(
			"cancellation_denominator_parity",
			denominatorMatches,
			"Each completed UTC week counts unique server-emitted subscription_cancel_pending event UUIDs, and the raw event count matches the unique denominator.",
			{
				weeks: weekly.size,
				mismatches: [...weekly.entries()].filter(
					([, row]) =>
						number(row.source_event_rows) !== number(row.cancellation_requests),
				).length,
			},
		),
		check(
			"response_deduplication",
			responsesDeduplicated,
			"A response is one unique cancellation-request event with survey_completed=true. Reason-plan groups must sum to the weekly response numerator.",
			{ weeks: weekly.size },
		),
		check(
			"reason_taxonomy_review",
			reasonsValid,
			"Every response uses an approved structured exit-survey reason, and weekly reason totals must equal the response numerator.",
			{
				unexpectedReasons: [
					...new Set(
						rows
							.map((row) => String(row.reason))
							.filter(
								(reason) =>
									reason !== "no_response" && !ALLOWED_REASONS.has(reason),
							),
					),
				],
			},
		),
		check(
			"comment_privacy_boundary",
			privacyBoundary,
			"The governed result and saved query exclude free text, customer identifiers, and competitor names.",
			{ forbiddenDetail: detailPresent },
		),
		check(
			"oldest_complete_watermark",
			completeWatermark,
			"The result excludes the current partial UTC week and uses one completed-week boundary as data_through.",
			{ dataThrough: [...new Set(watermarks)] },
		),
	];
}

function records(result: MetabaseResult): Row[] {
	return result.rows.map((values) =>
		Object.fromEntries(
			result.columns.map((column, index) => [
				column.name,
				values[index] ?? null,
			]),
		),
	);
}

function representativeWeeks(rows: Row[]): Map<string, Row> {
	return new Map(rows.map((row) => [String(row.week_start), row]));
}

function groupedSums(rows: Row[], field: string): Map<string, number> {
	const totals = new Map<string, number>();
	for (const row of rows) {
		const week = String(row.week_start);
		totals.set(week, (totals.get(week) ?? 0) + number(row[field]));
	}
	return totals;
}

function uniqueDimensionSums(
	rows: Row[],
	dimension: string,
	field: string,
): Map<string, number> {
	const values = new Map<string, Map<string, number>>();
	for (const row of rows) {
		const week = String(row.week_start);
		const byDimension = values.get(week) ?? new Map<string, number>();
		byDimension.set(String(row[dimension]), number(row[field]));
		values.set(week, byDimension);
	}
	return new Map(
		[...values.entries()].map(([week, byDimension]) => [
			week,
			[...byDimension.values()].reduce((total, value) => total + value, 0),
		]),
	);
}

function completeWeek(weekStart: unknown, dataThrough: unknown): boolean {
	const week = Date.parse(String(weekStart));
	const watermark = Date.parse(String(dataThrough));
	return (
		Number.isFinite(week) &&
		Number.isFinite(watermark) &&
		week < watermark &&
		watermark - week >= 7 * 24 * 60 * 60 * 1000
	);
}

function number(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function check(
	name: string,
	passed: boolean,
	reason: string,
	actualValue: unknown,
): PublishVerificationCheck {
	return {
		name,
		status: passed ? VerificationStatus.PASSED : VerificationStatus.FAILED,
		reason,
		referenceValue: { required: true },
		actualValue,
	};
}
