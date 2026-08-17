import { describe, expect, test } from "bun:test";
import { DataSourceKind, QueryLanguage } from "@crm/db";
import type { CatalogCandidate } from "./metric-catalog.parser";
import { catalogQuestionSpec } from "./metric-catalog.questions";

function candidate(title: string): CatalogCandidate {
	return {
		title,
		description: null,
		ownerTeam: "Company",
		sourceTabId: 1,
		sourceTabName: "KPIs",
		sourceTabIndex: 0,
		sourceRange: "KPIs!A1:B1",
		sourceRow: 1,
		sourceHint: null,
		trackability: null,
		kind: "KPI",
		readinessHint: "READY_TO_IMPLEMENT",
		rawRow: [title],
		ambiguities: [],
		externalKey: `KPIs:${title}`,
	};
}

describe("metric catalog question specs", () => {
	test.each([
		"Gross Logo Retention",
		"SOWs/ MSA's signed",
		"Channel Partner Revenue by Partner",
		"gross margin",
		"revenue concentration",
		"active rate (north star ÷ paid teams)",
	])("provides a live provisional query for %s", (title) => {
		const spec = catalogQuestionSpec(candidate(title));

		expect(spec).not.toBeNull();
		expect(spec?.queryText.length).toBeGreaterThan(20);
		expect(spec?.provisionalDefinition).toStartWith("Provisional:");
	});

	test("uses HubSpot company grouping for channel partner revenue", () => {
		const spec = catalogQuestionSpec(
			candidate("Channel Partner Revenue by Partner"),
		);

		expect(spec).toMatchObject({
			connector: DataSourceKind.HUBSPOT,
			queryLanguage: QueryLanguage.API,
		});
		expect(JSON.parse(spec?.queryText ?? "{}")).toMatchObject({
			report: "closed-won-by-company",
			pipelines: ["2085894842"],
		});
	});

	test("does not invent a query for an unknown KPI", () => {
		expect(catalogQuestionSpec(candidate("Unknown metric"))).toBeNull();
	});
});
