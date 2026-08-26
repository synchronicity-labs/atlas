import { VerificationStatus } from "@crm/db";
import type {
	MetabaseClient,
	MetabaseResult,
} from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";
import type { MarketingQuery } from "./marketing.contracts";

type AdobePluginQuery = Extract<MarketingQuery, { source: "adobe_plugin" }>;
type NativeInsight = (query: unknown) => Promise<unknown>;
type Row = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE_FILTER = [
	{
		key: "source",
		type: "event",
		value: ["plugin_premiere"],
		operator: "exact",
	},
];
const NPS_SOURCE = `public.user_onboardings
where type = 'adobePluginNps'
  and version = 1
  and values is not null`;

export async function adobePluginWeeklyReport(input: {
	query: AdobePluginQuery;
	nativeInsight: NativeInsight;
	metabase: MetabaseClient;
	now?: Date;
}): Promise<MetabaseResult> {
	const boundary = completeWeekBoundary(input.now ?? new Date());
	const latest = period(boundary, 7, 0);
	const prior = period(boundary, 14, 7);
	const activationStart = new Date(boundary.getTime() - 32 * DAY_MS);
	const activationEnd = new Date(boundary.getTime() - 2 * DAY_MS);
	const retentionStart = new Date(boundary.getTime() - 10 * 7 * DAY_MS);
	const npsBoundary = boundary.toISOString();

	const [
		allTimeInstalls,
		latestInstalls,
		priorInstalls,
		retention,
		powerRetention,
		activation,
		twoDayActivation,
		postGeneration,
		npsSummary,
		npsDistribution,
		npsStatuses,
	] = await Promise.all([
		input.nativeInsight(
			trendsQuery(
				[eventsNode("plugin_installed", "dau")],
				{ date_from: "all", date_to: inclusiveEnd(boundary) },
				"month",
			),
		),
		input.nativeInsight(
			trendsQuery(
				[eventsNode("plugin_installed", "dau")],
				dateRange(latest.start, latest.end),
				"week",
			),
		),
		input.nativeInsight(
			trendsQuery(
				[eventsNode("plugin_installed", "dau")],
				dateRange(prior.start, prior.end),
				"week",
			),
		),
		input.nativeInsight(retentionQuery(retentionStart, boundary, false)),
		input.nativeInsight(retentionQuery(retentionStart, boundary, true)),
		input.nativeInsight(activationQuery(latest.start, latest.end)),
		input.nativeInsight(twoDayQuery(activationStart, activationEnd)),
		input.nativeInsight(postGenerationQuery(latest.start, latest.end)),
		input.metabase.preview({
			language: "SQL",
			databaseExternalId: "34",
			queryText: npsSummarySql(npsBoundary),
		}),
		input.metabase.preview({
			language: "SQL",
			databaseExternalId: "34",
			queryText: npsDistributionSql(npsBoundary),
		}),
		input.metabase.preview({
			language: "SQL",
			databaseExternalId: "34",
			queryText: npsStatusSql(npsBoundary),
		}),
	]);

	const rows: unknown[][] = [];
	const push = (row: {
		section: string;
		periodStart?: Date | string;
		metric: string;
		dimension?: string;
		numerator?: number | null;
		denominator?: number | null;
		value?: number | null;
		rate?: number | null;
	}) => {
		rows.push([
			row.section,
			iso(row.periodStart ?? latest.start),
			row.metric,
			row.dimension ?? "total",
			row.numerator ?? null,
			row.denominator ?? null,
			row.value ?? null,
			row.rate ?? null,
			boundary.toISOString(),
			boundary.toISOString(),
		]);
	};

	for (const [dimension, result, start] of [
		["all_time", allTimeInstalls, latest.start],
		["latest_complete_week", latestInstalls, latest.start],
		["prior_complete_week", priorInstalls, prior.start],
	] as const) {
		const installs = trendValue(result, "plugin_installed");
		push({
			section: "installs",
			periodStart: start,
			metric: "unique_installs",
			dimension,
			numerator: installs,
			value: installs,
		});
	}

	for (const cohort of retentionRows(retention, boundary, 28).slice(-4)) {
		for (const week of [1, 2, 3]) {
			const retained = cohort.values.get(`Week ${week}`) ?? 0;
			push({
				section: "retention",
				periodStart: cohort.start,
				metric: `week_${week}_retention`,
				dimension: cohort.start.toISOString().slice(0, 10),
				numerator: retained,
				denominator: cohort.size,
				value: retained,
				rate: pct(retained, cohort.size),
			});
		}
	}

	for (const cohort of retentionRows(powerRetention, boundary, 14).slice(-4)) {
		const retained = cohort.values.get("Week 1") ?? 0;
		push({
			section: "power_retention",
			periodStart: cohort.start,
			metric: "week_1_retention",
			dimension: cohort.start.toISOString().slice(0, 10),
			numerator: retained,
			denominator: cohort.size,
			value: retained,
			rate: pct(retained, cohort.size),
		});
	}

	const steps = funnelSteps(activation);
	for (const [index, step] of steps.entries()) {
		const denominator =
			index === 0 ? step.count : (steps[index - 1]?.count ?? 0);
		push({
			section: "activation",
			metric: "ordered_funnel_step",
			dimension: step.name,
			numerator: step.count,
			denominator,
			value: step.count,
			rate: pct(step.count, denominator),
		});
	}

	const twoDaySteps = funnelSteps(twoDayActivation);
	const generated = twoDaySteps[0]?.count ?? 0;
	const returned = twoDaySteps.at(-1)?.count ?? 0;
	push({
		section: "two_day_activation",
		periodStart: activationStart,
		metric: "repeat_generation_within_two_days",
		numerator: returned,
		denominator: generated,
		value: returned,
		rate: pct(returned, generated),
	});

	const completions = trendValue(
		postGeneration,
		"playground_completed_generation",
	);
	for (const event of [
		"plugin_generation_previewed",
		"plugin_generation_downloaded",
		"plugin_generation_inserted",
	]) {
		const count = trendValue(postGeneration, event);
		push({
			section: "post_generation",
			metric: "action_count",
			dimension: event,
			numerator: count,
			denominator: completions,
			value: count,
			rate: pct(count, completions),
		});
	}

	const summary = record(npsSummary, 0);
	const total = number(summary.total);
	const promoters = number(summary.promoters);
	const passives = number(summary.passives);
	const detractors = number(summary.detractors);
	push({
		section: "nps",
		metric: "nps_score",
		numerator: promoters - detractors,
		denominator: total,
		value: number(summary.nps_score),
	});
	for (const [dimension, value] of [
		["promoters", promoters],
		["passives", passives],
		["detractors", detractors],
	] as const) {
		push({
			section: "nps",
			metric: "response_category",
			dimension,
			numerator: value,
			denominator: total,
			value,
			rate: pct(value, total),
		});
	}

	for (let index = 0; index < npsDistribution.rows.length; index += 1) {
		const distribution = record(npsDistribution, index);
		const responses = number(distribution.responses);
		push({
			section: "nps_distribution",
			metric: "score_responses",
			dimension: String(distribution.score),
			numerator: responses,
			denominator: total,
			value: responses,
			rate: pct(responses, total),
		});
	}

	const statuses = new Map(
		npsStatuses.rows.map((_, index) => {
			const status = record(npsStatuses, index);
			return [String(status.status), number(status.responses)];
		}),
	);
	const submitted = statuses.get("submitted") ?? 0;
	const dismissed = statuses.get("dismissed") ?? 0;
	push({
		section: "nps_response",
		metric: "completion_rate",
		numerator: submitted,
		denominator: submitted + dismissed,
		value: submitted,
		rate: pct(submitted, submitted + dismissed),
	});

	return {
		columns: [
			textColumn("section"),
			dateColumn("period_start"),
			textColumn("metric"),
			textColumn("dimension"),
			decimalColumn("numerator"),
			decimalColumn("denominator"),
			decimalColumn("value"),
			decimalColumn("rate_pct"),
			dateColumn("window_end"),
			dateColumn("data_through"),
		],
		rows,
	};
}

