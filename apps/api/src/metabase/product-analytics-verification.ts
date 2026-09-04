import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "./metabase.client";
import type { PublishVerificationCheck } from "./product-metric.publisher";

type Row = Record<string, unknown>;

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

function number(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
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

function identifierBoundary(result: MetabaseResult): PublishVerificationCheck {
	const forbiddenColumns = result.columns
		.map((column) => column.name)
		.filter((name) =>
			["organization_id", "customer_id", "email", "user_id"].includes(name),
		);
	return check(
		"customer_identifier_boundary",
		forbiddenColumns.length === 0,
		"The result must not expose customer or organization identifiers.",
		{ forbiddenColumns },
	);
}

function watermark(rows: Row[]): PublishVerificationCheck {
	const watermarks = new Set(rows.map((row) => String(row.data_through)));
	return check(
		"oldest_complete_watermark",
		rows.length > 0 && watermarks.size === 1,
		"Every row must use one complete UTC data-through boundary.",
		{ dataThrough: [...watermarks] },
	);
}

function bounded(rows: Row[], columns: string[]): PublishVerificationCheck {
	const failedRows = rows.filter((row) =>
		columns.some((column) => {
			const value = number(row[column]);
			return value !== null && (value < 0 || value > 100);
		}),
	);
	return check(
		"bounded_rates",
		failedRows.length === 0,
		"Every published percentage must stay between zero and one hundred.",
		{ failedRows: failedRows.length },
	);
}

export function attributionOutcomeVerificationChecks(
	result: MetabaseResult,
): PublishVerificationCheck[] {
	const rows = records(result);
	const names = new Set(result.columns.map((column) => column.name));
	const provenanceColumns = [
		"first_touch_source",
		"utm_source",
		"utm_medium",
		"campaign",
		"landing_subdomain",
		"referring_domain",
		"first_touch_date",
	];
	const populationFailures = rows.filter((row) => {
		const signups = number(row.signups);
		if (signups === null || signups < 5) return true;
		return [
			"first_generations",
			"activated_organizations",
			"professional_organizations",
			"paid_conversions",
			"unknown_attribution_organizations",
		].some((column) => {
			const value = number(row[column]);
			return value === null || value < 0 || value > signups;
		});
	});
	const unknownFailures = rows.filter((row) => {
		const source = String(row.first_touch_source);
		const unknown = number(row.unknown_attribution_organizations);
		const signups = number(row.signups);
		return (
			unknown === null ||
			signups === null ||
			(source === "unknown" ? unknown !== signups : unknown !== 0)
		);
	});
	return [
		check(
			"attribution_provenance",
			provenanceColumns.every((column) => names.has(column)),
			"Stored source, UTM, domain, and first-touch fields must remain in the result.",
			{ columns: provenanceColumns.filter((column) => names.has(column)) },
		),
		check(
			"population_nesting",
			populationFailures.length === 0,
			"First generation, activation, professional, paid, and unknown counts must remain inside signups.",
			{ failedRows: populationFailures.length },
		),
		bounded(rows, [
			"first_generation_pct",
			"activation_pct",
			"professional_pct",
			"paid_conversion_pct",
			"w1_generation_retention_pct",
			"w2_generation_retention_pct",
			"m1_professional_retention_pct",
			"m3_professional_retention_pct",
			"unknown_attribution_pct",
		]),
		check(
			"unknown_coverage",
			unknownFailures.length === 0,
			"Unknown attribution counts must remain explicit and reconcile to the source label.",
			{ failedRows: unknownFailures.length },
		),
		watermark(rows),
		identifierBoundary(result),
	];
}

export function cohortOutcomeVerificationChecks(
	result: MetabaseResult,
): PublishVerificationCheck[] {
	const rows = records(result);
	const anchorFailures = rows.filter((row) => {
		const cohort = String(row.signup_cohort ?? "");
		const size = number(row.cohort_size);
		return !cohort || size === null || size < 5;
	});
	const historyFailures = rows.filter((row) => {
		const firstGenerationRate = number(row.first_generation_completion_pct);
		if (firstGenerationRate === null) return true;
		if (firstGenerationRate === 0) return false;
		return (
			String(row.model ?? "") === "" ||
			String(row.surface ?? "") === "" ||
			String(row.workflow ?? "") === ""
		);
	});
	const maturityPairs = [
		["w1_generation_retention_pct", "mature_w1"],
		["w2_generation_retention_pct", "mature_w2"],
		["m1_generation_retention_pct", "mature_m1"],
		["m3_generation_retention_pct", "mature_m3"],
		["m1_professional_retention_pct", "mature_professional_m1"],
		["m3_professional_retention_pct", "mature_professional_m3"],
	] as const;
	const maturityFailures = rows.filter((row) => {
		const size = number(row.cohort_size) ?? -1;
		return maturityPairs.some(([rateColumn, matureColumn]) => {
			const mature = number(row[matureColumn]);
			const rate = number(row[rateColumn]);
			return (
				mature === null ||
				mature < 0 ||
				mature > size ||
				(mature > 0 && rate === null)
			);
		});
	});
	return [
		check(
			"cohort_anchor_parity",
			anchorFailures.length === 0,
			"Every cell must use one valid signup cohort and the minimum cell size.",
			{ failedRows: anchorFailures.length },
		),
		check(
			"first_generation_history",
			historyFailures.length === 0,
			"Completed-generation cells must retain their earliest model, surface, and workflow dimensions.",
			{ failedRows: historyFailures.length },
		),
		check(
			"mature_cohort_count",
			maturityFailures.length === 0,
			"Every retention rate must use a non-negative mature denominator inside its cohort.",
			{ failedRows: maturityFailures.length },
		),
		bounded(rows, [
			"first_generation_completion_pct",
			"model_workflow_adoption_pct",
			...maturityPairs.map(([rateColumn]) => rateColumn),
			"professional_qualification_pct",
			"paid_conversion_pct",
		]),
		watermark(rows),
		identifierBoundary(result),
	];
}
