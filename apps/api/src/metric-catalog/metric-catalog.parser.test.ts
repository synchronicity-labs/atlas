import { describe, expect, test } from "bun:test";
import {
	catalogCandidates,
	normalizedMetricName,
} from "./metric-catalog.parser";

describe("metric catalog parser", () => {
	test("imports consolidated KPI rows and preserves views", () => {
		const candidates = catalogCandidates([
			{
				id: 1,
				title: "KPIs",
				index: 0,
				rows: [
					["Domain", "KPI", "type", "what it means"],
					[
						"Product",
						"# of monthly active professional orgs",
						"primary",
						"Definition",
					],
					["", " ↳ split by door", "view", ""],
				],
			},
		]);

		expect(candidates).toHaveLength(2);
		expect(candidates[0]).toMatchObject({
			title: "# of monthly active professional orgs",
			ownerTeam: "Product",
			kind: "KPI",
		});
		expect(candidates[1]).toMatchObject({
			title: "split by door",
			ownerTeam: "Product",
			kind: "VIEW",
		});
	});

	test("finds typed metrics outside the consolidated tab", () => {
		const candidates = catalogCandidates([
			{
				id: 2,
				title: "engineering",
				index: 1,
				rows: [
					["[primary]", "generation upvote rate", "Share of rated generations"],
				],
			},
		]);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			title: "generation upvote rate",
			ownerTeam: "engineering",
			kind: "KPI",
		});
	});

	test("imports team success criteria as roadmap measures and skips plain initiatives", () => {
		const candidates = catalogCandidates([
			{
				id: 3,
				title: "marketing",
				index: 2,
				rows: [
					["Main Initiative", "Sub Initiative", "Q3 Success Criteria"],
					["SEO / GEO", "", "Own the category in search and LLM answers"],
					["", "Website structure", ""],
				],
			},
		]);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			title: "SEO / GEO",
			description: "Own the category in search and LLM answers",
			kind: "ROADMAP_MEASURE",
		});
	});

	test("normalizes common metric naming differences", () => {
		expect(
			normalizedMetricName("# of monthly active professional organizations"),
		).toBe("active professional org");
		expect(
			normalizedMetricName("Average monthly active professional orgs"),
		).toBe("active professional orgs");
	});
});