export function adobePluginVerificationChecks(
	result: MetabaseResult,
	query: AdobePluginQuery,
): PublishVerificationCheck[] {
	const rows = records(result);
	const sections = new Set(rows.map((row) => String(row.section)));
	const requiredSections = [
		"installs",
		"retention",
		"power_retention",
		"activation",
		"two_day_activation",
		"post_generation",
		"nps",
		"nps_distribution",
		"nps_response",
	];
	const outputComplete = requiredSections.every((section) =>
		sections.has(section),
	);
	const populationValid = rows.every((row) => {
		if (number(row.denominator) < 0) return false;
		if (row.metric === "nps_score") {
			return (
				Number.isFinite(Number(row.numerator)) &&
				Number.isFinite(Number(row.value)) &&
				number(row.value) >= -100 &&
				number(row.value) <= 100
			);
		}
		return ["numerator", "value"].every(
			(field) => row[field] === null || number(row[field]) >= 0,
		);
	});
	const ratesReconcile = rows.every((row) => {
		if (row.rate_pct === null) return true;
		return rateMatches(row.rate_pct, row.numerator, row.denominator);
	});
	const retentionMature = rows
		.filter(
			(row) => row.section === "retention" || row.section === "power_retention",
		)
		.every((row) => {
			const start = Date.parse(String(row.period_start));
			const end = Date.parse(String(row.data_through));
			const minimum = row.section === "retention" ? 28 : 14;
			return Number.isFinite(start) && end - start >= minimum * DAY_MS;
		});
	const forbidden = result.columns
		.map((column) => column.name.toLowerCase())
		.filter((name) =>
			["comment", "customer_id", "email", "person_id", "user_id"].includes(
				name,
			),
		);
	const watermarks = rows.map((row) => String(row.data_through));
	const oneWatermark =
		watermarks.length > 0 &&
		new Set(watermarks).size === 1 &&
		rows.every((row) => row.window_end === row.data_through);
	const npsTotal = number(
		rows.find((row) => row.metric === "nps_score")?.denominator,
	);
	const npsScore = rows.find((row) => row.metric === "nps_score");
	const npsCategoryRows = rows.filter(
		(row) => row.metric === "response_category",
	);
	const npsCategories = rows
		.filter((row) => row.metric === "response_category")
		.reduce((sum, row) => sum + number(row.value), 0);
	const promoters = number(
		npsCategoryRows.find((row) => row.dimension === "promoters")?.value,
	);
	const detractors = number(
		npsCategoryRows.find((row) => row.dimension === "detractors")?.value,
	);
	const npsScoreReconciles =
		npsScore !== undefined &&
		number(npsScore.numerator) === promoters - detractors &&
		Math.abs(
			number(npsScore.value) -
				Math.round(((promoters - detractors) / npsTotal) * 1_000) / 10,
		) <= 0.05;
	const npsDistribution = rows
		.filter((row) => row.section === "nps_distribution")
		.reduce((sum, row) => sum + number(row.value), 0);

	return [
		check(
			"event_definition_review",
			query.report === "weekly-kpis" && query.version === 1,
			"The adapter must use the approved Adobe plugin event and survey contract.",
			{ report: query.report, version: query.version },
		),
		check(
			"report_population",
			outputComplete && populationValid,
			"Every required report section must be present with non-negative values.",
			{ sections: [...sections].sort(), requiredSections },
		),
		check(
			"metric_reconciliation",
			ratesReconcile,
			"Every published rate must reconcile to its numerator and denominator.",
			{ rows: rows.length },
		),
		check(
			"cohort_maturity",
			retentionMature,
			"Retention rows must have complete return-week observation windows.",
			{ rows: rows.length },
		),
		check(
			"nps_response_parity",
			npsTotal > 0 &&
				npsCategories === npsTotal &&
				npsDistribution === npsTotal &&
				npsScoreReconciles,
			"NPS categories and score distribution must reconcile to scored responses.",
			{ npsTotal, npsCategories, npsDistribution, npsScoreReconciles },
		),
		check(
			"sensitive_detail_boundary",
			forbidden.length === 0,
			"The governed result must exclude comments and person-level identifiers.",
			{ forbidden },
		),
		check(
			"oldest_complete_watermark",
			oneWatermark,
			"All rows must use one complete UTC data-through boundary.",
			{ dataThrough: [...new Set(watermarks)] },
		),
	];
}

