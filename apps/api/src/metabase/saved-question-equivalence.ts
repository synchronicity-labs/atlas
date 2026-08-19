import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "./metabase.client";
import type { PublishVerificationCheck } from "./product-metric.publisher";

const REVENUE_TOLERANCE_USD = 0.01;

export function comparePaidCustomerRevenue(
	savedQuestion: MetabaseResult,
	replacement: MetabaseResult,
	sourceQuestionNumber: number,
): PublishVerificationCheck {
	const savedRows = monthlyValues(
		savedQuestion,
		["createdAt", "month"],
		["sum", "revenue_usd"],
	);
	const replacementRows = monthlyValues(
		replacement,
		["month", "createdAt"],
		["revenue_usd", "sum"],
	);
	const comparedMonths = [...replacementRows.keys()].sort();

	if (comparedMonths.length === 0) {
		return failedCheck(
			sourceQuestionNumber,
			"The Atlas replacement returned no monthly revenue rows to compare.",
			[],
		);
	}

	const comparisons = comparedMonths.map((month) => {
		const savedValue = savedRows.get(month) ?? null;
		const replacementValue = replacementRows.get(month) ?? null;
		const differenceUsd =
			savedValue === null || replacementValue === null
				? null
				: Math.abs(savedValue - replacementValue);
		return { month, savedValue, replacementValue, differenceUsd };
	});
	const mismatches = comparisons.filter(
		(row) =>
			row.differenceUsd === null || row.differenceUsd > REVENUE_TOLERANCE_USD,
	);

	if (mismatches.length > 0) {
		return failedCheck(
			sourceQuestionNumber,
			`Metabase question ${sourceQuestionNumber} and the Atlas replacement differ for ${mismatches.length} of ${comparisons.length} compared months.`,
			comparisons,
		);
	}

	return {
		name: "saved_question_equivalence",
		status: VerificationStatus.PASSED,
		reason: `Metabase question ${sourceQuestionNumber} and the Atlas replacement match for ${comparisons.length} months within $${REVENUE_TOLERANCE_USD.toFixed(2)}.`,
		referenceValue: {
			sourceQuestionNumber,
			toleranceUsd: REVENUE_TOLERANCE_USD,
		},
		actualValue: { comparisons },
	};
}

function failedCheck(
	sourceQuestionNumber: number,
	reason: string,
	comparisons: Array<Record<string, unknown>>,
): PublishVerificationCheck {
	return {
		name: "saved_question_equivalence",
		status: VerificationStatus.FAILED,
		reason,
		referenceValue: {
			sourceQuestionNumber,
			toleranceUsd: REVENUE_TOLERANCE_USD,
		},
		actualValue: { comparisons },
	};
}

function monthlyValues(
	result: MetabaseResult,
	monthCandidates: string[],
	valueCandidates: string[],
): Map<string, number> {
	const monthIndex = columnIndex(result, monthCandidates);
	const valueIndex = columnIndex(result, valueCandidates);
	if (monthIndex === -1 || valueIndex === -1) return new Map();

	const values = new Map<string, number>();
	for (const row of result.rows) {
		const month = normalizeMonth(row[monthIndex]);
		const value = Number(row[valueIndex]);
		if (!month || !Number.isFinite(value)) continue;
		values.set(month, value);
	}
	return values;
}

function columnIndex(result: MetabaseResult, candidates: string[]): number {
	const normalizedCandidates = new Set(
		candidates.map((candidate) => candidate.toLowerCase()),
	);
	return result.columns.findIndex((column) =>
		normalizedCandidates.has(column.name.toLowerCase()),
	);
}

function normalizeMonth(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const direct = value.match(/^(\d{4}-\d{2})(?:$|-\d{2}|T)/)?.[1];
	if (direct) return direct;
	const date = new Date(value);
	return Number.isFinite(date.getTime())
		? date.toISOString().slice(0, 7)
		: null;
}
