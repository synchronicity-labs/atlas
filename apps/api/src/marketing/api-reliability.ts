import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";
import {
	BetterStackClient,
	type BetterStackSource,
} from "./betterstack.client";
import type { MarketingQuery } from "./marketing.contracts";

type ApiReliabilityQuery = Extract<
	MarketingQuery,
	{ source: "api_reliability" }
>;
type Row = Record<string, unknown>;
type Coverage = {
	sourceRows: number;
	eligibleRows: number;
	classifiedRows: number;
	unmappedRelevantRows: number;
	coveredHours: number;
	excludedHealthSse: number;
	excludedBots: number;
	windowMin: string;
	windowMax: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE_NAME = "[Prod] Sync API V2";
const ENDPOINTS = [
	"public_api_tts",
	"voice_clone",
	"asset_upload",
	"asset_management",
	"api_asset_generation",
	"error_catalog",
	"cors_preflight",
];
const TRAFFIC_SCOPES = ["all", "api_key"];
const EXCLUSION_POLICY = "health_sse_and_bot_traffic";

export async function apiReliabilityWeeklyReport(input: {
	query: ApiReliabilityQuery;
	betterstack: BetterStackClient;
	now?: Date;
}): Promise<MetabaseResult> {
	const end = completeWeekBoundary(input.now ?? new Date());
	const start = new Date(end.getTime() - 14 * DAY_MS);
	const source = await input.betterstack.source(SOURCE_NAME);
	const [aggregateRows, coverageRows] = await Promise.all([
		input.betterstack.sql(source, reliabilitySql(source, start, end)),
		input.betterstack.sql(source, coverageSql(source, start, end)),
	]);
	const coverage = parseCoverage(coverageRows[0]);
	if (coverage.sourceRows <= 0 || !coverage.windowMin || !coverage.windowMax) {
		throw new Error(
			"BetterStack did not return a complete reliability window.",
		);
	}
	const values = new Map(
		aggregateRows.map((row) => [
			`${timestamp(row.week_start)}:${text(row.endpoint)}:${text(row.traffic_scope)}`,
			row,
		]),
	);
	const periods = [start, new Date(start.getTime() + 7 * DAY_MS)].map((value) =>
		value.toISOString(),
	);
	const expectedKeys = periods.flatMap((period) =>
		ENDPOINTS.flatMap((endpoint) =>
			TRAFFIC_SCOPES.map(
				(trafficScope) => `${period}:${endpoint}:${trafficScope}`,
			),
		),
	);
	if (
		values.size !== expectedKeys.length ||
		expectedKeys.some((key) => !values.has(key))
	) {
		throw new Error("BetterStack did not return the exact endpoint registry.");
	}
	const rows = periods.flatMap((period) =>
		ENDPOINTS.flatMap((endpoint) =>
			TRAFFIC_SCOPES.map((trafficScope) => {
				const value = values.get(`${period}:${endpoint}:${trafficScope}`);
				if (!value) {
					throw new Error("BetterStack endpoint registry row is missing.");
				}
				return [
					period,
					endpoint,
					trafficScope,
					number(value.requests),
					number(value.errors),
					number(value.client_errors),
					number(value.server_errors),
					number(value.error_rate_pct),
					number(value.p50_latency_ms),
					number(value.p95_latency_ms),
					text(value.top_error_class) || "none",
					number(value.asset_patch_5xx),
					number(value.asset_project_not_found_422),
					number(value.asset_auth_abuse_errors),
					number(value.tts_voice_errors),
					number(value.invalid_asset_generation_errors),
					number(value.cors_5xx),
					coverage.sourceRows,
					coverage.eligibleRows,
					coverage.classifiedRows,
					coverage.unmappedRelevantRows,
					coverage.coveredHours,
					coverage.excludedHealthSse,
					coverage.excludedBots,
					coverage.windowMin,
					coverage.windowMax,
					source.id,
					source.dataRegion,
					EXCLUSION_POLICY,
					end.toISOString(),
				];
			}),
		),
	);
	return {
		columns: [
			dateColumn("week_start"),
			textColumn("endpoint"),
			textColumn("traffic_scope"),
			decimalColumn("requests"),
			decimalColumn("errors"),
			decimalColumn("client_errors"),
			decimalColumn("server_errors"),
			decimalColumn("error_rate_pct"),
			decimalColumn("p50_latency_ms"),
			decimalColumn("p95_latency_ms"),
			textColumn("top_error_class"),
			decimalColumn("asset_patch_5xx"),
			decimalColumn("asset_project_not_found_422"),
			decimalColumn("asset_auth_abuse_errors"),
			decimalColumn("tts_voice_errors"),
			decimalColumn("invalid_asset_generation_errors"),
			decimalColumn("cors_5xx"),
			decimalColumn("source_request_rows"),
			decimalColumn("eligible_response_rows"),
			decimalColumn("classified_registry_rows"),
			decimalColumn("unmapped_relevant_rows"),
			decimalColumn("covered_hours"),
			decimalColumn("excluded_health_sse_rows"),
			decimalColumn("excluded_bot_rows"),
			dateColumn("source_window_min"),
			dateColumn("source_window_max"),
			textColumn("source_id"),
			textColumn("source_region"),
			textColumn("exclusion_policy"),
			dateColumn("data_through"),
		],
		rows,
	};
}

export function apiReliabilityVerificationChecks(
	result: MetabaseResult,
	query: ApiReliabilityQuery,
): PublishVerificationCheck[] {
	const rows = records(result);
	const weeks = [...new Set(rows.map((row) => text(row.week_start)))].sort();
	const registry = rows
		.map(
			(row) =>
				`${text(row.week_start)}:${text(row.endpoint)}:${text(row.traffic_scope)}`,
		)
		.sort();
	const expected = weeks
		.flatMap((weekStart) =>
			ENDPOINTS.flatMap((endpoint) =>
				TRAFFIC_SCOPES.map(
					(trafficScope) => `${weekStart}:${endpoint}:${trafficScope}`,
				),
			),
		)
		.sort();
	const first = rows[0] ?? {};
	const adapterValid =
		query.report === "weekly-reliability" &&
		query.version === 1 &&
		text(first.source_id).length > 0 &&
		/^eu-[a-z0-9-]+$/.test(text(first.source_region)) &&
		number(first.source_request_rows) > 0 &&
		rows.every(
			(row) =>
				row.source_id === first.source_id &&
				row.source_region === first.source_region &&
				row.source_request_rows === first.source_request_rows,
		);
	const registryExact =
		weeks.length === 2 &&
		JSON.stringify(registry) === JSON.stringify(expected) &&
		number(first.classified_registry_rows) > 0 &&
		number(first.unmapped_relevant_rows) === 0 &&
		rows.every(
			(row) =>
				row.classified_registry_rows === first.classified_registry_rows &&
				row.unmapped_relevant_rows === first.unmapped_relevant_rows,
		);
	const exclusionValid = rows.every(
		(row) =>
			row.exclusion_policy === EXCLUSION_POLICY &&
			number(row.excluded_health_sse_rows) >= 0 &&
			number(row.excluded_bot_rows) >= 0,
	);
	const taxonomyValid = rows.every((row) => {
		const requests = number(row.requests);
		const errors = number(row.errors);
		const clientErrors = number(row.client_errors);
		const serverErrors = number(row.server_errors);
		return (
			requests >= 0 &&
			errors === clientErrors + serverErrors &&
			errors <= requests &&
			rateMatches(row.error_rate_pct, errors, requests) &&
			text(row.top_error_class).length > 0
		);
	});
	const latencyValid = rows.every(
		(row) =>
			number(row.p50_latency_ms) >= 0 &&
			number(row.p95_latency_ms) >= number(row.p50_latency_ms),
	);
	const windowMin = Date.parse(text(first.source_window_min));
	const windowMax = Date.parse(text(first.source_window_max));
	const firstWeek = Date.parse(weeks[0] ?? "");
	const dataThrough = Date.parse(text(first.data_through));
	const watermarkValid =
		Number.isFinite(windowMin) &&
		Number.isFinite(windowMax) &&
		Number.isFinite(firstWeek) &&
		Number.isFinite(dataThrough) &&
		windowMin <= firstWeek + 60 * 60 * 1000 &&
		windowMax >= dataThrough - 60 * 60 * 1000 &&
		number(first.covered_hours) === 14 * 24 &&
		dataThrough - firstWeek === 14 * DAY_MS &&
		rows.every((row) => row.data_through === first.data_through);
	return [
		check(
			"betterstack_adapter",
			adapterValid,
			"The governed reader must resolve the exact production Sync API V2 source and use its EU read-only S3 log table.",
			{
				sourceId: first.source_id,
				region: first.source_region,
				sourceRows: first.source_request_rows,
			},
		),
		check(
			"endpoint_registry_review",
			registryExact,
			"Both weeks must contain every approved endpoint group for all traffic and API-key traffic.",
			{
				weeks,
				endpoints: ENDPOINTS,
				trafficScopes: TRAFFIC_SCOPES,
				classifiedRows: first.classified_registry_rows,
				unmappedRelevantRows: first.unmapped_relevant_rows,
			},
		),
		check(
			"bot_and_healthcheck_exclusion",
			exclusionValid,
			"Health checks, active-job SSE, and recognized bot user agents must be excluded before endpoint aggregation.",
			{
				healthSse: first.excluded_health_sse_rows,
				bots: first.excluded_bot_rows,
				policy: first.exclusion_policy,
			},
		),
		check(
			"error_taxonomy_review",
			taxonomyValid,
			"Errors must reconcile to 4xx and 5xx, with classified CRAFT-4763 buckets kept separate from successful traffic.",
			{ rows: rows.length },
		),
		check(
			"latency_population_review",
			latencyValid,
			"Latency percentiles must use completed requests with a positive duration and remain ordered.",
			{ rows: rows.length },
		),
		check(
			"oldest_complete_watermark",
			watermarkValid,
			"The production log source must cover both complete Monday-Sunday UTC weeks through one data-through boundary.",
			{
				weeks,
				windowMin: first.source_window_min,
				windowMax: first.source_window_max,
				coveredHours: first.covered_hours,
				dataThrough: first.data_through,
			},
		),
	];
}

function reliabilitySql(source: BetterStackSource, start: Date, end: Date) {
	const table = s3TableName(source);
	return `with events as (
  select
    toStartOfWeek(dt, 1) as week_start,
    upper(JSONExtractString(raw, 'method')) as method,
    JSONExtractString(raw, 'routeTemplate') as route,
    toInt32OrZero(JSONExtractString(raw, 'statusCode')) as status_code,
    toFloat64OrZero(JSONExtractString(raw, 'durationMs')) as duration_ms,
    JSONExtractString(raw, 'apiKeyId') as api_key_id,
    lower(JSONExtractString(raw, 'userAgent')) as user_agent,
    JSONExtractString(raw, 'failureBucket') as failure_bucket,
    lower(JSONExtractString(raw, 'errorCode')) as error_code,
    lower(JSONExtractString(raw, 'errorMessage')) as error_message
  from s3Cluster(primary, ${table})
  where dt >= toDateTime('${clickhouseDate(start)}', 'UTC')
    and dt < toDateTime('${clickhouseDate(end)}', 'UTC')
    and _row_type = 1
    and JSONExtractString(raw, 'message') = 'api_response'
    and JSONExtractString(raw, 'completionEvent') = 'finish'
    and notEmpty(JSONExtractString(raw, 'routeTemplate'))
), classified as (
  select
    *,
    multiIf(
      method = 'OPTIONS' and startsWith(route, '/v2/'), 'cors_preflight',
      method = 'POST' and route in ('/v2/tts', '/v2/integrations/tts'), 'public_api_tts',
      method = 'POST' and route in ('/v2/voices', '/v2/integrations/voices/clone'), 'voice_clone',
      method = 'POST' and route in ('/v2/assets/upload', '/v2/assets', '/v2/assets/batch', '/v2/projects/:id/assets'), 'asset_upload',
      method = 'PATCH' and route = '/v2/assets/:id', 'asset_management',
	      method = 'POST' and route in ('/v2/generate', '/v2/generate/estimate-cost'), 'api_asset_generation',
      positionCaseInsensitive(route, '/errors') > 0 or positionCaseInsensitive(route, '/error-code') > 0, 'error_catalog',
      ''
    ) as endpoint,
    multiIf(
      method = 'PATCH' and route = '/v2/assets/:id' and status_code >= 500, 'asset_patch_server_error',
      method = 'POST' and route in ('/v2/assets/upload', '/v2/assets', '/v2/assets/batch', '/v2/projects/:id/assets') and status_code = 422 and positionCaseInsensitive(error_message, 'project') > 0 and positionCaseInsensitive(error_message, 'not found') > 0, 'asset_project_not_found',
      method = 'POST' and route in ('/v2/assets/upload', '/v2/assets', '/v2/assets/batch', '/v2/projects/:id/assets') and failure_bucket in ('auth_missing_or_invalid', 'plan_or_limit_denied'), 'asset_auth_or_abuse',
      method = 'POST' and route in ('/v2/tts', '/v2/integrations/tts', '/v2/voices', '/v2/integrations/voices/clone') and status_code >= 400, 'tts_voice_validation_provider_limit',
      method = 'POST' and route = '/v2/generate' and status_code >= 400 and (positionCaseInsensitive(error_message, 'asset') > 0 or positionCaseInsensitive(error_code, 'asset') > 0), 'asset_generation_invalid_asset',
      method = 'OPTIONS' and status_code >= 500, 'cors_server_error',
      notEmpty(failure_bucket), failure_bucket,
      status_code >= 500, 'server_error',
      status_code >= 400, 'client_error',
      'none'
    ) as error_class
  from events
  where route not in ('/health', '/healthz', '/metrics', '/v2/usage/active-jobs/stream')
    and user_agent not like '%bot%'
    and user_agent not like '%crawler%'
    and user_agent not like '%spider%'
), scoped as (
  select *, arrayJoin(['all', 'api_key']) as traffic_scope
  from classified
  where endpoint != ''
), aggregates as (
  select
    week_start,
    endpoint,
    traffic_scope,
    count() as requests,
    countIf(status_code >= 400 and status_code < 600) as errors,
    countIf(status_code >= 400 and status_code < 500) as client_errors,
    countIf(status_code >= 500 and status_code < 600) as server_errors,
    round(if(requests = 0, 0, errors * 100.0 / requests), 4) as error_rate_pct,
    round(if(countIf(duration_ms > 0) = 0, 0, quantileExactIf(0.5)(duration_ms, duration_ms > 0)), 2) as p50_latency_ms,
    round(if(countIf(duration_ms > 0) = 0, 0, quantileExactIf(0.95)(duration_ms, duration_ms > 0)), 2) as p95_latency_ms,
    if(errors = 0, 'none', arrayElement(topKIf(1)(error_class, status_code >= 400 and status_code < 600), 1)) as top_error_class,
    countIf(error_class = 'asset_patch_server_error') as asset_patch_5xx,
    countIf(error_class = 'asset_project_not_found') as asset_project_not_found_422,
    countIf(error_class = 'asset_auth_or_abuse') as asset_auth_abuse_errors,
    countIf(error_class = 'tts_voice_validation_provider_limit') as tts_voice_errors,
    countIf(error_class = 'asset_generation_invalid_asset') as invalid_asset_generation_errors,
    countIf(error_class = 'cors_server_error') as cors_5xx
  from scoped
  where traffic_scope = 'all' or notEmpty(api_key_id)
  group by week_start, endpoint, traffic_scope
), registry as (
  select week_start, endpoint, traffic_scope
  from (
    select arrayJoin([
      toDateTime('${clickhouseDate(start)}', 'UTC'),
      toDateTime('${clickhouseDate(new Date(start.getTime() + 7 * DAY_MS))}', 'UTC')
    ]) as week_start
  )
  cross join (
    select arrayJoin([
      'public_api_tts',
      'voice_clone',
      'asset_upload',
      'asset_management',
      'api_asset_generation',
      'error_catalog',
      'cors_preflight'
    ]) as endpoint
  )
  cross join (
    select arrayJoin(['all', 'api_key']) as traffic_scope
  )
)
select
  registry.week_start,
  registry.endpoint,
  registry.traffic_scope,
  ifNull(aggregates.requests, 0) as requests,
  ifNull(aggregates.errors, 0) as errors,
  ifNull(aggregates.client_errors, 0) as client_errors,
  ifNull(aggregates.server_errors, 0) as server_errors,
  ifNull(aggregates.error_rate_pct, 0) as error_rate_pct,
  ifNull(aggregates.p50_latency_ms, 0) as p50_latency_ms,
  ifNull(aggregates.p95_latency_ms, 0) as p95_latency_ms,
  ifNull(aggregates.top_error_class, 'none') as top_error_class,
  ifNull(aggregates.asset_patch_5xx, 0) as asset_patch_5xx,
  ifNull(aggregates.asset_project_not_found_422, 0) as asset_project_not_found_422,
  ifNull(aggregates.asset_auth_abuse_errors, 0) as asset_auth_abuse_errors,
  ifNull(aggregates.tts_voice_errors, 0) as tts_voice_errors,
  ifNull(aggregates.invalid_asset_generation_errors, 0) as invalid_asset_generation_errors,
  ifNull(aggregates.cors_5xx, 0) as cors_5xx
from registry
left join aggregates using (week_start, endpoint, traffic_scope)
order by registry.week_start, registry.endpoint, registry.traffic_scope
limit 1001`;
}

function coverageSql(source: BetterStackSource, start: Date, end: Date) {
	const table = s3TableName(source);
	return `with events as (
  select
    dt,
    upper(JSONExtractString(raw, 'method')) as method,
    JSONExtractString(raw, 'routeTemplate') as route,
    lower(JSONExtractString(raw, 'userAgent')) as user_agent,
    JSONExtractString(raw, 'completionEvent') as completion_event
  from s3Cluster(primary, ${table})
  where dt >= toDateTime('${clickhouseDate(start)}', 'UTC')
    and dt < toDateTime('${clickhouseDate(end)}', 'UTC')
    and _row_type = 1
    and JSONExtractString(raw, 'message') = 'api_response'
), classified as (
  select
    *,
    completion_event = 'finish'
      and notEmpty(route)
      and route not in ('/health', '/healthz', '/metrics', '/v2/usage/active-jobs/stream')
      and user_agent not like '%bot%'
      and user_agent not like '%crawler%'
      and user_agent not like '%spider%' as eligible,
    multiIf(
      method = 'OPTIONS' and startsWith(route, '/v2/'), 'cors_preflight',
      method = 'POST' and route in ('/v2/tts', '/v2/integrations/tts'), 'public_api_tts',
      method = 'POST' and route in ('/v2/voices', '/v2/integrations/voices/clone'), 'voice_clone',
      method = 'POST' and route in ('/v2/assets/upload', '/v2/assets', '/v2/assets/batch', '/v2/projects/:id/assets'), 'asset_upload',
      method = 'PATCH' and route = '/v2/assets/:id', 'asset_management',
	      method = 'POST' and route in ('/v2/generate', '/v2/generate/estimate-cost'), 'api_asset_generation',
      positionCaseInsensitive(route, '/errors') > 0 or positionCaseInsensitive(route, '/error-code') > 0, 'error_catalog',
      ''
    ) as endpoint,
    (
      method = 'OPTIONS' and startsWith(route, '/v2/')
      or (
        method in ('POST', 'PATCH')
        and (
          positionCaseInsensitive(route, 'tts') > 0
          or positionCaseInsensitive(route, 'voice') > 0
          or positionCaseInsensitive(route, 'asset') > 0
          or positionCaseInsensitive(route, 'error') > 0
          or positionCaseInsensitive(route, 'generate') > 0
        )
        and positionCaseInsensitive(route, '/internal/') = 0
        and positionCaseInsensitive(route, 'metadata') = 0
      )
    ) as relevant
  from events
)
select
  count() as source_rows,
  countIf(eligible) as eligible_rows,
  countIf(eligible and endpoint != '') as classified_rows,
  countIf(eligible and relevant and endpoint = '') as unmapped_relevant_rows,
  uniqExact(toStartOfHour(dt)) as covered_hours,
  countIf(route in ('/health', '/healthz', '/metrics', '/v2/usage/active-jobs/stream')) as excluded_health_sse,
  countIf(
    user_agent like '%bot%'
    or user_agent like '%crawler%'
    or user_agent like '%spider%'
  ) as excluded_bots,
  min(dt) as window_min,
  max(dt) as window_max
from classified`;
}

function parseCoverage(row: Row | undefined): Coverage {
	return {
		sourceRows: number(row?.source_rows),
		eligibleRows: number(row?.eligible_rows),
		classifiedRows: number(row?.classified_rows),
		unmappedRelevantRows: number(row?.unmapped_relevant_rows),
		coveredHours: number(row?.covered_hours),
		excludedHealthSse: number(row?.excluded_health_sse),
		excludedBots: number(row?.excluded_bots),
		windowMin: timestamp(row?.window_min),
		windowMax: timestamp(row?.window_max),
	};
}

function s3TableName(source: BetterStackSource) {
	if (
		!/^\d+$/.test(source.teamId) ||
		!/^[a-zA-Z0-9_]+$/.test(source.tableName)
	) {
		throw new Error("BetterStack source table metadata is unsafe.");
	}
	return `t${source.teamId}_${source.tableName}_s3`;
}

function completeWeekBoundary(now: Date) {
	const value = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
	return value;
}

function records(result: MetabaseResult): Row[] {
	return result.rows.map((row) =>
		Object.fromEntries(
			result.columns.map((column, index) => [column.name, row[index] ?? null]),
		),
	);
}

function timestamp(value: unknown) {
	const raw = text(value);
	const parsed = new Date(
		raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`,
	);
	return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function clickhouseDate(value: Date) {
	return value.toISOString().replace("T", " ").slice(0, 19);
}

function text(value: unknown) {
	return typeof value === "string" || typeof value === "number"
		? String(value).trim()
		: "";
}

function number(value: unknown) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator: number, denominator: number) {
	return denominator > 0
		? Math.round((numerator / denominator) * 1_000_000) / 10_000
		: 0;
}

function rateMatches(rate: unknown, numerator: unknown, denominator: unknown) {
	return (
		Math.abs(number(rate) - pct(number(numerator), number(denominator))) <= 0.01
	);
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
