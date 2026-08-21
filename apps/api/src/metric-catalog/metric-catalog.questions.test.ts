import { describe, expect, test } from "bun:test";
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
		"gross margin",
		"revenue concentration",
		"active rate (north star ÷ paid teams)",
	])("provides a live provisional query for %s", (title) => {
		const spec = catalogQuestionSpec(candidate(title));

		expect(spec).not.toBeNull();
		expect(spec?.queryText.length).toBeGreaterThan(20);
		expect(spec?.provisionalDefinition).toStartWith("Provisional:");
	});

	test("does not replace the governed partner reconciliation with a HubSpot estimate", () => {
		const spec = catalogQuestionSpec(
			candidate("Channel Partner Revenue by Partner"),
		);

		expect(spec).toBeNull();
	});

	test("does not publish retention for a cohort without a complete next month", () => {
		const spec = catalogQuestionSpec(candidate("Gross Logo Retention"));

		expect(spec?.queryText).toContain(
			"where current.month < (select max(month) from paid_org_months)",
		);
	});

	test("assigns Product activity to the month when a generation started", () => {
		const spec = catalogQuestionSpec(
			candidate("active rate (north star ÷ paid teams)"),
		);

		expect(spec?.queryText).toContain('"generationCreatedAt"');
		expect(spec?.queryText).not.toContain('"generationEndedAt"');
	});

	test("does not invent a query for an unknown KPI", () => {
		expect(catalogQuestionSpec(candidate("Unknown metric"))).toBeNull();
	});
});
