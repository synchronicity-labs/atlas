import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "../metabase/metabase.client";
import { geoConversionVerificationChecks } from "./geo-conversion-verification";

const columns = [
	"cohort_week",
	"provider",
	"signups",
	"first_successful_generations",
	"paid_subscriptions",
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
where toTimeZone(timestamp, 'UTC') >= toDateTime(
  toUnixTimestamp(toMonday(toTimeZone(now(), 'UTC'))),
  'UTC'
) - interval 4 week
and ref_domain like '%chatgpt.com%'
and ref_domain like '%gemini.google.com%'
and ref_domain like '%claude.ai%'
and ref_domain like '%perplexity.ai%'
and ref_domain like '%copilot.microsoft.com%'
and ref_domain like '%meta.ai%'
and ref_domain like '%kagi.com%'
and ref_domain like '%chat.qwen.ai%'`;

describe("GEO conversion verification", () => {
	test("passes two reconciled mature signup cohorts", () => {
		const checks = geoConversionVerificationChecks(
			result([
				["2026-08-03", "ChatGPT", 100, 70, 15, 70, 15, "2026-08-17"],
				["2026-08-10", "Gemini", 20, 10, 2, 50, 10, "2026-08-17"],
			]),
			query,
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(6).fill(VerificationStatus.PASSED),
		);
	});

	test("fails invalid providers, stage counts, and rates", () => {
		const checks = geoConversionVerificationChecks(
			result([
				["2026-08-03", "Other", 10, 11, 2, 90, 20, "2026-08-17"],
				["2026-08-10", "ChatGPT", 10, 5, 2, 50, 30, "2026-08-17"],
			]),
			query,
		);

		expect(
			checks.find((check) => check.name === "ai_referrer_registry")?.status,
		).toBe(VerificationStatus.FAILED);
		expect(
			checks.find((check) => check.name === "cohort_reconciliation")?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("keeps the governed query bounded and UTC-safe", async () => {
		const migration = await Bun.file(
			new URL(
				"../../../../packages/db/prisma/migrations/20260826010000_geo_paid_conversion/migration.sql",
				import.meta.url,
			),
		).text();

		expect(migration.match(/from events\b/g)).toHaveLength(1);
		expect(migration).toContain("person.properties.$initial_referring_domain");
		expect(migration).toContain("interval 7 day");
		expect(migration).toContain("toMonday(toTimeZone(now(), 'UTC'))");
		expect(migration).toContain("limit 100");
	});
});
