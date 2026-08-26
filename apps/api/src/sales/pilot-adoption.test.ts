import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import type { ActivePilotRegistry } from "@crm/db/hubspot-sales";
import {
	buildPilotAdoptionQuery,
	emptyPilotAdoptionResult,
} from "./pilot-adoption";
import { pilotAdoptionVerificationChecks } from "./pilot-adoption-verification";

const dataThrough = new Date("2026-08-26T00:00:00.000Z");
const registry: ActivePilotRegistry = {
	dataThrough,
	entries: [
		{
			account: "Alpha's Studio",
			domain: "alpha.example",
			owner: "Ada",
			pilotStartedAt: new Date("2026-08-20T00:00:00.000Z"),
		},
		{
			account: "Unmatched Pilot",
			domain: null,
			owner: "Grace",
			pilotStartedAt: null,
		},
	],
};

describe("active pilot adoption", () => {
	test("builds an exact-domain, read-only product query with governed exclusions", () => {
		const query = buildPilotAdoptionQuery(registry);

		expect(query).toContain("Alpha''s Studio");
		expect(query).toContain(
			"split_part(lower(u.email::text), '@', 2) = r.domain",
		);
		expect(query).toContain("coalesce(u.banned, false) = false");
		expect(query).toContain("coalesce(u.disabled, false) = false");
		expect(query).toContain("coalesce(u.is_anonymous, false) = false");
		expect(query).toContain("'sync.so', 'sync.labs', 'synclabs.so'");
		expect(query.trimStart().startsWith("with registry")).toBe(true);
		expect(query).not.toMatch(/\b(?:insert|update|delete|drop|alter)\b/i);
	});

	test("verifies registry parity, explicit unmatched rows, count subsets, and privacy", () => {
		const result = emptyPilotAdoptionResult();
		result.rows = [
			[
				"Alpha's Studio",
				"active",
				"2026-08-20T00:00:00.000Z",
				null,
				"Ada",
				"domain_verified",
				1,
				3,
				1,
				0,
				2,
				20,
				18,
				2,
				1.5,
				"model-a:20",
				"api:20",
				"2026-08-26T00:30:00.000Z",
				dataThrough.toISOString(),
			],
			[
				"Unmatched Pilot",
				"active",
				null,
				null,
				"Grace",
				"not_verified",
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				"",
				"",
				null,
				dataThrough.toISOString(),
			],
		];
		const checks = pilotAdoptionVerificationChecks({
			result,
			query: {
				report: "active-pilot-adoption",
				months: 1,
				pipelines: ["989457121", "1984250589"],
			},
			queryText: buildPilotAdoptionQuery(registry),
			registryCount: registry.entries.length,
			dataThrough,
		});

		expect(checks.map((check) => check.status)).toEqual(
			Array(6).fill(VerificationStatus.PASSED),
		);
	});

	test("registers Q233 on the governed active-pilot adoption path", async () => {
		const migration = await Bun.file(
			new URL(
				"../../../../packages/db/prisma/migrations/20260826030000_active_pilot_adoption/migration.sql",
				import.meta.url,
			),
		).text();

		expect(migration).toContain('"report":"active-pilot-adoption"');
		expect(migration).toContain('"989457121","1984250589"');
		expect(migration).toContain("atlas-sales-card-active-pilot-adoption");
	});
});
