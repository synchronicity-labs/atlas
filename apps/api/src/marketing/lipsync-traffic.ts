import { VerificationStatus } from "@crm/db";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";
import type { MarketingClient, MarketingResult } from "./marketing.client";
import type { MarketingConfig } from "./marketing.config";
import type { MarketingQuery } from "./marketing.contracts";

const DAY = 86_400_000;
export const LIPSYNC_TRAFFIC_CHECKS = [
	"lipsync_source_scope",
	"complete_source_weeks",
	"weekly_population",
	"metric_reconciliation",
	"aggregate_privacy",
] as const;
const COLUMNS = [
	"period_start",
	"source",
	"source_scope",
	"source_time_zone",
	"users",
	"sessions",
	"new_users",
	"engaged_sessions",
	"engagement_rate_pct",
	"average_session_duration",
	"clicks",
	"impressions",
	"ctr_pct",
	"position",
	"window_end",
	"source_data_through",
	"data_through",
];
type TrafficQuery = Extract<MarketingQuery, { source: "lipsync_traffic" }>;

export function completeMonday(now: Date, lagDays = 0): Date {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Los_Angeles",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const part = (type: string) => parts.find((p) => p.type === type)?.value;
	const date = new Date(
		`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`,
	);
	date.setUTCDate(date.getUTCDate() - lagDays);
	date.setUTCHours(0, 0, 0, 0);
	date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
	return date;
}

function records(result: MarketingResult): Record<string, unknown>[] {
	if (result.rows.some((row) => row.length !== result.columns.length)) {
		throw new Error("Lipsync weekly source returned a truncated row.");
	}
	return result.rows.map((row) =>
		Object.fromEntries(
			result.columns.map((column, i) => [column.name, row[i]]),
		),
	);
}

function count(value: unknown): number {
	if (value === null || value === undefined || value === "") {
		throw new Error("Lipsync weekly source returned a missing metric.");
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error("Lipsync weekly source returned an invalid metric.");
	}
	return parsed;
}

export async function lipsyncTrafficWeeklyReport(input: {
	query: TrafficQuery;
	marketing: Pick<MarketingClient, "ga4Range" | "searchConsoleRange">;
	config: Pick<MarketingConfig, "ga4" | "searchConsole">;
	now?: Date;
}): Promise<MarketingResult> {
	if (
		input.config.ga4.lipsync?.id !== "525331485" ||
		input.config.searchConsole.lipsync !== "sc-domain:lipsync.com"
	) {
		throw new Error(
			"Lipsync weekly report requires its reviewed GA4 property and Search Console site.",
		);
	}
	const now = input.now ?? new Date();
	const gaEnd = completeMonday(now);
	const searchEnd = completeMonday(now, 3);
	const commonThrough = new Date(
		Math.min(gaEnd.getTime(), searchEnd.getTime()),
	).toISOString();
	const rows: unknown[][] = [];
	for (const source of ["ga4", "search_console"] as const) {
		const end = source === "ga4" ? gaEnd : searchEnd;
		for (const offset of [2, 1]) {
			const start = new Date(end.getTime() - offset * 7 * DAY);
			const windowEnd = new Date(start.getTime() + 7 * DAY);
			if (source === "ga4") {
				const result = await input.marketing.ga4Range(
					{
						source: "ga4",
						properties: ["lipsync"],
						dateRange: "30_days",
						dimensions: [],
						metrics: [
							"totalUsers",
							"sessions",
							"newUsers",
							"engagedSessions",
							"averageSessionDuration",
						],
						merge: "rows",
						limit: 1,
					},
					start,
					windowEnd,
				);
				const [row] = records(result);
				if (
					!row ||
					result.rows.length !== 1 ||
					row.site !== "lipsync.com" ||
					result.sourceTimeZone !== "America/Los_Angeles"
				) {
					throw new Error(
						"Lipsync GA4 weekly total or property time zone is unavailable.",
					);
				}
				const sessions = count(row.sessions);
				const engaged = count(row.engagedSessions);
				rows.push([
					start.toISOString(),
					source,
					"525331485",
					result.sourceTimeZone,
					count(row.totalUsers),
					sessions,
					count(row.newUsers),
					engaged,
					sessions ? (engaged / sessions) * 100 : 0,
					count(row.averageSessionDuration),
					null,
					null,
					null,
					null,
					windowEnd.toISOString(),
					windowEnd.toISOString(),
					commonThrough,
				]);
			} else {
				const query: Extract<MarketingQuery, { source: "search_console" }> = {
					source: "search_console",
					site: "lipsync",
					dateRange: "30_days",
					dimensions: [],
					aggregate: "none",
					metrics: ["clicks", "impressions", "ctr_pct", "position"],
					limit: 25_000,
				};
				const total = await input.marketing.searchConsoleRange(
					query,
					start,
					windowEnd,
				);
				const daily = await input.marketing.searchConsoleRange(
					{ ...query, dimensions: ["date"] },
					start,
					windowEnd,
				);
				const dates = records(daily)
					.map((row) => String(row.date).slice(0, 10))
					.sort();
				const expected = Array.from({ length: 7 }, (_, i) =>
					new Date(start.getTime() + i * DAY).toISOString().slice(0, 10),
				);
				if (JSON.stringify(dates) !== JSON.stringify(expected)) {
					throw new Error(
						"Lipsync Search Console does not have seven finalized daily rows for this week.",
					);
				}
				const [row] = records(total);
				if (!row || total.rows.length !== 1) {
					throw new Error(
						"Lipsync Search Console weekly total is unavailable.",
					);
				}
				const clicks = count(row.clicks);
				const impressions = count(row.impressions);
				const dailyRows = records(daily);
				if (
					dailyRows.reduce((sum, value) => sum + count(value.clicks), 0) !==
						clicks ||
					dailyRows.reduce(
						(sum, value) => sum + count(value.impressions),
						0,
					) !== impressions
				) {
					throw new Error(
						"Lipsync Search Console daily totals do not reconcile to the weekly total.",
					);
				}
				rows.push([
					start.toISOString(),
					source,
					"sc-domain:lipsync.com",
					"America/Los_Angeles",
					null,
					null,
					null,
					null,
					null,
					null,
					clicks,
					impressions,
					impressions ? (clicks / impressions) * 100 : 0,
					count(row.position),
					windowEnd.toISOString(),
					windowEnd.toISOString(),
					commonThrough,
				]);
			}
		}
	}
	return {
		columns: COLUMNS.map((name) => ({
			name,
			displayName: name,
			baseType: /start|end|through/.test(name)
				? "type/DateTime"
				: name.startsWith("source")
					? "type/Text"
					: "type/Decimal",
		})),
		rows,
	};
}

