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

export const marketingQuery = z.discriminatedUnion("source", [
	ga4Query,
	searchConsoleQuery,
	posthogQuery,
]);

export type MarketingQuery = z.infer<typeof marketingQuery>;
