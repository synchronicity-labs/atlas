import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";

type Row = Record<string, unknown>;

const FORBIDDEN_COLUMNS = new Set([
	"distinct_id",
	"email",
	"organization_id",
	"person_id",
	"user_id",
]);

export function lipsyncFunnelVerificationChecks(
	result: MetabaseResult,
	queryText: string,
): PublishVerificationCheck[] {
	const rows = records(result);
	const nonEmptyCohorts =
		rows.length > 0 && rows.every((row) => number(row.signups) > 0);
	const orderedStages = rows.every((row) => {
		const signups = number(row.signups);
		const projects = number(row.projects_started);
		const generations = number(row.successful_generations);
		const paid = number(row.paid_subscriptions);
		return (
			projects <= signups &&
			generations <= projects &&
			paid <= signups &&
			rateMatches(row.signup_to_project_pct, projects, signups) &&
			rateMatches(row.signup_to_generation_pct, generations, signups) &&
			rateMatches(row.signup_to_paid_pct, paid, signups)
		);
	});
	const normalizedQuery = queryText.toLowerCase();
	const attributionDefined =
		normalizedQuery.includes("person.properties.$initial_referring_domain") &&
		normalizedQuery.includes("'lipsync.com'") &&
		normalizedQuery.includes("'www.lipsync.com'") &&
		!normalizedQuery.includes("properties.$referring_domain");
	const matureCohorts = rows.every((row) => {
		const cohort = Date.parse(String(row.cohort_week));
		const dataThrough = Date.parse(String(row.data_through));
		return (
			Number.isFinite(cohort) &&
			Number.isFinite(dataThrough) &&
			dataThrough - cohort >= 7 * 24 * 60 * 60 * 1000
		);
	});
	const watermarks = rows.map((row) => String(row.data_through));
	const oneWatermark = watermarks.length > 0 && new Set(watermarks).size === 1;
	const exposedColumns = result.columns
		.map((column) => column.name.toLowerCase())
		.filter((name) => FORBIDDEN_COLUMNS.has(name));

	return [
		check(
			"lipsync_signup_cohort_population",
			nonEmptyCohorts,
			"Every published cohort must contain at least one clean-user signup attributed to lipsync.com.",
			{ cohorts: rows.length },
		),
		check(
			"funnel_ordering",
			orderedStages,
			"Project and successful-generation stages are nested inside the signup cohort. Paid conversion is a separate subset of the same signup cohort. Every rate must reconcile to its counts.",
			{ cohorts: rows.length },
		),
		check(
			"referral_definition",
			attributionDefined,
			"Product conversion uses the person's first recorded referring domain and the approved lipsync.com domain registry.",
			{ usesInitialReferrer: attributionDefined },
		),
		check(
			"seven_day_cohort_maturity",
			matureCohorts,
			"Each signup cohort has a complete seven-day product-conversion observation window.",
			{ cohorts: rows.length },
		),
		check(
			"sensitive_detail_boundary",
			exposedColumns.length === 0,
			"The governed result excludes person, user, organization, and email identifiers.",
			{ exposedColumns },
		),
		check(
			"oldest_complete_watermark",
			oneWatermark,
			"All rows use one UTC data-through boundary for the oldest complete cohort window.",
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
