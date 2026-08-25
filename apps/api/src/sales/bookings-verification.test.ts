import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import type { HubspotSalesResult } from "@crm/db/hubspot-sales";
import {
	enterpriseBookingsVerificationChecks,
	studioBookingsVerificationChecks,
} from "./bookings-verification";

function result(
	columns: string[],
	rows: HubspotSalesResult["rows"],
): HubspotSalesResult {
	return {
		columns: columns.map((name) => ({
			name,
			displayName: name,
			baseType: "type/Text",
		})),
		rows,
	};
}

describe("bookings verification", () => {
	test("passes Studio CRM bookings with explicit unavailable boundaries", () => {
		const checks = studioBookingsVerificationChecks(
			result(
				[
					"period_start",
					"account",
					"stage",
					"closed_won_value",
					"in_delivery_value",
					"owner",
					"contract_status",
					"delivery_status",
					"data_through",
				],
				[
					[
						"2026-08-01",
						"Acme",
						"Closed won",
						1000,
						null,
						"Ada",
						"unavailable",
						"unavailable",
						"2026-08-25T12:00:00Z",
					],
				],
			),
			{ report: "studio-bookings", months: 6, pipelines: ["1984250589"] },
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(4).fill(VerificationStatus.PASSED),
		);
	});

	test("rejects invented Studio delivery value", () => {
		const checks = studioBookingsVerificationChecks(
			result(
				[
					"period_start",
					"account",
					"stage",
					"closed_won_value",
					"in_delivery_value",
					"owner",
					"contract_status",
					"delivery_status",
					"data_through",
				],
				[
					[
						"2026-08-01",
						"Acme",
						"Closed won",
						1000,
						500,
						"Ada",
						"signed",
						"delivering",
						"2026-08-25T12:00:00Z",
					],
				],
			),
			{ report: "studio-bookings", months: 6, pipelines: ["1984250589"] },
		);

		expect(
			checks.find((check) => check.name === "operational_boundary")?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("passes enterprise CRM amounts without contract classifications", () => {
		const checks = enterpriseBookingsVerificationChecks(
			result(
				[
					"period_start",
					"stage",
					"pipeline_created",
					"booked_value",
					"signed_contracts",
					"net_new_logos",
					"renewals",
					"unmapped_deals",
					"data_through",
				],
				[
					[
						"2026-08-01",
						"all enterprise stages",
						1500,
						1000,
						null,
						null,
						null,
						1,
						"2026-08-25T12:00:00Z",
					],
				],
			),
			{ report: "enterprise-bookings", months: 6, pipelines: ["989457121"] },
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(4).fill(VerificationStatus.PASSED),
		);
	});

	test("registers Q247 and Q248 on exact HubSpot pipelines", async () => {
		const migration = await Bun.file(
			new URL(
				"../../../../packages/db/prisma/migrations/20260826004000_bookings_report_metrics/migration.sql",
				import.meta.url,
			),
		).text();

		expect(migration).toContain('"report":"studio-bookings"');
		expect(migration).toContain('"report":"enterprise-bookings"');
		expect(migration).toContain('"pipelines":["1984250589"]');
		expect(migration).toContain('"pipelines":["989457121"]');
	});
});
