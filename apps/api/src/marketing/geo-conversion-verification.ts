import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";

type Row = Record<string, unknown>;

const PROVIDERS = new Set([
	"ChatGPT",
	"Gemini",
	"Claude",
	"Perplexity",
	"Copilot",
	"Meta AI",
	"Kagi",
	"Qwen",
]);

const PROVIDER_QUERY_MARKERS = [
	"chatgpt.com",
	"gemini.google.com",
	"claude.ai",
	"perplexity.ai",
	"copilot.microsoft.com",
	"meta.ai",
	"kagi.com",
	"chat.qwen.ai",
];

const FORBIDDEN_COLUMNS = new Set([
	"distinct_id",
	"email",
	"organization_id",
	"person_id",
	"user_id",
]);

export function geoConversionVerificationChecks(
	result: MetabaseResult,
	queryText: string,
): PublishVerificationCheck[] {
	const rows = records(result);
	const cohorts = new Set(rows.map((row) => String(row.cohort_week)));
	const population =
		rows.length > 0 &&
		cohorts.size === 2 &&
		rows.every((row) => number(row.signups) > 0);
	const reconciled = rows.every((row) => {
		const signups = number(row.signups);
		const generations = number(row.first_successful_generations);
		const paid = number(row.paid_subscriptions);
		return (
			generations <= signups &&
			paid <= signups &&
			rateMatches(row.signup_to_generation_pct, generations, signups) &&
			rateMatches(row.signup_to_paid_pct, paid, signups)
		);
	});
	const normalizedQuery = queryText.toLowerCase();
	const providers = [...new Set(rows.map((row) => String(row.provider)))];
	const registryValid =
		providers.every((provider) => PROVIDERS.has(provider)) &&
		normalizedQuery.includes("person.properties.$initial_referring_domain") &&
		PROVIDER_QUERY_MARKERS.every((marker) => normalizedQuery.includes(marker));
	const maturityValid = rows.every((row) => {
		const cohort = Date.parse(String(row.cohort_week));
		const dataThrough = Date.parse(String(row.data_through));
		return (
			Number.isFinite(cohort) &&
			Number.isFinite(dataThrough) &&
			dataThrough - cohort >= 7 * 24 * 60 * 60 * 1000
		);
	});
	const exposedColumns = result.columns
		.map((column) => column.name.toLowerCase())
		.filter((name) => FORBIDDEN_COLUMNS.has(name));
	const watermarks = rows.map((row) => String(row.data_through));
	const oneWatermark = watermarks.length > 0 && new Set(watermarks).size === 1;

	return [
		check(
			"cohort_population",
			population,
			"The result must contain two complete UTC signup cohorts with at least one attributed signup in every published provider row.",
			{ rows: rows.length, cohorts: [...cohorts] },
		),
		check(
			"cohort_reconciliation",
			reconciled,
			"Generation and paid stages must remain subsets of signups, and every rate must reconcile to its counts.",
			{ rows: rows.length },
		),
		check(
			"ai_referrer_registry",
			registryValid,
			"Attribution must use the person's first recorded referring domain and the approved AI-provider registry.",
			{ providers, registryMarkersPresent: registryValid },
		),
		check(
			"seven_day_cohort_maturity",
			maturityValid,
			"Every signup cohort must have a complete seven-day product-conversion observation window.",
			{ cohorts: [...cohorts] },
		),
		check(
			"sensitive_detail_boundary",
			exposedColumns.length === 0,
			"The governed result must exclude person, user, organization, and email identifiers.",
			{ exposedColumns },
		),
		check(
			"oldest_complete_watermark",
			oneWatermark,
			"All rows must use one UTC data-through boundary for the oldest complete cohort window.",
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
