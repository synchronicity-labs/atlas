import { z } from "zod";

const dateRange = z.enum(["6_months_and_mtd", "30_days", "90_days"]);
const property = z.enum([
	"landing",
	"blog",
	"playground",
	"docs",
	"lipsync",
	"support",
]);

export const ga4Query = z.object({
	source: z.literal("ga4"),
	properties: z.array(property).min(1).max(6),
	dateRange,
	dimensions: z.array(z.string().trim().min(1)).max(3),
	metrics: z.array(z.string().trim().min(1)).min(1).max(8),
	merge: z.enum(["sum", "series", "rows"]),
	limit: z.number().int().min(1).max(10_000).default(1_000),
	dimensionFilter: z
		.object({
			fieldName: z.string().trim().min(1),
			values: z.array(z.string()).min(1).max(100),
			caseSensitive: z.boolean().default(true),
		})
		.optional(),
});

export const searchConsoleQuery = z.object({
	source: z.literal("search_console"),
	site: z.enum(["sync", "lipsync"]),
	dateRange,
	dimensions: z
		.array(
			z.enum([
				"date",
				"query",
				"page",
				"country",
				"device",
				"searchAppearance",
			]),
		)
		.min(1)
		.max(3),
	aggregate: z.enum(["none", "month"]).default("none"),
	metrics: z
		.array(z.enum(["clicks", "impressions", "ctr_pct", "position"]))
		.min(1)
		.max(4)
		.default(["clicks", "impressions", "ctr_pct", "position"]),
	limit: z.number().int().min(1).max(25_000).default(1_000),
});

export const posthogQuery = z.object({
	source: z.literal("posthog"),
	personPolicy: z
		.enum(["exclude_banned_product_users", "all_events"])
		.default("exclude_banned_product_users"),
	query: z.string().trim().min(1).max(100_000),
});

const posthogNativeQuery = z
	.object({
		kind: z.literal("InsightVizNode"),
		source: z
			.object({
				kind: z.enum(["FunnelsQuery", "RetentionQuery"]),
			})
			.passthrough(),
	})
	.passthrough();

export const posthogInsightQuery = z.object({
	source: z.literal("posthog_insight"),
	mode: z.enum([
		"funnel_time_to_convert",
		"funnel_conversion",
		"retention_week_two",
	]),
	grain: z.enum(["week", "month"]),
	periods: z.number().int().min(2).max(12),
	query: posthogNativeQuery,
});

export const adobePluginQuery = z.object({
	source: z.literal("adobe_plugin"),
	report: z.literal("weekly-kpis"),
	version: z.literal(1),
});

export const productPagesQuery = z.object({
	source: z.literal("product_pages"),
	report: z.literal("weekly-funnel"),
	version: z.literal(1),
});

export const lipsyncTrafficQuery = z.object({
	source: z.literal("lipsync_traffic"),
	report: z.literal("weekly-acquisition"),
	version: z.literal(1),
});

export const apiAdoptionQuery = z.object({
	source: z.literal("api_adoption"),
	report: z.literal("weekly-adoption"),
	version: z.literal(1),
});

export const apiReliabilityQuery = z.object({
	source: z.literal("api_reliability"),
	report: z.literal("weekly-reliability"),
	version: z.literal(1),
});

export const modelFeedbackQuery = z.object({
	source: z.literal("model_feedback"),
	report: z.literal("weekly-coverage"),
	version: z.literal(1),
});

export const automatedReportQuery = z.object({
	source: z.literal("automated_report"),
	recipe: z.literal("product.cancellation-feedback-incentive-weekly"),
	version: z.literal(1),
});

export const marketingQuery = z.discriminatedUnion("source", [
	ga4Query,
	searchConsoleQuery,
	posthogQuery,
	posthogInsightQuery,
	adobePluginQuery,
	productPagesQuery,
	lipsyncTrafficQuery,
	apiAdoptionQuery,
	apiReliabilityQuery,
	modelFeedbackQuery,
	automatedReportQuery,
]);

export type MarketingQuery = z.infer<typeof marketingQuery>;
