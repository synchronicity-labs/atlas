import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import type { HubspotSalesResult } from "@crm/db/hubspot-sales";
import { pilotSummaryVerificationChecks } from "./pilot-verification";

function result(
	rows: Array<Array<string | number | null>>,
): HubspotSalesResult {
	return {
		columns: [
			"week_start",
			"active_pilots",
			"new_pilots",
			"exited_pilots",
			"pilot_accounts",
			"owners",
			"data_through",
		].map((name) => ({ name, displayName: name, baseType: "type/Text" })),
		rows,
	};
}

describe("pilot summary verification", () => {
	test("passes a reconciled governed pilot summary", () => {
		const checks = pilotSummaryVerificationChecks(
			result([
				[
					"2026-08-24T00:00:00.000Z",
					2,
					1,
					0,
					"Alpha; Beta",
					"Ada; Grace",
					"2026-08-25T11:45:00.000Z",
				],
			]),
			{
				report: "active-pilot-summary",
				months: 1,
				pipelines: ["989457121", "1984250589"],
			},
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(4).fill(VerificationStatus.PASSED),
		);
	});

	test("rejects changed pipelines and unreconciled account rows", () => {
		const checks = pilotSummaryVerificationChecks(
			result([
				[
					"2026-08-24T00:00:00.000Z",
					2,
					1,
					0,
					"Alpha",
					"Ada",
					"2026-08-25T11:45:00.000Z",
				],
			]),
			{
				report: "active-pilot-summary",
				months: 1,
				pipelines: ["989457121"],
			},
		);

		expect(
			checks.find((check) => check.name === "deal_stage_mapping")?.status,
		).toBe(VerificationStatus.FAILED);
		expect(
			checks.find((check) => check.name === "active_registry_parity")?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("registers the weekly pilot question on the governed HubSpot path", async () => {
		const migration = await Bun.file(
			new URL(
				"../../../../packages/db/prisma/migrations/20260826002000_weekly_active_pilot_metric/migration.sql",
				import.meta.url,
			),
		).text();

		expect(migration).toContain('"report":"active-pilot-summary"');
		expect(migration).toContain('"989457121","1984250589"');
		expect(migration).toContain("atlas-sales-card-weekly-active-pilots");
	});
});
