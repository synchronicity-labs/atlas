import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";

type Row = Record<string, unknown>;

const FORBIDDEN_COLUMNS = new Set([
	"customer_id",
	"distinct_id",
	"email",
	"organization_id",
	"person_id",
	"user_id",
]);

export function studioPeriodVerificationChecks(
	result: MetabaseResult,
	queryText: string,
): PublishVerificationCheck[] {
	const rows = records(result);
	const populated =
		rows.length > 0 &&
		rows.every(
			(row) =>
				Number.isFinite(Date.parse(String(row.period_start))) &&
				nonNegative(row.generated_hours) &&
				nonNegative(row.new_subscriptions) &&
				nonNegative(row.new_logos) &&
				nonNegative(row.expanded_logos) &&
				nonNegative(row.churned_logos),
		);
	const logosReconcile = rows.every(
		(row) =>
			number(row.net_logo_growth) ===
			number(row.new_logos) +
				number(row.expanded_logos) -
				number(row.churned_logos),
	);
	const normalizedQuery = queryText.toLowerCase();
	const organizationDeduplication =
		normalizedQuery.includes("uniqexactif(") &&
		normalizedQuery.includes("properties.organization_id") &&
		normalizedQuery.includes(
			"uniqexactif(uuid, event = 'subscription_created'",
		) &&
		normalizedQuery.includes("properties.old_plan") &&
		!normalizedQuery.includes("properties.oldplan");
	const premiereExcluded =
		normalizedQuery.includes("playground_completed_generation") &&
		normalizedQuery.includes("properties.source") &&
		normalizedQuery.includes("!= 'plugin_premiere'");
	const exposedColumns = result.columns
		.map((column) => column.name.toLowerCase())
		.filter((name) => FORBIDDEN_COLUMNS.has(name));
	const watermarks = rows.map((row) => String(row.data_through));
	const completePeriods =
		watermarks.length > 0 &&
		new Set(watermarks).size === 1 &&
		rows.every((row) => {
			const periodStart = Date.parse(String(row.period_start));
			const dataThrough = Date.parse(String(row.data_through));
			return (
				Number.isFinite(periodStart) &&
				Number.isFinite(dataThrough) &&
				periodStart < dataThrough
			);
		}) &&
		normalizedQuery.includes("totimezone(timestamp, 'utc')") &&
		normalizedQuery.includes("todateTime".toLowerCase());

	return [
		check(
			"period_population",
			populated,
			"Every published period must contain non-negative Studio delivery and subscription movement values.",
			{ periods: rows.length },
		),
		check(
			"logo_movement_reconciliation",
			logosReconcile,
			"Net logo growth must equal new logos plus expanded logos minus churned logos in every period.",
			{ periods: rows.length },
		),
		check(
			"organization_deduplication",
			organizationDeduplication,
			"Logo movement must count each organization once, use the current old_plan event property, and keep source-event subscription counts separate.",
			{ organizationDeduplication },
		),
		check(
			"premiere_exclusion",
			premiereExcluded,
			"Generated Studio hours must exclude Premiere-plugin activity.",
			{ premiereExcluded },
		),
		check(
			"sensitive_detail_boundary",
			exposedColumns.length === 0,
			"The governed result must exclude person, customer, user, organization, and email identifiers.",
			{ exposedColumns },
		),
		check(
			"complete_period_watermark",
			completePeriods,
			"All rows must use one explicit UTC boundary and exclude the current partial period.",
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
	return Number(value);
}

function nonNegative(value: unknown): boolean {
	const parsed = number(value);
	return Number.isFinite(parsed) && parsed >= 0;
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
