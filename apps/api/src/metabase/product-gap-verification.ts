import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "./metabase.client";
import type { PublishVerificationCheck } from "./product-metric.publisher";

type Row = Record<string, unknown>;

const FORBIDDEN_OUTPUTS = new Set([
	"customer_id",
	"email",
	"generation_id",
	"organization_id",
	"user_id",
]);

export function productGapVerificationChecks(
	result: MetabaseResult,
	queryText: string,
): PublishVerificationCheck[] {
	const rows = records(result);
	const summaries = rows.filter((row) => row.section === "summary");
	const normalizedQuery = queryText.toLowerCase().replaceAll(/\s+/g, " ");
	const canonicalPopulation =
		normalizedQuery.includes("sync_prod.sync_usage3") &&
		normalizedQuery.includes(
			"organizationplantype in ('hobbyist', 'creator', 'growth', 'scale')",
		) &&
		result.columns.every(
			(column) => !FORBIDDEN_OUTPUTS.has(column.name.toLowerCase()),
		);
	const activationDefinition =
		normalizedQuery.includes("generations >= 3 and active_days >= 2") &&
		summaries.every(
			(row) =>
				number(row.activated_organizations) ===
				number(row.professional_organizations) + number(row.gap_organizations),
		);
	const professionalDefinition =
		normalizedQuery.includes("accrued_value_usd >= 100") &&
		summaries.every(
			(row) =>
				number(row.professional_organizations) <=
				number(row.activated_organizations),
		);
	const breakdownReconciliation = summaries.every((summary) => {
		const month = String(summary.month);
		const gap = number(summary.gap_organizations);
		return ["plan", "generation_bucket", "output_hour_bucket"].every(
			(section) =>
				rows
					.filter(
						(row) => row.section === section && String(row.month) === month,
					)
					.reduce((total, row) => total + number(row.organization_count), 0) ===
				gap,
		);
	});
	const watermarks = new Set(rows.map((row) => String(row.data_through)));
	const summaryMonths = summaries.map((row) => String(row.month)).sort();
	const completeMonthBoundary =
		summaries.length === 2 &&
		watermarks.size === 1 &&
		Number.isFinite(Date.parse([...watermarks][0] ?? "")) &&
		summaryMonths.every((month) => Number.isFinite(Date.parse(month))) &&
		normalizedQuery.includes("generationcreatedat >= addmonths(cutoff, -2)") &&
		normalizedQuery.includes("generationcreatedat < cutoff");

	return [
		check(
			"canonical_population",
			canonicalPopulation,
			"The diagnostic must use the governed V2 self-serve usage population and publish no customer identifiers.",
			{ outputNames: result.columns.map((column) => column.name) },
		),
		check(
			"activation_definition",
			activationDefinition,
			"Activated organizations require at least three completed billable generations across two UTC days, and the summary must reconcile.",
			{ summaries },
		),
		check(
			"professional_definition",
			professionalDefinition,
			"Professional organizations must meet the activation rule and at least $100 in accrued value.",
			{ summaries },
		),
		check(
			"breakdown_reconciliation",
			breakdownReconciliation,
			"Plan, generation, and output-hour buckets must each reconcile to the activated-not-professional population.",
			{ months: summaryMonths },
		),
		check(
			"complete_month_boundary",
			completeMonthBoundary,
			"The result must contain exactly the latest two complete UTC months under one half-open watermark.",
			{ dataThrough: [...watermarks], months: summaryMonths },
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
