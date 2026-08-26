import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";

type Row = Record<string, unknown>;

const ARMS = new Set(["v2 control", "v3 treatment"]);
const FORBIDDEN_COLUMNS = new Set([
	"comment",
	"customer_id",
	"email",
	"organization_id",
	"user_id",
]);

export function billingDiagnosticsVerificationChecks(
	result: MetabaseResult,
): PublishVerificationCheck[] {
	const rows = records(result);
	const summaries = rows.filter((row) => row.section === "summary");
	const arms = new Set(summaries.map((row) => String(row.arm)));
	const assignmentValid =
		summaries.length === 2 &&
		arms.size === 2 &&
		[...arms].every((arm) => ARMS.has(arm)) &&
		summaries.every(
			(row) =>
				number(row.assigned) > 0 &&
				number(row.paid_converters) <= number(row.assigned),
		);
	const tiersValid = summaries.every((summary) => {
		const tiers = rows.filter(
			(row) => row.section === "tier" && row.arm === summary.arm,
		);
		return (
			tiers.length > 0 &&
			tiers.reduce((total, row) => total + number(row.assigned), 0) ===
				number(summary.assigned) &&
			tiers.reduce((total, row) => total + number(row.paid_converters), 0) ===
				number(summary.paid_converters)
		);
	});
	const topupsValid = summaries.every((row) => {
		const topupUsers = number(row.topup_users);
		const repeatUsers = number(row.repeat_topup_orgs);
		const revenue = number(row.topup_revenue_usd);
		return (
			topupUsers <= number(row.paid_converters) &&
			repeatUsers <= topupUsers &&
			revenue >= 0 &&
			(row.arm !== "v2 control" ||
				(topupUsers === 0 && repeatUsers === 0 && revenue === 0)) &&
			number(row.failed_invoice_count) >= 0 &&
			number(row.failed_invoice_amount_usd) >= 0
		);
	});
	const cancellationsValid = summaries.every(
		(row) =>
			number(row.canceled) + number(row.pending_cancel) <=
			number(row.paid_converters),
	);
	const renewalValid = summaries.every(
		(row) =>
			number(row.renewed) <= number(row.renewal_eligible) &&
			number(row.renewal_eligible) <= number(row.paid_converters),
	);
	const reasonsValid = summaries.every((summary) => {
		const reasonCount = rows
			.filter((row) => row.section === "reason" && row.arm === summary.arm)
			.reduce((total, row) => total + number(row.cancellation_reason_count), 0);
		return reasonCount === number(summary.canceled);
	});
	const exposedColumns = result.columns
		.map((column) => column.name.toLowerCase())
		.filter((name) => FORBIDDEN_COLUMNS.has(name));
	const watermarks = rows.map((row) => String(row.data_through));
	const oneWatermark = watermarks.length > 0 && new Set(watermarks).size === 1;

	return [
		check(
			"assignment_spine_parity",
			assignmentValid,
			"The diagnostic pack must contain one v2 control and one v3 treatment summary, with paid converters nested inside assigned organizations.",
			{ summaries: summaries.length, arms: [...arms] },
		),
		check(
			"tier_mapping",
			tiersValid,
			"Tier rows must exactly reconcile to assigned organizations and paid converters in each experiment arm.",
			{ arms: [...arms] },
		),
		check(
			"topup_and_collection_reconciliation",
			topupsValid,
			"Top-ups must be a v3-only subset of paid converters, repeat users must be a subset of top-up users, and collection amounts must be non-negative.",
			{ summaries: summaries.length },
		),
		check(
			"cancellation_population",
			cancellationsValid,
			"Canceled and pending-cancel organizations must remain subsets of paid converters.",
			{ summaries: summaries.length },
		),
		check(
			"renewal_maturity",
			renewalValid,
			"Renewed organizations must remain a subset of the 30-day renewal-eligible paid population.",
			{ summaries: summaries.length },
		),
		check(
			"cancellation_reason_coverage",
			reasonsValid,
			"Structured cancellation-reason rows must reconcile to canceled paid converters in each arm.",
			{ summaries: summaries.length },
		),
		check(
			"customer_text_boundary",
			exposedColumns.length === 0,
			"The governed result must exclude customer identifiers and raw cancellation comments.",
			{ exposedColumns },
		),
		check(
			"oldest_complete_watermark",
			oneWatermark,
			"All diagnostic rows must use one UTC data-through timestamp.",
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
