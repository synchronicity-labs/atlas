import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";

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

export function billingScorecardVerificationChecks(
	result: MetabaseResult,
): PublishVerificationCheck[] {
	const rows = records(result);
	const summaries = rows.filter((row) => row.section === "summary");
	const arms = new Set(summaries.map((row) => String(row.arm)));
	const populationsValid =
		summaries.length === 2 &&
		arms.has("v2 control") &&
		arms.has("v3 treatment") &&
		summaries.every((row) => {
			const eligible = number(row.eligible_organizations);
			const paid = number(row.paid_converters);
			return (
				eligible !== null && eligible > 0 && paid !== null && paid <= eligible
			);
		});
	const retentionValid = summaries.every((row) =>
		["30d", "60d"].every((horizon) => {
			const churn = number(row[`subscription_churn_${horizon}_pct`]);
			const retention = number(row[`subscription_retention_${horizon}_pct`]);
			return (
				(churn === null && retention === null) ||
				(churn !== null &&
					retention !== null &&
					Math.abs(churn + retention - 100) < 0.02)
			);
		}),
	);
	const renewalValid = summaries.every((row) => {
		const eligible = number(row.renewal_eligible);
		const renewed = number(row.renewed);
		const rate = number(row.renewal_rate_pct);
		if (eligible === null || renewed === null || renewed > eligible)
			return false;
		if (eligible === 0) return rate === null;
		return rate !== null && Math.abs(rate - (renewed / eligible) * 100) < 0.02;
	});
	const collectionValid = summaries.every(
		(row) =>
			(number(row.failed_invoice_count) ?? -1) >= 0 &&
			(number(row.failed_invoice_amount_usd) ?? -1) >= 0,
	);
	const watermarks = new Set(rows.map((row) => String(row.data_through)));
	const forbiddenColumns = result.columns
		.map((column) => column.name)
		.filter((name) =>
			["organization_id", "customer_id", "email", "user_id"].includes(name),
		);
	return [
		check(
			"matched_population",
			populationsValid,
			"The scorecard must contain one governed summary for each experiment arm, with paid converters inside the eligible population.",
			{ summaries: summaries.length, arms: [...arms] },
		),
		check(
			"subscription_retention_reconciliation",
			retentionValid,
			"Subscription retention and churn must sum to one hundred percent at each mature horizon.",
			{ summaries: summaries.length },
		),
		check(
			"renewal_maturity",
			renewalValid,
			"Renewed organizations must remain inside the renewal-eligible population and the rate must match the counts.",
			{ summaries: summaries.length },
		),
		check(
			"failed_invoice_reconciliation",
			collectionValid,
			"Failed-invoice counts and amounts must be non-negative.",
			{ summaries: summaries.length },
		),
		check(
			"oldest_complete_watermark",
			rows.length > 0 && watermarks.size === 1,
			"Every scorecard row must use one UTC data-through timestamp.",
			{ dataThrough: [...watermarks] },
		),
		check(
			"customer_identifier_boundary",
			forbiddenColumns.length === 0,
			"The scorecard must not expose customer or organization identifiers.",
			{ forbiddenColumns },
		),
	];
}
