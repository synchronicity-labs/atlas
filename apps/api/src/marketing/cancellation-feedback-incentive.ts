import { VerificationStatus } from "@crm/db";
import type {
	MetabaseClient,
	MetabaseResult,
} from "../metabase/metabase.client";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";
import type { MarketingClient } from "./marketing.client";
import type { MarketingQuery } from "./marketing.contracts";

type AutomatedReportQuery = Extract<
	MarketingQuery,
	{ source: "automated_report" }
>;
type Row = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const WEEKS = 12;
const ALLOWED_REASONS = new Set([
	"confused_about_billing",
	"missing_features",
	"not_using_enough",
	"one_project_only",
	"other",
	"quality_not_good_enough",
	"switched_to_competitor",
	"technical_issues",
	"too_expensive",
]);

export async function cancellationFeedbackIncentiveWeeklyReport(input: {
	query: AutomatedReportQuery;
	marketing: MarketingClient;
	metabase: MetabaseClient;
	productUserPredicate: string;
	now?: Date;
}): Promise<MetabaseResult> {
	if (
		input.query.recipe !== "product.cancellation-feedback-incentive-weekly" ||
		input.query.version !== 1
	) {
		throw new Error("Unsupported automated report recipe.");
	}
	const dataThrough = completeWeekBoundary(input.now ?? new Date());
	const periodStart = new Date(dataThrough.getTime() - WEEKS * WEEK_MS);
	const [posthog, product] = await Promise.all([
		input.marketing.execute({
			source: "posthog",
			personPolicy: "all_events",
			query: posthogQuery(periodStart, dataThrough, input.productUserPredicate),
		}),
		input.metabase.preview({
			language: "SQL",
			databaseExternalId: "34",
			queryText: productQuery(periodStart, dataThrough),
		}),
	]);
	const posthogByWeek = byWeek(posthog);
	const productRows = records(product);
	const productByWeek = new Map<string, Row>();
	const reasonsByWeek = new Map<string, Row[]>();
	for (const row of productRows) {
		const week = iso(row.week_start);
		if (text(row.row_kind) === "weekly_total") {
			if (productByWeek.has(week)) {
				throw new Error(`Product returned two total rows for ${week}.`);
			}
			productByWeek.set(week, row);
		} else if (text(row.row_kind) === "reason") {
			const reason = text(row.reason);
			if (!ALLOWED_REASONS.has(reason)) {
				throw new Error(`Unexpected cancellation reason ${reason}.`);
			}
			const rows = reasonsByWeek.get(week) ?? [];
			rows.push(row);
			reasonsByWeek.set(week, rows);
		} else {
			throw new Error("Product returned an unknown report row kind.");
		}
	}
	if (posthogByWeek.size !== WEEKS || productByWeek.size !== WEEKS) {
		throw new Error(
			"Both sources must return all twelve requested weeks explicitly.",
		);
	}
	const rows: unknown[][] = [];
	for (let index = 0; index < WEEKS; index += 1) {
		const weekStart = new Date(periodStart.getTime() + index * WEEK_MS);
		const week = weekStart.toISOString();
		const posthogRow = posthogByWeek.get(week);
		const productRow = productByWeek.get(week);
		if (!posthogRow || !productRow) {
			throw new Error(`A source is missing the requested week ${week}.`);
		}
		requireMeasures(posthogRow, [
			"offer_shown_organizations",
			"incentive_declines",
			"continued_cancellations",
			"saved_after_reward",
			"posthog_reward_claims",
			"posthog_call_requests",
			"posthog_reward_granted_cents",
		]);
		requireMeasures(productRow, [
			"feedback_submissions",
			"completed_feedback_submissions",
			"written_reward_claims",
			"call_requests",
			"reward_granted_cents",
			"reward_reversed_cents",
		]);
		rows.push(
			rowValues({
				weekStart: week,
				rowKind: "weekly_total",
				reason: "all",
				posthog: posthogRow,
				product: productRow,
				reasonResponses: 0,
				dataThrough,
			}),
		);
		for (const reason of reasonsByWeek.get(week) ?? []) {
			requireMeasures(reason, ["reason_responses"]);
			rows.push(
				rowValues({
					weekStart: week,
					rowKind: "reason",
					reason: text(reason.reason),
					posthog: {},
					product: {},
					reasonResponses: number(reason.reason_responses),
					dataThrough,
				}),
			);
		}
	}
	return {
		columns: [
			dateColumn("week_start"),
			textColumn("row_kind"),
			textColumn("reason"),
			decimalColumn("offer_shown_organizations"),
			decimalColumn("feedback_submissions"),
			decimalColumn("completed_feedback_submissions"),
			decimalColumn("written_reward_claims"),
			decimalColumn("call_requests"),
			decimalColumn("incentive_declines"),
			decimalColumn("continued_cancellations"),
			decimalColumn("saved_after_reward"),
			decimalColumn("reward_granted_usd"),
			decimalColumn("reward_reversed_usd"),
			decimalColumn("reason_responses"),
			decimalColumn("posthog_reward_claims"),
			decimalColumn("posthog_call_requests"),
			decimalColumn("posthog_reward_granted_usd"),
			dateColumn("period_end"),
			dateColumn("data_through"),
		],
		rows,
	};
}

