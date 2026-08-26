import { VerificationStatus } from "@crm/db";
import type {
	MetabaseClient,
	MetabaseResult,
} from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";
import type { GbrainEvidenceService } from "./gbrain-evidence.service";
import type { MarketingQuery } from "./marketing.contracts";

type ModelFeedbackQuery = Extract<MarketingQuery, { source: "model_feedback" }>;
type Row = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
const MODELS = ["1.9", "2", "2-pro", "3"];
const THEMES = [
	"lip_sync_timing",
	"mouth_or_face_quality",
	"visual_artifacts",
	"model_failure_or_error",
	"speaker_or_character",
	"general_quality",
	"other_negative",
];

export async function modelFeedbackWeeklyReport(input: {
	query: ModelFeedbackQuery;
	metabase: MetabaseClient;
	evidence: GbrainEvidenceService;
	now?: Date;
}): Promise<MetabaseResult> {
	const dataThrough = completeWeekBoundary(input.now ?? new Date());
	const weekStart = new Date(dataThrough.getTime() - 7 * DAY_MS);
	const [productResult, support] = await Promise.all([
		input.metabase.preview({
			language: "SQL",
			databaseExternalId: "34",
			queryText: productFeedbackSql(weekStart, dataThrough),
		}),
		input.evidence.latestForWeek(weekStart),
	]);
	if (!support) {
		throw new Error("The complete UTC week has no gBrain evidence snapshot.");
	}
	if (support.dataThrough !== dataThrough.toISOString()) {
		throw new Error(
			"The gBrain evidence watermark does not match the product week.",
		);
	}
	const product = records(productResult);
	if (
		product.length !== MODELS.length ||
		new Set(product.map((row) => text(row.model))).size !== MODELS.length ||
		MODELS.some((model) => !product.some((row) => text(row.model) === model))
	) {
		throw new Error(
			"Product feedback did not return the exact model registry.",
		);
	}
	const shared = [support.sourceItemCount, dataThrough.toISOString()];
	return {
		columns: [
			dateColumn("week_start"),
			textColumn("surface"),
			textColumn("model"),
			decimalColumn("completed_generations"),
			decimalColumn("rated_generations"),
			decimalColumn("feedback_events"),
			decimalColumn("positive_feedback"),
			decimalColumn("negative_feedback"),
			decimalColumn("negative_rate_pct"),
			decimalColumn("coverage_pct"),
			decimalColumn("support_negative_tickets"),
			textColumn("support_theme"),
			decimalColumn("support_source_items"),
			dateColumn("data_through"),
		],
		rows: [
			...MODELS.map((model) => {
				const row = product.find((value) => text(value.model) === model);
				if (!row)
					throw new Error(`Product feedback model ${model} is missing.`);
				return [
					weekStart.toISOString(),
					"product_feedback",
					model,
					number(row.completed_generations),
					number(row.rated_generations),
					number(row.feedback_events),
					number(row.positive_feedback),
					number(row.negative_feedback),
					number(row.negative_rate_pct),
					number(row.coverage_pct),
					0,
					"none",
					...shared,
				];
			}),
			...support.rows.map((row) => [
				weekStart.toISOString(),
				"support_negative",
				row.model,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				row.count,
				row.supportTheme,
				...shared,
			]),
		],
	};
}

export function modelFeedbackVerificationChecks(
	result: MetabaseResult,
	query: ModelFeedbackQuery,
): PublishVerificationCheck[] {
	const rows = records(result);
	const product = rows.filter((row) => row.surface === "product_feedback");
	const support = rows.filter((row) => row.surface === "support_negative");
	const productModels = product.map((row) => text(row.model)).sort();
	const modelMapping =
		query.report === "weekly-coverage" &&
		query.version === 1 &&
		JSON.stringify(productModels) === JSON.stringify([...MODELS].sort()) &&
		rows.every((row) => MODELS.includes(text(row.model)));
	const denominatorParity = product.every((row) => {
		const completed = number(row.completed_generations);
		const rated = number(row.rated_generations);
		const events = number(row.feedback_events);
		const positive = number(row.positive_feedback);
		const negative = number(row.negative_feedback);
		return (
			completed >= rated &&
			events === positive + negative &&
			events >= rated &&
			rateMatches(row.negative_rate_pct, negative, events) &&
			rateMatches(row.coverage_pct, rated, completed)
		);
	});
	const sourceItems = number(rows[0]?.support_source_items);
	const supportKeys = support.map(
		(row) => `${text(row.model)}:${text(row.support_theme)}`,
	);
	const supportJoin =
		sourceItems >= 0 &&
		new Set(supportKeys).size === supportKeys.length &&
		support.reduce(
			(total, row) => total + number(row.support_negative_tickets),
			0,
		) === sourceItems &&
		support.every(
			(row) =>
				THEMES.includes(text(row.support_theme)) &&
				number(row.support_negative_tickets) > 0 &&
				number(row.support_negative_tickets) <= sourceItems,
		) &&
		rows.every((row) => number(row.support_source_items) === sourceItems);
	const forbiddenColumns = result.columns
		.map((column) => column.name.toLowerCase())
		.filter((name) =>
			[
				"email",
				"user",
				"customer",
				"organization",
				"url",
				"slug",
				"text",
				"title",
				"issue",
			].some((forbidden) => name.includes(forbidden)),
		);
	const privacyBoundary =
		forbiddenColumns.length === 0 &&
		rows.every(
			(row) =>
				["product_feedback", "support_negative"].includes(text(row.surface)) &&
				(text(row.support_theme) === "none" ||
					THEMES.includes(text(row.support_theme))),
		);
	const weekStarts = [...new Set(rows.map((row) => text(row.week_start)))];
	const dataThroughValues = [
		...new Set(rows.map((row) => text(row.data_through))),
	];
	const watermark =
		weekStarts.length === 1 &&
		dataThroughValues.length === 1 &&
		Date.parse(dataThroughValues[0] ?? "") - Date.parse(weekStarts[0] ?? "") ===
			7 * DAY_MS;
	return [
		check(
			"feedback_denominator_parity",
			denominatorParity,
			"Positive and negative feedback events must reconcile, and rated generations must remain a subset of completed generations.",
			{ productRows: product.length },
		),
		check(
			"model_mapping",
			modelMapping,
			"The report must publish the exact approved model registry.",
			{ models: productModels },
		),
		check(
			"support_evidence_join",
			supportJoin,
			"Support evidence must use one deidentified weekly aggregate with unique model and theme rows.",
			{ sourceItems, supportRows: support.length },
		),
		check(
			"customer_text_boundary",
			privacyBoundary,
			"The governed result must contain only approved model, theme, and count fields, never customer text or identifiers.",
			{ forbiddenColumns },
		),
		check(
			"oldest_complete_watermark",
			watermark,
			"Product feedback and gBrain evidence must share one complete Monday-Sunday UTC week.",
			{ weekStarts, dataThroughValues },
		),
	];
}

