import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import type { ActivePilotRegistry } from "@crm/db/hubspot-sales";
import {
	buildPilotAdoptionQuery,
	emptyPilotAdoptionResult,
	excludePaidPilotRegistryEntries,
	parseProductPilotRegistry,
	productPilotRegistryQuery,
} from "./pilot-adoption";
import { pilotAdoptionVerificationChecks } from "./pilot-adoption-verification";

const dataThrough = new Date("2026-08-26T00:00:00.000Z");
const registry: ActivePilotRegistry = {
	dataThrough,
	entries: [
		{
			account: "Alpha's Studio",
			domain: null,
			organizationId: "org-alpha",
			owner: "Ada",
			pilotStartedAt: new Date("2026-08-20T00:00:00.000Z"),
		},
		{
			account: "Unmatched Pilot",
			domain: null,
			organizationId: "org-unmatched",
			owner: "Grace",
			pilotStartedAt: null,
		},
	],
};

describe("active pilot adoption", () => {
	test("reads active pilots from explicit Product DB markers", () => {
		const query = productPilotRegistryQuery().toLowerCase();

		expect(query).toContain("public.organization_features");
		expect(query).toContain("f.pilot_type");
		expect(query).toContain("o.plan");
		expect(query).toContain("f.enterprise_pilot_accepted_at");
		expect(query).toContain("f.enterprise_pilot_expires_at");
		expect(query).toContain("<= now()");
		expect(query).toContain("> now()");
		expect(query).not.toContain("hubspot");
	});

	test("parses complete Product pilot rows without inferring from names", () => {
		const registry = parseProductPilotRegistry({
			columns: [
				{ name: "organization_id", displayName: null, baseType: null },
				{ name: "customer_id", displayName: null, baseType: null },
				{ name: "account", displayName: null, baseType: null },
				{ name: "pilot_started_at", displayName: null, baseType: null },
				{ name: "pilot_ended_at", displayName: null, baseType: null },
				{ name: "data_through", displayName: null, baseType: null },
				{ name: "source_row_count", displayName: null, baseType: null },
			],
			rows: [
				[
					"org-1",
					"cus-1",
					"Enterprise Pilot",
					null,
					null,
					"2026-08-26T00:00:00.000Z",
					1,
				],
			],
		});

		expect(registry.entries).toEqual([
			{
				account: "Enterprise Pilot",
				domain: null,
				organizationId: "org-1",
				customerId: "cus-1",
				owner: "",
				pilotStartedAt: null,
				pilotEndedAt: null,
			},
		]);
		expect(registry.dataThrough).toEqual(new Date("2026-08-26T00:00:00.000Z"));
	});

	test("gives verified paid identities precedence over pilot markers", async () => {
		const db = {
			contractCustomerProductOrganization: {
				findMany: async () => [
					{
						productOrganization: {
							externalId: "org-paid-contract",
							stripeCustomerId: "cus-paid-contract",
						},
					},
				],
			},
			revenueDoorRule: {
				findMany: async ({ where }: { where: { matchKind: string } }) =>
					where.matchKind === "ORGANIZATION_ID"
						? [{ matchValue: "org-paid-door" }]
						: [{ matchValue: "cus-paid-door" }],
			},
		} as never;
		const filtered = await excludePaidPilotRegistryEntries(db, {
			dataThrough,
			entries: [
				{
					account: "Contract organization",
					domain: null,
					organizationId: "org-paid-contract",
					customerId: "cus-unrelated",
					owner: "",
					pilotStartedAt: null,
					pilotEndedAt: null,
				},
				{
					account: "Contract customer",
					domain: null,
					organizationId: "org-unrelated",
					customerId: "cus-paid-contract",
					owner: "",
					pilotStartedAt: null,
				},
				{
					account: "Door organization",
					domain: null,
					organizationId: "org-paid-door",
					customerId: "cus-unrelated-2",
					owner: "",
					pilotStartedAt: null,
				},
				{
					account: "Door customer",
					domain: null,
					organizationId: "org-unrelated-2",
					customerId: "cus-paid-door",
					owner: "",
					pilotStartedAt: null,
				},
				{
					account: "Unpaid pilot",
					domain: null,
					organizationId: "org-unpaid",
					customerId: "cus-unpaid",
					owner: "",
					pilotStartedAt: null,
				},
			],
		});

		expect(filtered.entries.map((entry) => entry.account)).toEqual([
			"Unpaid pilot",
		]);
	});

	test("builds an organization-ID, read-only product query with governed exclusions", () => {
		const query = buildPilotAdoptionQuery(registry);

		expect(query).toContain("Alpha''s Studio");
		expect(query).toContain("uo.organization_id = r.organization_id::uuid");
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
				"organization_verified",
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
				source: "hubspot",
				report: "active-pilot-adoption",
				months: 1,
				pipelines: [],
			},
			queryText: `${productPilotRegistryQuery()}\n${buildPilotAdoptionQuery(registry)}`,
			registryCount: registry.entries.length,
			dataThrough,
		});

		expect(checks.map((check) => check.status)).toEqual(
			Array(6).fill(VerificationStatus.PASSED),
		);
	});

	test("registers Q7001 on the governed active-pilot adoption path", async () => {
		const migration = await Bun.file(
			new URL(
				"../../../../packages/db/prisma/migrations/20261007120000_product_pilot_registry_source/migration.sql",
				import.meta.url,
			),
		).text();

		expect(migration).toContain('"source":"hubspot"');
		expect(migration).toContain('"report":"active-pilot-adoption"');
		expect(migration).toContain("atlas-cron-question-active-pilot-adoption-v3");
	});
});
