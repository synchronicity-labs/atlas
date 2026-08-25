import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import {
	abuseEnforcementVerificationChecks,
	abuseRingVerificationChecks,
} from "./abuse-detail-verification";
import type { MetabaseResult } from "./metabase.client";

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

describe("abuse detail verification", () => {
	test("verifies reconciled 24-hour PostHog ring detail", () => {
		const checks = abuseRingVerificationChecks(
			result(
				[
					"section",
					"dimension_value",
					"blocked_attempts",
					"related_count",
					"related_dimension",
					"headline_total",
					"data_through",
				],
				[
					[
						"summary",
						"all blocked attempts",
						10,
						4,
						"domains",
						10,
						"2026-08-25T12:00:00Z",
					],
					[
						"reason",
						"blocked_domain",
						6,
						3,
						"domains",
						10,
						"2026-08-25T12:00:00Z",
					],
					[
						"reason",
						"ip_velocity",
						4,
						2,
						"domains",
						10,
						"2026-08-25T12:00:00Z",
					],
					[
						"domain_ring",
						"burner.test",
						6,
						3,
						"ips",
						10,
						"2026-08-25T12:00:00Z",
					],
				],
			),
			"where timestamp >= now() - interval 1 day and timestamp < now()",
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(4).fill(VerificationStatus.PASSED),
		);
	});

	test("rejects a common mailbox provider as a domain ring", () => {
		const checks = abuseRingVerificationChecks(
			result(
				[
					"section",
					"dimension_value",
					"blocked_attempts",
					"related_count",
					"related_dimension",
					"headline_total",
					"data_through",
				],
				[
					[
						"summary",
						"all blocked attempts",
						5,
						1,
						"domains",
						5,
						"2026-08-25T12:00:00Z",
					],
					[
						"reason",
						"domain_velocity",
						5,
						1,
						"domains",
						5,
						"2026-08-25T12:00:00Z",
					],
					["domain_ring", "gmail.com", 5, 1, "ips", 5, "2026-08-25T12:00:00Z"],
				],
			),
			"where timestamp >= now() - interval 1 day and timestamp < now()",
		);

		expect(
			checks.find((check) => check.name === "ring_definition_review")?.status,
		).toBe(VerificationStatus.FAILED);
	});

	test("verifies product enforcement and fresh-ring detail", () => {
		const checks = abuseEnforcementVerificationChecks(
			result(
				[
					"section",
					"dimension_value",
					"reason",
					"source",
					"metrics",
					"data_through",
				],
				[
					[
						"summary",
						"all",
						null,
						null,
						{
							banned_users_24h: 3,
							new_domain_blocks: 2,
							new_ip_blocks: 1,
							fresh_ring_candidates: 1,
							fresh_ring_candidate_accounts: 25,
						},
						"2026-08-25T12:00:00Z",
					],
					[
						"new_block",
						"domain",
						"velocity",
						null,
						{ count: 2 },
						"2026-08-25T12:00:00Z",
					],
					[
						"new_block",
						"ip",
						"velocity",
						null,
						{ count: 1 },
						"2026-08-25T12:00:00Z",
					],
					[
						"banned_reason_24h",
						"abuse",
						"abuse",
						null,
						{ users: 3 },
						"2026-08-25T12:00:00Z",
					],
					[
						"fresh_ring_candidate",
						"192.0.2.1",
						null,
						null,
						{
							signup_count: 25,
							distinct_domains: 12,
							banned_count: 2,
							fast_api_key_users: 10,
							api_generation_users: 0,
						},
						"2026-08-25T12:00:00Z",
					],
				],
			),
			"select date_trunc('minute', now()), interval '1 day', interval '7 days'",
		);

		expect(checks.map((check) => check.status)).toEqual(
			Array(4).fill(VerificationStatus.PASSED),
		);
	});

	test("rejects customer identifiers in the enforcement output", () => {
		const checks = abuseEnforcementVerificationChecks(
			result(
				["section", "dimension_value", "email", "metrics", "data_through"],
				[
					[
						"summary",
						"all",
						"customer@example.com",
						{},
						"2026-08-25T12:00:00Z",
					],
				],
			),
			"select date_trunc('minute', now()), interval '1 day', interval '7 days'",
		);

		expect(
			checks.find((check) => check.name === "sensitive_detail_boundary")
				?.status,
		).toBe(VerificationStatus.FAILED);
	});
});
