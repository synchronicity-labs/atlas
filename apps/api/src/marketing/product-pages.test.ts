import { describe, expect, test } from "bun:test";
import type {
	MetabaseClient,
	MetabaseResult,
} from "../metabase/metabase.client";
import type { MarketingClient } from "./marketing.client";
import {
	productPagesVerificationChecks,
	productPagesWeeklyReport,
} from "./product-pages";

const query = {
	source: "product_pages" as const,
	report: "weekly-funnel" as const,
	version: 1 as const,
};
const slugs = [
	"auto-dubbing",
	"video-translator",
	"free-video-translator",
	"ai-dubbing",
	"web-dubbing",
	"video-dubbing",
	"voice-cloning",
	"translate-video-to-english",
	"translate-hindi-video",
	"translate-french-video",
];

describe("product pages weekly report", () => {
	test("publishes the complete registry under one verified window", async () => {
		const report = await build();
		const checks = productPagesVerificationChecks(report, query);

		expect(checks.every((check) => check.status === "PASSED")).toBe(true);
		expect(
			records(report)
				.map((row) => row.page)
				.sort(),
		).toEqual(slugs.map((slug) => `/product/${slug}`).sort());
		expect(new Set(records(report).map((row) => row.data_through))).toEqual(
			new Set(["2026-08-24T00:00:00.000Z"]),
		);
		expect(report.columns.map((column) => column.name)).not.toContain(
			"organization_id",
		);
	});

	test("fails verification when attribution coverage does not reconcile", async () => {
		const report = await build();
		const index = report.columns.findIndex(
			(column) => column.name === "recognized_product_page_signups",
		);
		const first = report.rows[0];
		if (!first) throw new Error("expected product-page rows");
		first[index] = 4;

		const check = productPagesVerificationChecks(report, query).find(
			(candidate) => candidate.name === "first_touch_coverage",
		);
		expect(check?.status).toBe("FAILED");
	});

	test("rejects an organization assigned to two pages", async () => {
		const metabase = {
			preview: async (input: { databaseExternalId: string }) =>
				input.databaseExternalId === "34"
					? attribution([["org-1"], ["org-1"]])
					: result(["organization_id", "subscriptions"], []),
		} as unknown as MetabaseClient;

		expect(build(metabase)).rejects.toThrow(
			"Product-page first-touch attribution is not unique.",
		);
	});
});

async function build(metabase: MetabaseClient = defaultMetabase()) {
	return productPagesWeeklyReport({
		query,
		now: new Date("2026-08-26T12:00:00.000Z"),
		marketing: {
			ga4Range: async () =>
				result(
					["site", "totalUsers", "sessions", "engagementRate"],
					[["Blog", 10, 12, 75]],
				),
		} as unknown as MarketingClient,
		metabase,
	});
}

function defaultMetabase() {
	return {
		preview: async (input: { databaseExternalId: string }) =>
			input.databaseExternalId === "34"
				? attribution([["org-1", "org-2"], ["org-3"]])
				: result(
						["organization_id", "subscriptions"],
						[
							["org-1", 1],
							["org-3", 2],
						],
					),
	} as unknown as MetabaseClient;
}

function attribution(organizationLists: string[][]) {
	return result(
		[
			"slug",
			"signups",
			"attributed_organizations",
			"organization_ids",
			"all_clean_signups",
			"claimed_product_page_signups",
			"recognized_product_page_signups",
		],
		slugs.map((slug, index) => [
			slug,
			index === 0 ? 3 : index === 1 ? 2 : 0,
			organizationLists[index]?.length ?? 0,
			organizationLists[index] ?? [],
			100,
			5,
			5,
		]),
	);
}

function result(names: string[], rows: unknown[][]): MetabaseResult {
	return {
		columns: names.map((name) => ({ name, displayName: name, baseType: null })),
		rows,
	};
}

function records(value: MetabaseResult) {
	return value.rows.map((row) =>
		Object.fromEntries(
			value.columns.map((column, index) => [column.name, row[index] ?? null]),
		),
	);
}
