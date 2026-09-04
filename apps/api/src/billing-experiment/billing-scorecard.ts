import type { MetabaseResult } from "../metabase/metabase.client";
import type { BillingExperimentArmReadout } from "./billing-experiment.service";

type Row = Record<string, unknown>;

function column(name: string, displayName: string, baseType = "type/Decimal") {
	return { name, displayName, baseType };
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

function number(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function percent(numerator: unknown, denominator: unknown): number | null {
	const numeratorValue = number(numerator);
	const denominatorValue = number(denominator);
	if (
		numeratorValue === null ||
		denominatorValue === null ||
		denominatorValue <= 0
	) {
		return null;
	}
	return Math.round((numeratorValue / denominatorValue) * 10_000) / 100;
}

function armLabel(arm: BillingExperimentArmReadout["arm"]): string {
	return arm === "v2_control" ? "v2 control" : "v3 treatment";
}

export function buildBillingScorecard(input: {
	asOf: string;
	arms: BillingExperimentArmReadout[];
	diagnostics: MetabaseResult;
}): MetabaseResult {
	const diagnosticRows = records(input.diagnostics);
	const readoutByArm = new Map(
		input.arms.map((arm) => [armLabel(arm.arm), arm]),
	);
	const rows = diagnosticRows.map((diagnostic) => {
		const arm = String(diagnostic.arm ?? "");
		const readout = readoutByArm.get(arm);
		const summary = diagnostic.section === "summary";
		const churn30 = summary ? (readout?.churn30dPct ?? null) : null;
		const churn60 = summary ? (readout?.churn60dPct ?? null) : null;
		return [
			diagnostic.section,
			arm,
			diagnostic.tier,
			summary
				? (readout?.assignedOrgs ?? diagnostic.assigned)
				: diagnostic.assigned,
			summary
				? (readout?.paidOrgs ?? diagnostic.paid_converters)
				: diagnostic.paid_converters,
			summary ? (readout?.paidConversionPct ?? null) : null,
			summary ? (readout?.cashEligibleOrgs ?? null) : null,
			summary ? (readout?.cashUsd ?? null) : null,
			summary ? (readout?.paidMonths ?? null) : null,
			summary ? (readout?.cashPerPaidOrgMonthUsd ?? null) : null,
			summary ? (readout?.eligible30d ?? null) : null,
			summary ? (readout?.churned30d ?? null) : null,
			churn30,
			churn30 === null ? null : Math.round((100 - churn30) * 100) / 100,
			summary ? (readout?.eligible60d ?? null) : null,
			summary ? (readout?.churned60d ?? null) : null,
			churn60,
			churn60 === null ? null : Math.round((100 - churn60) * 100) / 100,
			summary ? (readout?.impliedLifetimeMonths ?? null) : null,
			summary ? (readout?.impliedCashLtvUsd ?? null) : null,
			diagnostic.topup_users,
			diagnostic.topup_revenue_usd,
			diagnostic.repeat_topup_orgs,
			diagnostic.canceled,
			diagnostic.pending_cancel,
			diagnostic.renewal_eligible,
			diagnostic.renewed,
			percent(diagnostic.renewed, diagnostic.renewal_eligible),
			diagnostic.failed_invoice_count,
			diagnostic.failed_invoice_amount_usd,
			diagnostic.cancellation_reason,
			diagnostic.cancellation_reason_count,
			diagnostic.data_through ?? input.asOf,
		];
	});
	return {
		columns: [
			column("section", "Section", "type/Text"),
			column("arm", "Experiment arm", "type/Text"),
			column("tier", "Paid tier", "type/Text"),
			column(
				"eligible_organizations",
				"Eligible organizations",
				"type/Integer",
			),
			column("paid_converters", "Paid converters", "type/Integer"),
			column("paid_conversion_pct", "Paid conversion (%)"),
			column(
				"cash_eligible_organizations",
				"14-day cash sample",
				"type/Integer",
			),
			column("cash_usd", "Cash collected"),
			column("paid_months", "Paid months"),
			column("cash_per_paid_org_month_usd", "Cash / paid-org month"),
			column("subscription_mature_30d", "30-day mature", "type/Integer"),
			column("subscription_churned_30d", "Churned by day 30", "type/Integer"),
			column("subscription_churn_30d_pct", "30-day subscription churn (%)"),
			column(
				"subscription_retention_30d_pct",
				"30-day subscription retention (%)",
			),
			column("subscription_mature_60d", "60-day mature", "type/Integer"),
			column("subscription_churned_60d", "Churned by day 60", "type/Integer"),
			column("subscription_churn_60d_pct", "60-day subscription churn (%)"),
			column(
				"subscription_retention_60d_pct",
				"60-day subscription retention (%)",
			),
			column("implied_lifetime_months", "Implied lifetime (months)"),
			column("implied_cash_ltv_usd", "Implied cash LTV"),
			column("topup_users", "Top-up organizations", "type/Integer"),
			column("topup_revenue_usd", "Top-up revenue"),
			column(
				"repeat_topup_orgs",
				"Repeat top-up organizations",
				"type/Integer",
			),
			column("canceled", "Canceled paid converters", "type/Integer"),
			column("pending_cancel", "Pending cancellation", "type/Integer"),
			column("renewal_eligible", "Renewal eligible", "type/Integer"),
			column("renewed", "Renewed organizations", "type/Integer"),
			column("renewal_rate_pct", "Renewal rate (%)"),
			column(
				"failed_invoice_count",
				"Failed or unpaid invoices",
				"type/Integer",
			),
			column("failed_invoice_amount_usd", "Failed or unpaid amount"),
			column("cancellation_reason", "Cancellation reason", "type/Text"),
			column(
				"cancellation_reason_count",
				"Cancellation reason count",
				"type/Integer",
			),
			column("data_through", "Data through", "type/DateTime"),
		],
		rows,
	};
}