function productFeedbackSql(weekStart: Date, dataThrough: Date): string {
	return `with model_registry(model, position) as (
  values ('1.9', 1), ('2', 2), ('2-pro', 3), ('3', 4)
), dirty_users as (
  select id
  from auth.users
  where coalesce(banned, false)
     or coalesce(disabled, false)
     or coalesce(is_anonymous, false)
     or lower(coalesce(email, '')) like '%@sync.so'
     or lower(coalesce(email, '')) like '%@sync.labs'
), generations as (
  select
    g.id,
    case
      when lower(g.model_name) like 'sync-1.9%' then '1.9'
      when lower(g.model_name) in ('sync-2', 'sync2', 'sync-2.0') then '2'
      when lower(g.model_name) in ('sync-2-pro', 'sync2-pro', 'sync-2.0-pro') then '2-pro'
      when lower(g.model_name) in ('sync-3', 'sync3') then '3'
      else null
    end as model
  from public.generations g
  where g.deleted_at is null
    and g.status = 'COMPLETED'
    and g.finished_at >= timestamptz '${sqlDate(weekStart)}'
    and g.finished_at < timestamptz '${sqlDate(dataThrough)}'
    and g.user_id is not null
    and not exists (select 1 from dirty_users d where d.id = g.user_id)
), ratings as (
  select f.generation_id, (f.feedback_type = 'upvote') as is_positive
  from public.generation_feedback f
  where f.feedback_type in ('upvote', 'downvote')
    and f.created_at < timestamptz '${sqlDate(dataThrough)}'
    and f.user_id is not null
    and not exists (select 1 from dirty_users d where d.id = f.user_id)
  union all
  select s.generation_id, (s.score >= 4) as is_positive
  from public.generation_score s
  where s.created_at < timestamptz '${sqlDate(dataThrough)}'
    and s.user_id is not null
    and not exists (select 1 from dirty_users d where d.id = s.user_id)
), aggregates as (
  select
    g.model,
    count(distinct g.id)::int as completed_generations,
    count(distinct r.generation_id)::int as rated_generations,
    count(r.generation_id)::int as feedback_events,
    count(r.generation_id) filter (where r.is_positive)::int as positive_feedback,
    count(r.generation_id) filter (where not r.is_positive)::int as negative_feedback
  from generations g
  left join ratings r on r.generation_id = g.id
  where g.model is not null
  group by g.model
)
select
  registry.model,
  coalesce(aggregates.completed_generations, 0)::int as completed_generations,
  coalesce(aggregates.rated_generations, 0)::int as rated_generations,
  coalesce(aggregates.feedback_events, 0)::int as feedback_events,
  coalesce(aggregates.positive_feedback, 0)::int as positive_feedback,
  coalesce(aggregates.negative_feedback, 0)::int as negative_feedback,
  round(100.0 * coalesce(aggregates.negative_feedback, 0) / nullif(aggregates.feedback_events, 0), 2) as negative_rate_pct,
  round(100.0 * coalesce(aggregates.rated_generations, 0) / nullif(aggregates.completed_generations, 0), 3) as coverage_pct
from model_registry registry
left join aggregates using (model)
order by registry.position
limit 10`;
}

function completeWeekBoundary(now: Date): Date {
	const value = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
	return value;
}

function sqlDate(value: Date): string {
	return value.toISOString();
}

function records(result: MetabaseResult): Row[] {
	return result.rows.map((row) =>
		Object.fromEntries(
			result.columns.map((column, index) => [column.name, row[index] ?? null]),
		),
	);
}

function text(value: unknown): string {
	return typeof value === "string" || typeof value === "number"
		? String(value).trim()
		: "";
}

function number(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator: number, denominator: number): number {
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
