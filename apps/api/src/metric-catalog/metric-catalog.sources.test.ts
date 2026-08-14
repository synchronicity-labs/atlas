import { describe, expect, test } from "bun:test";
import { resolveCatalogSources } from "./metric-catalog.sources";

const sources = [
	{ key: "hubspot:crm", state: "HEALTHY" as const },
	{ key: "atlas:marketing", state: "ERROR" as const },
	{ key: "tinybird:usage", state: "HEALTHY" as const },
	{ key: "metabase:sync", state: "HEALTHY" as const },
];

describe("metric catalog source resolution", () => {
	test("resolves explicit connected sources", () => {
		const result = resolveCatalogSources(
			{
				title: "New logos closed",
				description: null,
				ownerTeam: "Sales",
				sourceTabName: "KPIs",
				sourceHint: "HubSpot",
				kind: "KPI",
			},
			sources,
		);

		expect(result[0]).toMatchObject({
			key: "hubspot:crm",
			state: "CONNECTED",
			confidence: "EXPLICIT",
		});
	});

	test("shows connector errors separately from missing sources", () => {
		const result = resolveCatalogSources(
			{
				title: "SEO / GEO",
				description: "Own search and LLM answers",
				ownerTeam: "Marketing",
				sourceTabName: "marketing",
				sourceHint: null,
				kind: "ROADMAP_MEASURE",
			},
			sources,
		);

		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "atlas:marketing",
					state: "ATTENTION",
				}),
				expect.objectContaining({
					key: "linear:projects",
					state: "MISSING",
				}),
			]),
		);
	});
});