export function lipsyncTrafficVerificationChecks(
	result: MarketingResult,
	query: TrafficQuery,
): PublishVerificationCheck[] {
	const rows = records(result);
	const ga = rows.filter((r) => r.source === "ga4");
	const search = rows.filter((r) => r.source === "search_console");
	const finite = (r: Record<string, unknown>, names: string[]) =>
		names.every(
			(name) =>
				r[name] !== null &&
				Number.isFinite(Number(r[name])) &&
				Number(r[name]) >= 0,
		);
	const rate = (r: Record<string, unknown>, n: string, d: string, p: string) =>
		Math.abs(
			Number(r[p]) - (Number(r[d]) ? (Number(r[n]) / Number(r[d])) * 100 : 0),
		) < 0.01;
	const values = [
		query.source === "lipsync_traffic" &&
			query.report === "weekly-acquisition" &&
			query.version === 1 &&
			ga.length === 2 &&
			search.length === 2 &&
			ga.every((r) => r.source_scope === "525331485") &&
			search.every((r) => r.source_scope === "sc-domain:lipsync.com"),
		rows.length === 4 &&
			[ga, search].every(
				(group) =>
					new Set(group.map((r) => r.period_start)).size === 2 &&
					Math.abs(
						new Date(String(group[1]?.period_start)).getTime() -
							new Date(String(group[0]?.period_start)).getTime(),
					) ===
						7 * DAY &&
					group.every((r) => {
						const start = new Date(String(r.period_start));
						const end = new Date(String(r.window_end));
						return (
							start.getUTCDay() === 1 &&
							end.getTime() - start.getTime() === 7 * DAY &&
							end.getTime() <= completeMonday(new Date()).getTime() &&
							r.source_time_zone === "America/Los_Angeles" &&
							r.source_data_through === r.window_end
						);
					}),
			),
		ga.every((r) =>
			finite(r, [
				"users",
				"sessions",
				"new_users",
				"engaged_sessions",
				"engagement_rate_pct",
				"average_session_duration",
			]),
		) &&
			search.every((r) =>
				finite(r, ["clicks", "impressions", "ctr_pct", "position"]),
			),
		ga.every(
			(r) =>
				Number(r.engaged_sessions) <= Number(r.sessions) &&
				rate(r, "engaged_sessions", "sessions", "engagement_rate_pct"),
		) &&
			search.every(
				(r) =>
					Number(r.clicks) <= Number(r.impressions) &&
					rate(r, "clicks", "impressions", "ctr_pct"),
			),
		JSON.stringify(result.columns.map((c) => c.name)) ===
			JSON.stringify(COLUMNS),
	];
	return LIPSYNC_TRAFFIC_CHECKS.map((name, i) => ({
		name,
		status: values[i] ? VerificationStatus.PASSED : VerificationStatus.FAILED,
		reason: values[i]
			? "Reviewed Lipsync weekly source contract passed."
			: "Lipsync weekly source contract failed.",
	}));
}