export function cancellationFeedbackIncentiveVerificationChecks(
	result: MetabaseResult,
	query: AutomatedReportQuery,
): PublishVerificationCheck[] {
	const rows = records(result);
	const totals = rows.filter((row) => text(row.row_kind) === "weekly_total");
	const reasons = rows.filter((row) => text(row.row_kind) === "reason");
	const keys = rows.map(
		(row) =>
			`${text(row.week_start)}:${text(row.row_kind)}:${text(row.reason)}`,
	);
	const recipeMatches =
		query.recipe === "product.cancellation-feedback-incentive-weekly" &&
		query.version === 1;
	const funnelValid = totals.every((row) => {
		const offered = number(row.offer_shown_organizations);
		const earned = number(row.written_reward_claims);
		const calls = number(row.call_requests);
		const declined = number(row.incentive_declines);
		const cancelled = number(row.continued_cancellations);
		const saved = number(row.saved_after_reward);
		const submissions = number(row.feedback_submissions);
		const completed = number(row.completed_feedback_submissions);
		return (
			offered >= earned &&
			offered >= calls &&
			offered >= declined &&
			offered >= cancelled &&
			earned >= saved &&
			submissions >= completed &&
			completed >= earned &&
			completed >= calls
		);
	});
	const sourceParity = totals.every(
		(row) =>
			number(row.written_reward_claims) === number(row.posthog_reward_claims) &&
			number(row.call_requests) === number(row.posthog_call_requests) &&
			Math.abs(
				number(row.reward_granted_usd) - number(row.posthog_reward_granted_usd),
			) <= 0.01,
	);
	const reasonTotals = new Map<string, number>();
	for (const row of reasons) {
		const week = text(row.week_start);
		reasonTotals.set(
			week,
			(reasonTotals.get(week) ?? 0) + number(row.reason_responses),
		);
	}
	const reasonsValid =
		reasons.every((row) => ALLOWED_REASONS.has(text(row.reason))) &&
		totals.every(
			(row) =>
				(reasonTotals.get(text(row.week_start)) ?? 0) ===
				number(row.completed_feedback_submissions),
		);
	const forbiddenColumns = result.columns
		.map((column) => column.name.toLowerCase())
		.filter((name) =>
			[
				"additional_comments",
				"competitor_name",
				"distinct_id",
				"email",
				"organization_id",
				"user_id",
			].includes(name),
		);
	const privacyValid = forbiddenColumns.length === 0;
	const watermarks = new Set(rows.map((row) => text(row.data_through)));
	const weeks = totals.map((row) => Date.parse(text(row.week_start)));
	const completeWeeks =
		totals.length === WEEKS &&
		watermarks.size === 1 &&
		weeks.every((week, index) => {
			const end = Date.parse(text(totals[index]?.period_end));
			const dataThrough = Date.parse(text(totals[index]?.data_through));
			return (
				Number.isFinite(week) &&
				Number.isFinite(end) &&
				end - week === WEEK_MS &&
				end <= dataThrough
			);
		});
	const uniqueRows = new Set(keys).size === keys.length;
	return [
		check(
			"approved_automated_recipe",
			recipeMatches,
			"The saved question must reference the reviewed cancellation-feedback recipe and version.",
			{ recipe: query.recipe, version: query.version },
		),
		check(
			"incentive_funnel_reconciliation",
			funnelValid,
			"Every weekly funnel stage must remain a valid subset of its governed organization population.",
			{ weeks: totals.length },
		),
		check(
			"product_posthog_parity",
			sourceParity,
			"Written rewards, call requests, and granted value must reconcile between Product Postgres and PostHog.",
			{ weeks: totals.length },
		),
		check(
			"structured_reason_reconciliation",
			reasonsValid,
			"Only the approved structured reason taxonomy is published, and reason totals must equal completed feedback submissions.",
			{ reasonRows: reasons.length },
		),
		check(
			"sensitive_detail_boundary",
			privacyValid,
			"The governed result excludes customer identifiers, competitor names, and free text.",
			{ forbiddenColumns },
		),
		check(
			"complete_week_watermark",
			completeWeeks && uniqueRows,
			"The result must contain twelve unique complete Monday-Sunday UTC weeks under one data-through boundary.",
			{ weeks: totals.length, watermarks: [...watermarks], uniqueRows },
		),
	];
}