function trendsQuery(
	series: unknown[],
	range: Record<string, unknown>,
	interval: "week" | "month",
) {
	return {
		kind: "InsightVizNode",
		source: {
			kind: "TrendsQuery",
			series,
			interval,
			dateRange: { ...range, explicitDate: true },
			filterTestAccounts: true,
			trendsFilter: { display: "BoldNumber" },
			modifiers: { convertToProjectTimezone: false },
		},
	};
}

function retentionQuery(start: Date, end: Date, power: boolean) {
	return {
		kind: "InsightVizNode",
		source: {
			kind: "RetentionQuery",
			version: 2,
			dateRange: dateRange(start, end),
			properties: [],
			retentionFilter: {
				period: "Week",
				targetEntity: retentionEntity(),
				returningEntity: retentionEntity(),
				retentionType: "retention_recurring",
				totalIntervals: 7,
				retentionReference: "total",
				...(power ? { minimumOccurrences: 10 } : {}),
			},
			filterTestAccounts: true,
			modifiers: { convertToProjectTimezone: false },
		},
	};
}

function activationQuery(start: Date, end: Date) {
	return funnelQuery(
		[
			eventStep("plugin_installed"),
			eventStep("plugin_signin_initiated"),
			eventStep("plugin_signin_completed"),
			eventStep("playground_started_generation", SOURCE_FILTER),
			eventStep("playground_completed_generation", SOURCE_FILTER),
			{
				kind: "ActionsNode",
				name: "plugin_used_downloaded_generation",
				id: 241769,
			},
		],
		dateRange(start, end),
		{
			exclusions: [],
			funnelVizType: "steps",
			funnelOrderType: "ordered",
			funnelStepReference: "previous",
		},
	);
}

