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

	test("skips roadmap tasks and imports only explicitly tagged measures", () => {
		const candidates = catalogCandidates([
			{
				id: 3,
				title: "marketing",
				index: 2,
				rows: [
					["Main Initiative", "Sub Initiative", "Q3 Success Criteria"],
					["SEO / GEO", "", "Own the category in search and LLM answers"],
					["Security", "Hiring", "Hire 1 security engineer"],
					[
						"Final-mile lipsync",
						"Studio checkpoint",
						"80% of shots pass without VFX rework",
					],
					[
						"Product quality",
						"[guardrail] generation completion rate",
						"At least 99%",
					],
				],
			},
		]);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			title: "generation completion rate",
			description: "At least 99%",
			kind: "KPI",
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

	test("does not reopen Product rules confirmed by the KPI sheet and owner", () => {
		const candidates = catalogCandidates([
			{
				id: 5,
				title: "KPIs",
				index: 0,
				rows: [
					["Domain", "KPI", "type", "what it means"],
					[
						"Product",
						"# of monthly active professional orgs",
						"primary",
						"$100+ accrued value, 3+ completed billable generations, and activity on 2+ distinct days.",
					],
					[
						"Product",
						"% generation completion rate",
						"guardrail",
						"Completed generation records divided by all non-deleted generation records.",
					],
				],
			},
		]);

		expect(candidates).toHaveLength(2);
		expect(
			candidates.every((candidate) => candidate.ambiguities.length === 0),
		).toBe(true);
	});

	test("uses the Productions owner's confirmed definitions without certifying missing event history", () => {
		const candidates = catalogCandidates([
			{
				id: 8,
				title: "KPIs",
				index: 0,
				rows: [
					[
						"Domain",
						"KPI",
						"type",
						"what it means",
						"Source",
						"Trackable Today?",
					],
					[
						"Productions",
						"Turnaround time against the quality bar",
						"primary",
						"Old definition",
						"Manual (Slack, Sheets) → workspaces",
						"Partially",
					],
					[
						"Productions",
						"Time spent per shot",
						"input",
						"Old definition",
						"Manual (Slack threads) → workspaces",
						"Barely",
					],
					[
						"Productions",
						"Iterations per shot",
						"input",
						"Old definition",
						"Manual (Sheet ML + VFX versions) → workspaces",
						"Barely",
					],
				],
			},
		]);

		expect(candidates).toHaveLength(3);
		expect(
			candidates.every((candidate) => candidate.ambiguities.length === 0),
		).toBe(true);
		expect(
			candidates.every(
				(candidate) => candidate.readinessHint === "NEEDS_SOURCE",
			),
		).toBe(true);
		expect(candidates[0]?.description).toContain("all usable source files");
		expect(candidates[1]?.description).toContain("Actual human work hours");
		expect(candidates[2]?.description).toContain("batch review round");
	});

	test("keeps confirmed Product rows as KPIs when repeated rows omit the type", () => {
		const candidates = catalogCandidates([
			{
				id: 7,
				title: "KPIs",
				index: 0,
				rows: [
					["Domain", "KPI", "type", "what it means"],
					["Product", "# of monthly active professional orgs", "primary", ""],
					[
						"",
						"$ avg monthly accrued value from professional orgs",
						"",
						"Average monthly allocated subscription value plus usage consumed by active professional orgs.",
					],
				],
			},
		]);

		expect(
			candidates.map((candidate) => [candidate.title, candidate.kind]),
		).toEqual([
			["# of monthly active professional orgs", "KPI"],
			["$ avg monthly accrued value from professional orgs", "KPI"],
		]);
	});

	test("requires a concrete connector before marking a metric ready", () => {
		const candidates = catalogCandidates([
			{
				id: 4,
				title: "KPIs",
				index: 0,
				rows: [
					[
						"Domain",
						"KPI",
						"type",
						"what it means",
						"Source",
						"Trackable Today?",
					],
					[
						"Finance",
						"net burn + runway",
						"lagging",
						"",
						"finance (matt hobbs)",
						"Yes",
					],
					[
						"Marketing",
						"Website Visitors",
						"primary",
						"",
						"GA4 / PostHog",
						"Yes",
					],
					["", "Social Media Growth", "input", "", "Platform analytics", "Yes"],
				],
			},
		]);

		expect(candidates.map((candidate) => candidate.readinessHint)).toEqual([
			"NEEDS_DEFINITION",
			"READY_TO_IMPLEMENT",
			"NEEDS_SOURCE",
		]);
	});

	test("does not mistake a named source for a complete business definition", () => {
		const candidates = catalogCandidates([
			{
				id: 5,
				title: "KPIs",
				index: 0,
				rows: [
					["Domain", "KPI", "type", "what it means", "Source"],
					["Sales", "New Logos Closed (by segment)", "lagging", "", "HubSpot"],
					["Marketing", "SEO / GEO Breakdown", "input", "", "GA4 + PostHog"],
					[
						"CS",
						"Enterprise Usage",
						"primary",
						"Generation volume relative to committed contract value",
						"TinyBird / Metabase",
					],
				],
			},
		]);

		expect(candidates.map((candidate) => candidate.readinessHint)).toEqual([
			"NEEDS_DEFINITION",
			"NEEDS_DEFINITION",
			"NEEDS_DEFINITION",
		]);
		expect(
			candidates.every((candidate) => candidate.ambiguities.length > 0),
		).toBe(true);
	});

	test("explains the finance decision for net burn and runway", () => {
		const candidates = catalogCandidates([
			{
				id: 6,
				title: "KPIs",
				index: 0,
				rows: [
					["Domain", "KPI", "type", "what it means", "Source"],
					["Finance", "net burn + runway", "lagging", "", "finance"],
				],
			},
		]);

		expect(candidates[0]?.ambiguities).toEqual([
			{
				key: "burn_and_runway_basis",
				label:
					"Decide which cash accounts count toward runway, what to leave out of net burn (financing and transfers between our own accounts), and whether runway uses last month, the last 3 months, or Finance's forecast.",
			},
		]);
	});
});
