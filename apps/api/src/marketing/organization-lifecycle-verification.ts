import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";

type Row = Record<string, unknown>;

const SERIES = new Set([
	"product_usage",
	"professional_qualification",
	"subscription",
]);

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

export function organizationLifecycleVerificationChecks(
	result: MetabaseResult,
): PublishVerificationCheck[] {
	const rows = records(result);
	const series = new Set(rows.map((row) => String(row.lifecycle_series)));
	const populationFailures = rows.filter((row) => {
		const starting = number(row.starting_organizations);
		const retained = number(row.retained_organizations);
		const churned = number(row.churned_organizations);
		return (
			starting !== null &&
			(retained === null || churned === null || retained + churned !== starting)
		);
	});
	const rateColumns = [
		"retention_pct",
		"churn_pct",
		"return_pct",
		"requalification_pct",
		"resubscription_pct",
	];
	const rateFailures = rows.filter((row) =>
		rateColumns.some((column) => {
			const value = number(row[column]);
			return value !== null && (value < 0 || value > 100);
		}),
	);
	const resubscriptionFailures = rows.filter((row) => {
		const eligible = number(row.resubscription_eligible_organizations);
		const resubscribed = number(row.resubscribed_organizations);
		return (
			eligible !== null &&
			(resubscribed === null || resubscribed > eligible || resubscribed < 0)
		);
	});
	const watermarks = new Set(rows.map((row) => String(row.data_through)));
	const forbiddenColumns = result.columns
		.map((column) => column.name)
		.filter((name) =>
			["organization_id", "customer_id", "email", "user_id"].includes(name),
		);
	return [
		check(
			"lifecycle_series_separation",
			SERIES.size === series.size &&
				[...SERIES].every((value) => series.has(value)),
			"Product use, professional qualification, and subscription activity must remain separate series.",
			{ series: [...series] },
		),
		check(
			"population_exclusivity",
			populationFailures.length === 0,
			"Retained and churned organizations must exactly reconcile to each starting population.",
			{ failedRows: populationFailures.length },
		),
		check(
			"bounded_rates",
			rateFailures.length === 0,
			"Every lifecycle percentage must stay between zero and one hundred.",
			{ failedRows: rateFailures.length },
		),
		check(
			"resubscription_population",
			resubscriptionFailures.length === 0,
			"Resubscribed organizations must remain inside the eligible lapsed subscription population.",
			{ failedRows: resubscriptionFailures.length },
		),
		check(
			"oldest_complete_watermark",
			rows.length > 0 && watermarks.size === 1,
			"All lifecycle series must use one complete UTC watermark.",
			{ dataThrough: [...watermarks] },
		),
		check(
			"customer_identifier_boundary",
			forbiddenColumns.length === 0,
			"The lifecycle result must not expose customer or organization identifiers.",
			{ forbiddenColumns },
		),
	];
}