function twoDayQuery(start: Date, end: Date) {
	return funnelQuery(
		[
			eventStep("playground_completed_generation", SOURCE_FILTER),
			eventStep("playground_completed_generation", SOURCE_FILTER),
		],
		dateRange(start, end),
		{
			exclusions: [],
			funnelVizType: "steps",
			funnelOrderType: "ordered",
			funnelStepReference: "previous",
			funnelWindowInterval: 2,
			funnelWindowIntervalUnit: "day",
		},
	);
}

function postGenerationQuery(start: Date, end: Date) {
	return trendsQuery(
		[
			eventsNode("plugin_generation_previewed", "total"),
			eventsNode("plugin_generation_downloaded", "total"),
			eventsNode("plugin_generation_inserted", "total"),
			eventsNode("playground_completed_generation", "total", SOURCE_FILTER),
		],
		dateRange(start, end),
		"week",
	);
}

function funnelQuery(
	series: unknown[],
	range: Record<string, unknown>,
	filter: Record<string, unknown>,
) {
	return {
		kind: "InsightVizNode",
		source: {
			kind: "FunnelsQuery",
			series,
			version: 2,
			interval: "day",
			dateRange: range,
			properties: [],
			funnelsFilter: filter,
			filterTestAccounts: true,
			modifiers: { convertToProjectTimezone: false },
		},
	};
}

function eventsNode(event: string, math: string, properties?: unknown[]) {
	return {
		kind: "EventsNode",
		event,
		name: event,
		math,
		...(properties ? { properties } : {}),
	};
}

function eventStep(event: string, properties?: unknown[]) {
	return {
		kind: "EventsNode",
		event,
		name: event,
		...(properties ? { properties } : {}),
	};
}

function retentionEntity() {
	return {
		id: "playground_completed_generation",
		name: "playground_completed_generation",
		type: "events",
		order: 0,
		properties: SOURCE_FILTER,
	};
}