function rowValues(input: {
	weekStart: string;
	rowKind: "weekly_total" | "reason";
	reason: string;
	posthog: Row;
	product: Row;
	reasonResponses: number;
	dataThrough: Date;
}) {
	const total = input.rowKind === "weekly_total";
	return [
		input.weekStart,
		input.rowKind,
		input.reason,
		total ? number(input.posthog.offer_shown_organizations) : 0,
		total ? number(input.product.feedback_submissions) : 0,
		total ? number(input.product.completed_feedback_submissions) : 0,
		total ? number(input.product.written_reward_claims) : 0,
		total ? number(input.product.call_requests) : 0,
		total ? number(input.posthog.incentive_declines) : 0,
		total ? number(input.posthog.continued_cancellations) : 0,
		total ? number(input.posthog.saved_after_reward) : 0,
		total ? centsToUsd(input.product.reward_granted_cents) : 0,
		total ? centsToUsd(input.product.reward_reversed_cents) : 0,
		input.reasonResponses,
		total ? number(input.posthog.posthog_reward_claims) : 0,
		total ? number(input.posthog.posthog_call_requests) : 0,
		total ? centsToUsd(input.posthog.posthog_reward_granted_cents) : 0,
		new Date(Date.parse(input.weekStart) + WEEK_MS).toISOString(),
		input.dataThrough.toISOString(),
	];
}

function posthogQuery(start: Date, end: Date, eligibility: string): string {
	const weeks = Array.from(
		{ length: WEEKS },
		(_, index) =>
			`parseDateTimeBestEffort('${new Date(start.getTime() + index * WEEK_MS).toISOString()}')`,
	).join(", ");
	return `with weeks as (
  select arrayJoin([${weeks}]) as week_start
), organization_weeks as (
  select
    toStartOfWeek(toTimeZone(timestamp, 'UTC'), 1) as week_start,
    toString(properties.organization_id) as organization_id,
    max(event = 'exit_survey_incentive_shown') as offer_shown,
    max(event = 'exit_survey_incentive_earned') as reward_claimed,
    max(event = 'exit_survey_call_requested') as call_requested,
    max(
      event = 'exit_survey_submitted'
      and lower(toString(properties.incentive_declined)) = 'true'
    ) as incentive_declined,
    max(event = 'exit_survey_incentive_save') as saved_after_reward,
    max(event in ('subscription_cancel_pending', 'subscription_canceled')) as continued_cancellation,
    maxIf(
      toFloatOrZero(toString(properties.amount_cents)),
      event = 'exit_survey_incentive_earned'
    ) as reward_granted_cents
  from events
  where event in (
    'exit_survey_incentive_shown',
    'exit_survey_incentive_earned',
    'exit_survey_incentive_save',
    'exit_survey_call_requested',
    'exit_survey_submitted',
    'subscription_cancel_pending',
    'subscription_canceled'
  )
    and toTimeZone(timestamp, 'UTC') >= parseDateTimeBestEffort('${start.toISOString()}')
    and toTimeZone(timestamp, 'UTC') < parseDateTimeBestEffort('${end.toISOString()}')
    and notEmpty(toString(properties.organization_id))
    and ${eligibility}
  group by week_start, organization_id
)
select
  weeks.week_start as week_start,
  countIf(offer_shown = 1) as offer_shown_organizations,
  countIf(offer_shown = 1 and incentive_declined = 1) as incentive_declines,
  countIf(offer_shown = 1 and continued_cancellation = 1) as continued_cancellations,
  countIf(reward_claimed = 1 and saved_after_reward = 1) as saved_after_reward,
  countIf(reward_claimed = 1) as posthog_reward_claims,
  countIf(call_requested = 1) as posthog_call_requests,
  coalesce(sum(reward_granted_cents), 0) as posthog_reward_granted_cents
from weeks
left join organization_weeks on weeks.week_start = organization_weeks.week_start
group by weeks.week_start
order by weeks.week_start
limit 100`;
}

