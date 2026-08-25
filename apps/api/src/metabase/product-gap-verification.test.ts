import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "./metabase.client";
import { productGapVerificationChecks } from "./product-gap-verification";

function result(columns: string[], rows: unknown[][]): MetabaseResult {
	return {
		columns: columns.map((name) => ({
			name,
			displayName: name,
			baseType: null,
		})),
		rows,
	};
}

const query = `with toStartOfMonth(now()) as cutoff
select * from sync_prod.sync_usage3
where generationCreatedAt >= addMonths(cutoff, -2)
and generationCreatedAt < cutoff
and organizationPlanType in ('hobbyist', 'creator', 'growth', 'scale')
and generations >= 3 and active_days >= 2
and accrued_value_usd >= 100`;

const columns = [
	"section",
	"month",
	"dimension_value",
	"organization_count",
	"activated_organizations",
	"professional_organizations",
	"gap_organizations",
	"generation_count",
	"output_hours",
	"data_through",
];

describe("product gap verification", () => {
	test("verifies two complete reconciled months", () => {
		const checks = productGapVerificationChecks(
			result(columns, [
				["summary", "2026-06-01", "all", 80, 100, 20, 80, 0, 0, "2026-08-01"],
				["plan", "2026-06-01", "creator", 50, 0, 0, 0, 0, 0, "2026-08-01"],
				["plan", "2026-06-01", "growth", 30, 0, 0, 0, 0, 0, "2026-08-01"],
				[
					"generation_bucket",
					"2026-06-01",
					"3-4",
					80,
					0,
					0,
					0,
					300,
					0,
					"2026-08-01",
				],
				[
					"output_hour_bucket",
					"2026-06-01",
					"<0.25h",
					80,
					0,
					0,
					0,
					0,
					5,
					"2026-08-01",
				],
				["summary", "2026-07-01", "all", 90, 120, 30, 90, 0, 0, "2026-08-01"],
				["plan", "2026-07-01", "creator", 90, 0, 0, 0, 0, 0, "2026-08-01"],
				[
					"generation_bucket",
					"2026-07-01",
					"3-4",
					90,
					0,
					0,
					0,
					350,
					0,
					"2026-08-01",
				],
				[
					"output_hour_bucket",
					"2026-07-01",
					"<0.25h",
					90,
					0,
					0,
					0,
					0,
					6,
					"2026-08-01",
				],
			]),
			query,
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(5).fill(VerificationStatus.PASSED),
		);
	});

	test("rejects a non-reconciling gap breakdown", () => {
		const checks = productGapVerificationChecks(
			result(columns, [
				["summary", "2026-06-01", "all", 80, 100, 20, 80, 0, 0, "2026-08-01"],
				["plan", "2026-06-01", "creator", 79, 0, 0, 0, 0, 0, "2026-08-01"],
				[
					"generation_bucket",
					"2026-06-01",
					"3-4",
					80,
					0,
					0,
					0,
					300,
					0,
					"2026-08-01",
				],
				[
					"output_hour_bucket",
					"2026-06-01",
					"<0.25h",
					80,
					0,
					0,
					0,
					0,
					5,
					"2026-08-01",
				],
				["summary", "2026-07-01", "all", 90, 120, 30, 90, 0, 0, "2026-08-01"],
				["plan", "2026-07-01", "creator", 90, 0, 0, 0, 0, 0, "2026-08-01"],
				[
					"generation_bucket",
					"2026-07-01",
					"3-4",
					90,
					0,
					0,
					0,
					350,
					0,
					"2026-08-01",
				],
				[
					"output_hour_bucket",
					"2026-07-01",
					"<0.25h",
					90,
					0,
					0,
					0,
					0,
					6,
					"2026-08-01",
				],
			]),
			query,
		);

		expect(
			checks.find((check) => check.name === "breakdown_reconciliation")?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("rejects customer identifiers in the governed result", () => {
		const checks = productGapVerificationChecks(
			result(
				[...columns, "organization_id"],
				[
					[
						"summary",
						"2026-06-01",
						"all",
						80,
						100,
						20,
						80,
						0,
						0,
						"2026-08-01",
						"org_123",
					],
				],
			),
			query,
		);

		expect(
			checks.find((check) => check.name === "canonical_population")?.status,
		).toBe(VerificationStatus.FAILED);
	});
});