function npsSummarySql(boundary: string) {
	return `with scores as (
  select (values ->> 'score')::int as score
  from ${NPS_SOURCE}
    and created_at < '${boundary}'::timestamptz
    and values ->> 'status' = 'submitted'
    and values ->> 'score' is not null
)
select
  count(*)::int as total,
  count(*) filter (where score >= 9)::int as promoters,
  count(*) filter (where score between 7 and 8)::int as passives,
  count(*) filter (where score <= 6)::int as detractors,
  case when count(*) > 0
    then round(100.0 * (
      count(*) filter (where score >= 9) - count(*) filter (where score <= 6)
    ) / count(*), 1)
    else 0
  end as nps_score
from scores`;
}

function npsDistributionSql(boundary: string) {
	return `select
  (values ->> 'score')::int as score,
  count(*)::int as responses
from ${NPS_SOURCE}
  and created_at < '${boundary}'::timestamptz
  and values ->> 'status' = 'submitted'
  and values ->> 'score' is not null
group by 1
order by 1`;
}

function npsStatusSql(boundary: string) {
	return `select
  values ->> 'status' as status,
  count(*)::int as responses
from ${NPS_SOURCE}
  and created_at < '${boundary}'::timestamptz
group by 1
order by 1`;
}

function completeWeekBoundary(now: Date) {
	const value = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
	return value;
}

function period(boundary: Date, startDays: number, endDays: number) {
	return {
		start: new Date(boundary.getTime() - startDays * DAY_MS),
		end: new Date(boundary.getTime() - endDays * DAY_MS),
	};
}

function dateRange(start: Date, end: Date) {
	return {
		date_from: start.toISOString(),
		date_to: inclusiveEnd(end),
		explicitDate: true,
	};
}

function inclusiveEnd(end: Date) {
	return new Date(end.getTime() - 1).toISOString();
}

function trendValue(result: unknown, label: string) {
	const series = Array.isArray(result) ? result : [];
	const item = series.find((candidate) => object(candidate).label === label);
	return number(object(item).aggregated_value);
}

function funnelSteps(result: unknown) {
	return (Array.isArray(result) ? result : []).map((item) => ({
		name: String(object(item).name ?? object(item).action_id ?? "step"),
		count: number(object(item).count),
	}));
}

function retentionRows(result: unknown, boundary: Date, maturityDays: number) {
	return (Array.isArray(result) ? result : [])
		.flatMap((item) => {
			const cohort = object(item);
			const day = String(cohort.date ?? "").slice(0, 10);
			const start = new Date(`${day}T00:00:00.000Z`);
			if (!Number.isFinite(start.getTime())) return [];
			if (boundary.getTime() - start.getTime() < maturityDays * DAY_MS)
				return [];
			const values = new Map(
				(Array.isArray(cohort.values) ? cohort.values : []).map((entry) => {
					const value = object(entry);
					return [String(value.label), number(value.count)] as const;
				}),
			);
			const size = values.get("Week 0") ?? 0;
			return size > 0 ? [{ start, size, values }] : [];
		})
		.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function record(result: MetabaseResult, index: number): Row {
	const row = result.rows[index] ?? [];
	return Object.fromEntries(
		result.columns.map((column, columnIndex) => [
			column.name,
			row[columnIndex] ?? null,
		]),
	);
}

function records(result: MetabaseResult): Row[] {
	return result.rows.map((_, index) => record(result, index));
}

function object(value: unknown): Row {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Row)
		: {};
}

function number(value: unknown) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator: number, denominator: number) {
	return denominator > 0
		? Math.round((numerator / denominator) * 10_000) / 100
		: 0;
}

function rateMatches(rate: unknown, numerator: unknown, denominator: unknown) {
	return (
		Math.abs(number(rate) - pct(number(numerator), number(denominator))) <= 0.01
	);
}

function iso(value: Date | string) {
	return value instanceof Date ? value.toISOString() : value;
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

function textColumn(name: string) {
	return { name, displayName: name, baseType: "type/Text" };
}

function dateColumn(name: string) {
	return { name, displayName: name, baseType: "type/DateTime" };
}

function decimalColumn(name: string) {
	return { name, displayName: name, baseType: "type/Decimal" };
}