function productQuery(start: Date, end: Date): string {
	return `with weeks as (
  select generate_series(
    timestamptz '${start.toISOString()}',
    timestamptz '${end.toISOString()}' - interval '1 week',
    interval '1 week'
  ) as week_start
), dirty_users as (
  select id
  from auth.users
  where coalesce(banned, false)
     or coalesce(is_anonymous, false)
     or lower(coalesce(email, '')) like '%@sync.so'
     or lower(coalesce(email, '')) like '%@sync.labs'
), eligible_feedback as (
  select
    feedback.*,
    date_trunc('week', feedback.created_at at time zone 'UTC') at time zone 'UTC' as week_start
  from public.cancellation_feedback feedback
  where feedback.created_at >= timestamptz '${start.toISOString()}'
    and feedback.created_at < timestamptz '${end.toISOString()}'
    and not exists (
      select 1 from dirty_users dirty where dirty.id = feedback.user_id
    )
), ranked_feedback as (
  select
    eligible_feedback.*,
    row_number() over (
      partition by organization_id, week_start
      order by created_at desc, id desc
    ) as feedback_rank
  from eligible_feedback
), canonical_feedback as (
  select *
  from ranked_feedback
  where feedback_rank = 1
), activity as (
  select
    week_start,
    count(distinct organization_id) filter (where reward_granted_at is not null)::int as written_reward_claims,
    count(distinct organization_id) filter (where call_requested_at is not null)::int as call_requests,
    coalesce(sum(reward_granted_cents), 0)::bigint as reward_granted_cents,
    coalesce(sum(reward_reversed_cents), 0)::bigint as reward_reversed_cents
  from eligible_feedback
  group by week_start
), totals as (
  select
    feedback.week_start,
    count(*)::int as feedback_submissions,
    count(*) filter (where feedback.completed)::int as completed_feedback_submissions,
    coalesce(activity.written_reward_claims, 0)::int as written_reward_claims,
    coalesce(activity.call_requests, 0)::int as call_requests,
    coalesce(activity.reward_granted_cents, 0)::bigint as reward_granted_cents,
    coalesce(activity.reward_reversed_cents, 0)::bigint as reward_reversed_cents
  from canonical_feedback feedback
  left join activity using (week_start)
  group by
    feedback.week_start,
    activity.written_reward_claims,
    activity.call_requests,
    activity.reward_granted_cents,
    activity.reward_reversed_cents
), reasons as (
  select
    week_start,
    reason,
    count(*)::int as reason_responses
  from canonical_feedback
  where completed
  group by 1, 2
)
select
  week_start,
  'weekly_total'::text as row_kind,
  'all'::text as reason,
  coalesce(feedback_submissions, 0)::int as feedback_submissions,
  coalesce(completed_feedback_submissions, 0)::int as completed_feedback_submissions,
  coalesce(written_reward_claims, 0)::int as written_reward_claims,
  coalesce(call_requests, 0)::int as call_requests,
  coalesce(reward_granted_cents, 0)::bigint as reward_granted_cents,
  coalesce(reward_reversed_cents, 0)::bigint as reward_reversed_cents,
  0::int as reason_responses
from weeks
left join totals using (week_start)
union all
select
  week_start,
  'reason'::text as row_kind,
  reason,
  0::int as feedback_submissions,
  0::int as completed_feedback_submissions,
  0::int as written_reward_claims,
  0::int as call_requests,
  0::bigint as reward_granted_cents,
  0::bigint as reward_reversed_cents,
  reason_responses
from reasons
order by week_start, row_kind, reason
limit 500`;
}

function byWeek(result: MetabaseResult): Map<string, Row> {
	const values = new Map<string, Row>();
	for (const row of records(result)) {
		const week = iso(row.week_start);
		if (values.has(week)) {
			throw new Error(`PostHog returned two rows for ${week}.`);
		}
		values.set(week, row);
	}
	return values;
}

function requireMeasures(row: Row, names: string[]) {
	for (const name of names) {
		const value = row[name];
		if (
			(typeof value !== "number" && typeof value !== "string") ||
			String(value).trim() === "" ||
			!Number.isFinite(Number(value)) ||
			Number(value) < 0
		) {
			throw new Error(`Source returned an invalid measure: ${name}.`);
		}
	}
}

function completeWeekBoundary(now: Date): Date {
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

function iso(value: unknown): string {
	const timestamp = Date.parse(text(value));
	if (!Number.isFinite(timestamp))
		throw new Error("Source returned an invalid week.");
	return new Date(timestamp).toISOString();
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

function centsToUsd(value: unknown): number {
	return Math.round(number(value)) / 100;
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
