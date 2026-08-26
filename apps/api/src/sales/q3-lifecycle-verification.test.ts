import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import type { HubspotSalesResult } from "@crm/db/hubspot-sales";
import { q3LifecycleVerificationChecks } from "./q3-lifecycle-verification";

const columns = [
	"week_start",
	"period_end",
	"enterprise_inbound",
	"mql",
	"pql",
	"sql",
	"crm_paid_closed_won",
	"paid_sow_documents",
	"paid_order_form_documents",
	"signed_paid_sows",
	"net_new_logos",
	"renewals",
	"unmapped_deals",
	"data_through",
];

function result(row: HubspotSalesResult["rows"][number]): HubspotSalesResult {
	return {
		columns: columns.map((name) => ({
			name,
			displayName: name,
			baseType: "type/Text",
		})),
		rows: [row],
	};
}

describe("Q3 lifecycle verification", () => {
	test("passes complete aggregate rows with explicit signature boundaries", () => {
		const checks = q3LifecycleVerificationChecks(
			result([
				"2026-08-24T00:00:00Z",
				"2026-08-26T00:00:00Z",
				2,
				1,
				1,
				1,
				3,
				1,
				1,
				null,
				1,
				1,
				1,
				"2026-08-26T00:00:00Z",
			]),
			{
				report: "q3-lifecycle-funnel",
				months: 3,
				pipelines: ["989457121"],
			},
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(7).fill(VerificationStatus.PASSED),
		);
	});

	test("rejects a signed-SOW claim and an unreconciled deal split", () => {
		const checks = q3LifecycleVerificationChecks(
			result([
				"2026-08-24T00:00:00Z",
				"2026-08-26T00:00:00Z",
				2,
				1,
				1,
				1,
				3,
				1,
				1,
				1,
				1,
				1,
				0,
				"2026-08-26T00:00:00Z",
			]),
			{
				report: "q3-lifecycle-funnel",
				months: 3,
				pipelines: ["989457121"],
			},
		);

		expect(
			checks.find((check) => check.name === "signed_contract_boundary")?.status,
		).toBe(VerificationStatus.FAILED);
		expect(
			checks.find((check) => check.name === "logo_classification")?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("registers the exact HubSpot and contract-evidence route", async () => {
		const migration = await Bun.file(
			new URL(
				"../../../../packages/db/prisma/migrations/20260826090000_q3_lifecycle_funnel/migration.sql",
				import.meta.url,
			),
		).text();
		const sync = await Bun.file(
			new URL("../../../agent/agent/lib/hubspot-sync.ts", import.meta.url),
		).text();

		expect(migration).toContain('"report":"q3-lifecycle-funnel"');
		expect(migration).toContain('"pipelines":["989457121"]');
		expect(migration).toContain("atlas:q3-gtm-composite");
		expect(sync).toContain("hs_v2_date_entered_marketingqualifiedlead");
		expect(sync).toContain("hs_v2_date_entered_1512748791");
		expect(sync).toContain("hs_v2_date_entered_salesqualifiedlead");
		expect(migration).toContain('CREATE TABLE "q3InboundSnapshot"');
	});
});
