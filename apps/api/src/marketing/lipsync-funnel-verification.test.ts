import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import { lipsyncFunnelVerificationChecks } from "./lipsync-funnel-verification";

const columns = [
	"cohort_week",
	"signups",
	"projects_started",
	"successful_generations",
	"paid_subscriptions",
	"signup_to_project_pct",
	"signup_to_generation_pct",
	"signup_to_paid_pct",
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

const query = `select person.properties.$initial_referring_domain
from events
where person.properties.$initial_referring_domain in ('lipsync.com', 'www.lipsync.com')`;

describe("lipsync funnel verification", () => {
	test("passes a reconciled mature signup cohort", () => {
		const checks = lipsyncFunnelVerificationChecks(
			result([["2026-08-03", 20, 12, 8, 2, 60, 40, 10, "2026-08-10"]]),
			query,
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(6).fill(VerificationStatus.PASSED),
		);
	});

	test("fails when stages or rates do not reconcile", () => {
		const checks = lipsyncFunnelVerificationChecks(
			result([["2026-08-03", 20, 12, 13, 2, 50, 65, 10, "2026-08-10"]]),
			query,
		);

		expect(
			checks.find((check) => check.name === "funnel_ordering")?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("rejects event-level referral attribution", () => {
		const checks = lipsyncFunnelVerificationChecks(
			result([["2026-08-03", 20, 12, 8, 2, 60, 40, 10, "2026-08-10"]]),
			`${query} and properties.$referring_domain = 'lipsync.com'`,
		);

		expect(
			checks.find((check) => check.name === "referral_definition")?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("keeps the governed query bounded, single-scan, and UTC-safe", async () => {
		const migration = await Bun.file(
			new URL(
				"../../../../packages/db/prisma/migrations/20260825223000_lipsync_attributed_product_funnel/migration.sql",
				import.meta.url,
			),
		).text();

		expect(migration.match(/from events\b/g)).toHaveLength(1);
		expect(migration).toContain(
			"person.properties.$initial_referring_domain in ('lipsync.com', 'www.lipsync.com')",
		);
		expect(migration).toContain(
			"toDateTime(\n      toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),\n      'UTC'\n    )",
		);
		expect(migration).toContain("limit 100");
	});
});
