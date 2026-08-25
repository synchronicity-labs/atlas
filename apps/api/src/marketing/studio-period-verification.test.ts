import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import { studioPeriodVerificationChecks } from "./studio-period-verification";

const columns = [
	"period_start",
	"generated_hours",
	"new_subscriptions",
	"new_logos",
	"expanded_logos",
	"churned_logos",
	"net_logo_growth",
	"data_through",
];

function result(rows: unknown[][]): MetabaseResult {
	return {
		columns: columns.map((name) => ({
			name,
			displayName: name,
			baseType: null,
		})),
		rows,
	};
}

const query = `select
  countIf(event = 'playground_completed_generation') as generated,
  uniqExactIf(uuid, event = 'subscription_created') as new_subscriptions,
  uniqExactIf(toString(properties.organization_id), event = 'subscription_created') as new_logos
from events
where toTimeZone(timestamp, 'UTC') < toDateTime(0, 'UTC')
  and toString(properties.old_plan) != ''
  and toString(properties.source) != 'plugin_premiere'`;

describe("Studio period verification", () => {
	test("passes reconciled complete Studio periods", () => {
		const checks = studioPeriodVerificationChecks(
			result([["2026-08-11", 237.1, 896, 855, 24, 715, 164, "2026-08-25"]]),
			query,
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(6).fill(VerificationStatus.PASSED),
		);
	});

	test("fails an unreconciled logo total", () => {
		const checks = studioPeriodVerificationChecks(
			result([["2026-08-11", 237.1, 896, 855, 24, 715, 165, "2026-08-25"]]),
			query,
		);

		expect(
			checks.find((check) => check.name === "logo_movement_reconciliation")
				?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("rejects the obsolete oldPlan property", () => {
		const checks = studioPeriodVerificationChecks(
			result([["2026-08-11", 237.1, 896, 855, 24, 715, 164, "2026-08-25"]]),
			query.replace("properties.old_plan", "properties.oldPlan"),
		);

		expect(
			checks.find((check) => check.name === "organization_deduplication")
				?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("keeps both Studio queries bounded, single-scan, and UTC-safe", async () => {
		const migration = await Bun.file(
			new URL(
				"../../../../packages/db/prisma/migrations/20260825231500_studio_delivery_logo_periods/migration.sql",
				import.meta.url,
			),
		).text();

		expect(migration.match(/from events\b/g)).toHaveLength(2);
		expect(migration.match(/limit 100/g)).toHaveLength(2);
		expect(migration).toContain("properties.old_plan");
		expect(migration).not.toContain("properties.oldPlan");
		expect(migration).toContain("properties.organization_id");
		expect(migration).toContain("!= 'plugin_premiere'");
		expect(migration.match(/toDateTime\(/g)?.length).toBeGreaterThanOrEqual(6);
	});
});
