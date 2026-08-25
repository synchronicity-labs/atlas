import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import type { MarketingQuery } from "./marketing.contracts";
import { studioInsightVerificationChecks } from "./studio-insight-verification";

type InsightQuery = Extract<MarketingQuery, { source: "posthog_insight" }>;

function result(columns: string[], rows: unknown[][]): MetabaseResult {
	return {
		columns: columns.map((name) => ({
			name,
			displayName: name,
			baseType: null,
		})),
		rows,
	};
}

const timeQuery: InsightQuery = {
	source: "posthog_insight",
	mode: "funnel_time_to_convert",
	grain: "week",
	periods: 3,
	query: {
		kind: "InsightVizNode",
		source: {
			kind: "FunnelsQuery",
			filterTestAccounts: true,
			series: [
				{ event: "$pageview" },
				{ event: "user_signed_up" },
				{
					event: "playground_started_generation",
					properties: [
						{
							key: "source",
							operator: "is_not",
							value: ["plugin_premiere", "agent"],
						},
					],
				},
				{
					event: "playground_completed_generation",
					properties: [
						{
							key: "source",
							operator: "is_not",
							value: ["plugin_premiere", "agent"],
						},
					],
				},
			],
			funnelsFilter: {
				funnelFromStep: 1,
				funnelToStep: 3,
				funnelVizType: "time_to_convert",
				funnelWindowInterval: 30,
				funnelWindowIntervalUnit: "minute",
			},
		},
	},
};

const conversionQuery: InsightQuery = {
	source: "posthog_insight",
	mode: "funnel_conversion",
	grain: "month",
	periods: 3,
	query: {
		kind: "InsightVizNode",
		source: {
			kind: "FunnelsQuery",
			filterTestAccounts: true,
			series: [{ event: "user_signed_up" }, { event: "subscription_created" }],
			funnelsFilter: {
				funnelOrderType: "ordered",
				funnelWindowInterval: 6,
				funnelWindowIntervalUnit: "week",
			},
		},
	},
};

const retentionQuery: InsightQuery = {
	source: "posthog_insight",
	mode: "retention_week_two",
	grain: "week",
	periods: 8,
	query: {
		kind: "InsightVizNode",
		source: {
			kind: "RetentionQuery",
			filterTestAccounts: true,
			retentionFilter: {
				period: "Week",
				retentionType: "retention_recurring",
				totalIntervals: 3,
				targetEntity: {
					id: "playground_completed_generation",
					properties: [
						{
							key: "source",
							operator: "is_not",
							value: ["plugin_premiere"],
						},
					],
				},
				returningEntity: {
					id: "playground_completed_generation",
					properties: [
						{
							key: "source",
							operator: "is_not",
							value: ["plugin_premiere"],
						},
					],
				},
			},
		},
	},
};

describe("Studio native insight verification", () => {
	test("passes the approved time-to-magic funnel", () => {
		const checks = studioInsightVerificationChecks(
			result(
				[
					"period_start",
					"median_seconds",
					"average_seconds",
					"converted_users",
					"window_end",
					"data_through",
				],
				[["2026-08-10", 480, 600, 100, "2026-08-17", "2026-08-17"]],
			),
			timeQuery,
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(6).fill(VerificationStatus.PASSED),
		);
	});

	test("passes reconciled signup conversion", () => {
		const checks = studioInsightVerificationChecks(
			result(
				[
					"period_start",
					"signups",
					"subscriptions",
					"conversion_pct",
					"window_end",
					"data_through",
				],
				[["2026-05-01", 200, 25, 12.5, "2026-08-01", "2026-08-01"]],
			),
			conversionQuery,
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(6).fill(VerificationStatus.PASSED),
		);
	});

	test("passes a mature reconciled week-two cohort", () => {
		const checks = studioInsightVerificationChecks(
			result(
				[
					"cohort_week",
					"cohort_users",
					"week_two_users",
					"week_two_retention_pct",
					"window_end",
					"data_through",
				],
				[["2026-07-27", 800, 80, 10, "2026-08-24", "2026-08-24"]],
			),
			retentionQuery,
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(6).fill(VerificationStatus.PASSED),
		);
	});

	test("rejects a changed funnel window and an immature cohort", () => {
		const changed = structuredClone(conversionQuery);
		changed.query.source.funnelsFilter = {
			funnelOrderType: "ordered",
			funnelWindowInterval: 1,
			funnelWindowIntervalUnit: "week",
		};
		const definition = studioInsightVerificationChecks(
			result(
				[
					"period_start",
					"signups",
					"subscriptions",
					"conversion_pct",
					"window_end",
					"data_through",
				],
				[["2026-05-01", 200, 25, 12.5, "2026-08-01", "2026-08-01"]],
			),
			changed,
		);
		expect(
			definition.find((check) => check.name === "native_insight_definition")
				?.status,
		).toBe(VerificationStatus.FAILED);

		const changedExclusions = structuredClone(timeQuery);
		const series = changedExclusions.query.source.series as Array<{
			properties?: Array<{ value?: string[] }>;
		}>;
		const properties = series[2]?.properties;
		if (properties?.[0]) properties[0].value = ["plugin_premiere"];
		const exclusionDefinition = studioInsightVerificationChecks(
			result(
				[
					"period_start",
					"median_seconds",
					"average_seconds",
					"converted_users",
					"window_end",
					"data_through",
				],
				[["2026-08-10", 480, 600, 100, "2026-08-17", "2026-08-17"]],
			),
			changedExclusions,
		);
		expect(
			exclusionDefinition.find(
				(check) => check.name === "native_insight_definition",
			)?.status,
		).toBe(VerificationStatus.FAILED);

		const maturity = studioInsightVerificationChecks(
			result(
				[
					"cohort_week",
					"cohort_users",
					"week_two_users",
					"week_two_retention_pct",
					"window_end",
					"data_through",
				],
				[["2026-08-10", 800, 80, 10, "2026-08-24", "2026-08-24"]],
			),
			retentionQuery,
		);
		expect(
			maturity.find((check) => check.name === "cohort_maturity")?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("registers the five native questions without a HogQL fallback", async () => {
		const migration = await Bun.file(
			new URL(
				"../../../../packages/db/prisma/migrations/20260825234500_studio_native_insight_metrics/migration.sql",
				import.meta.url,
			),
		).text();

		for (const number of [272, 273, 274, 275, 276]) {
			expect(migration).toContain(`, ${number},`);
		}
		for (const insight of ["Sab6fNKH", "TYEh8QQK", "Lm7NbIhY"]) {
			expect(migration).toContain(insight);
		}
		expect(migration).toContain('"retentionType":"retention_recurring"');
		expect(migration).toContain('"totalIntervals":3');
		expect(migration).not.toContain("HogQLQuery");
	});
});
