import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";
import type { MarketingQuery } from "./marketing.contracts";

type InsightQuery = Extract<MarketingQuery, { source: "posthog_insight" }>;
type Row = Record<string, unknown>;

const FORBIDDEN_COLUMNS = new Set([
	"customer_id",
	"distinct_id",
	"email",
	"organization_id",
	"person_id",
	"user_id",
]);

export function studioInsightVerificationChecks(
	result: MetabaseResult,
	query: InsightQuery,
): PublishVerificationCheck[] {
	const rows = records(result);
	const definitionExact = definitionMatches(query);
	const populated =
		rows.length > 0 && rows.every((row) => population(row, query));
	const reconciled = rows.every((row) => reconciliation(row, query));
	const mature = rows.every((row) => maturity(row, query));
	const exposedColumns = result.columns
		.map((column) => column.name.toLowerCase())
		.filter((name) => FORBIDDEN_COLUMNS.has(name));
	const watermarks = rows.map((row) => String(row.data_through));
	const windowEnds = rows.map((row) => String(row.window_end));
	const oneWatermark =
		watermarks.length > 0 &&
		new Set(watermarks).size === 1 &&
		windowEnds.every((value, index) => value === watermarks[index]);

	return [
		check(
			"native_insight_definition",
			definitionExact,
			"The native PostHog query must match the approved Studio funnel or retention definition and filter test accounts.",
			{ mode: query.mode, definitionExact },
		),
		check(
			"period_population",
			populated,
			"Every published period or cohort must contain a valid denominator and non-negative output values.",
			{ rows: rows.length },
		),
		check(
			"metric_reconciliation",
			reconciled,
			"Published conversion and retention rates must reconcile to their counts, and time-to-magic outputs must remain positive.",
			{ rows: rows.length },
		),
		check(
			"cohort_maturity",
			mature,
			"Every result must use a complete source period. Week-two retention cohorts require a full three-week observation window.",
			{ rows: rows.length },
		),
		check(
			"sensitive_detail_boundary",
			exposedColumns.length === 0,
			"The governed result must exclude person, customer, user, organization, and email identifiers.",
			{ exposedColumns },
		),
		check(
			"complete_period_watermark",
			oneWatermark,
			"All rows must use one complete observation window and matching data-through boundary.",
			{
				dataThrough: [...new Set(watermarks)],
				windowEnd: [...new Set(windowEnds)],
			},
		),
	];
}

function definitionMatches(query: InsightQuery): boolean {
	const source = query.query.source as Record<string, unknown>;
	if (source.filterTestAccounts !== true) return false;
	if (query.mode === "retention_week_two") {
		const filter = object(source.retentionFilter);
		return (
			source.kind === "RetentionQuery" &&
			noAdditionalFilters(source.properties) &&
			filter.period === "Week" &&
			filter.retentionType === "retention_recurring" &&
			number(filter.totalIntervals) >= 3 &&
			entityIsGeneration(filter.targetEntity) &&
			entityIsGeneration(filter.returningEntity)
		);
	}
	const series = Array.isArray(source.series) ? source.series : [];
	const events = series.map((item) => String(object(item).event ?? ""));
	const funnel = object(source.funnelsFilter);
	if (query.mode === "funnel_conversion") {
		return (
			source.kind === "FunnelsQuery" &&
			noAdditionalFilters(source.properties) &&
			JSON.stringify(events) ===
				JSON.stringify(["user_signed_up", "subscription_created"]) &&
			funnel.funnelOrderType === "ordered" &&
			number(funnel.funnelWindowInterval) === 6 &&
			funnel.funnelWindowIntervalUnit === "week"
		);
	}
	return (
		source.kind === "FunnelsQuery" &&
		noAdditionalFilters(source.properties) &&
		JSON.stringify(events) ===
			JSON.stringify([
				"$pageview",
				"user_signed_up",
				"playground_started_generation",
				"playground_completed_generation",
			]) &&
		number(funnel.funnelFromStep) === 1 &&
		number(funnel.funnelToStep) === 3 &&
		funnel.funnelVizType === "time_to_convert" &&
		number(funnel.funnelWindowInterval) === 30 &&
		funnel.funnelWindowIntervalUnit === "minute" &&
		generationStepExcluded(series[2], ["plugin_premiere", "agent"]) &&
		generationStepExcluded(series[3], ["plugin_premiere", "agent"])
	);
}

function entityIsGeneration(value: unknown): boolean {
	const entity = object(value);
	return (
		entity.id === "playground_completed_generation" &&
		generationStepExcluded(entity, ["plugin_premiere"])
	);
}

function generationStepExcluded(
	value: unknown,
	requiredValues: string[],
): boolean {
	const properties = Array.isArray(object(value).properties)
		? (object(value).properties as unknown[])
		: [];
	return (
		properties.length === 1 &&
		properties.some((property) => {
			const filter = object(property);
			const values = Array.isArray(filter.value)
				? filter.value.map(String).sort()
				: [];
			return (
				filter.key === "source" &&
				filter.operator === "is_not" &&
				JSON.stringify(values) === JSON.stringify([...requiredValues].sort())
			);
		})
	);
}

function noAdditionalFilters(value: unknown): boolean {
	return value === undefined || (Array.isArray(value) && value.length === 0);
}

function population(row: Row, query: InsightQuery): boolean {
	if (query.mode === "funnel_time_to_convert") {
		return nonNegative(row.median_seconds) && nonNegative(row.converted_users);
	}
	if (query.mode === "funnel_conversion") {
		return number(row.signups) > 0 && nonNegative(row.subscriptions);
	}
	return number(row.cohort_users) > 0 && nonNegative(row.week_two_users);
}

function reconciliation(row: Row, query: InsightQuery): boolean {
	if (query.mode === "funnel_time_to_convert") {
		return number(row.median_seconds) > 0 && number(row.average_seconds) > 0;
	}
	if (query.mode === "funnel_conversion") {
		const denominator = number(row.signups);
		const numerator = number(row.subscriptions);
		return (
			numerator <= denominator &&
			rateMatches(row.conversion_pct, numerator, denominator)
		);
	}
	const denominator = number(row.cohort_users);
	const numerator = number(row.week_two_users);
	return (
		numerator <= denominator &&
		rateMatches(row.week_two_retention_pct, numerator, denominator)
	);
}

function maturity(row: Row, query: InsightQuery): boolean {
	const startField =
		query.mode === "retention_week_two" ? "cohort_week" : "period_start";
	const start = Date.parse(String(row[startField]));
	const dataThrough = Date.parse(String(row.data_through));
	if (!Number.isFinite(start) || !Number.isFinite(dataThrough)) return false;
	if (query.mode === "retention_week_two") {
		return dataThrough - start >= 21 * 24 * 60 * 60 * 1000;
	}
	const periodEnd = new Date(start);
	if (query.grain === "week") {
		periodEnd.setUTCDate(periodEnd.getUTCDate() + 7);
	} else {
		periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
	}
	if (query.mode === "funnel_conversion") {
		periodEnd.setUTCDate(periodEnd.getUTCDate() + 42);
	}
	return dataThrough >= periodEnd.getTime();
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

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function number(value: unknown): number {
	return Number(value);
}

function nonNegative(value: unknown): boolean {
	const parsed = number(value);
	return Number.isFinite(parsed) && parsed >= 0;
}

function rateMatches(value: unknown, numerator: number, denominator: number) {
	const expected = denominator > 0 ? (numerator / denominator) * 100 : 0;
	return Math.abs(number(value) - expected) <= 0.011;
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
