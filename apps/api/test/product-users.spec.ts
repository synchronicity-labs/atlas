import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { ProductUsersService } from "../src/product-users/product-users.service";

const suffix = process.env.TEST_RUN_ID ?? "product-users-spec";
const sourceKey = `test:product-users:${suffix}`;
const sharedEmail = `shared.${suffix}@example.test`;
const service = new ProductUsersService(
	db,
	{
		productUserViewed: async () => undefined,
	} as never,
	{
		syncUsersMatchingEmail: async () => ({ processed: 0, snapshots: 0 }),
	} as never,
);

let firstUserId: string;

const input = (q: string) => ({
	q,
	sort: "id",
	dir: "asc" as const,
	page: 1,
	pageSize: 25,
});

beforeAll(async () => {
	await db.dataSource.deleteMany({ where: { key: sourceKey } });

	const source = await db.dataSource.create({
		data: {
			key: sourceKey,
			kind: "METABASE",
			label: "Product users regression source",
			state: "HEALTHY",
		},
	});
	const primaryOrganization = await db.productOrganization.create({
		data: {
			sourceId: source.id,
			externalId: `org-primary-${suffix}`,
			name: `Shared Workspace ${suffix}`,
			domain: `workspace-${suffix}.example.test`,
			plan: "creator",
			stripeCustomerId: `cus_shared_${suffix}`,
			traits: {},
			syncedAt: new Date(),
		},
	});
	const secondaryOrganization = await db.productOrganization.create({
		data: {
			sourceId: source.id,
			externalId: `org-secondary-${suffix}`,
			name: `Second Workspace ${suffix}`,
			plan: "hobbyist",
			traits: {},
			syncedAt: new Date(),
		},
	});

	const first = await db.productUser.create({
		data: {
			sourceId: source.id,
			externalId: `user-first-${suffix}`,
			email: sharedEmail,
			displayName: "First Shared Identity",
			traits: {},
			syncedAt: new Date(),
			identities: {
				create: {
					kind: "legacy_user_id",
					value: `legacy-${suffix}`,
					normalizedValue: `legacy-${suffix}`,
					source: "metabase",
				},
			},
			memberships: {
				create: [
					{
						productOrganizationId: primaryOrganization.id,
						role: "owner",
						syncedAt: new Date(),
					},
					{
						productOrganizationId: secondaryOrganization.id,
						role: "member",
						syncedAt: new Date(),
					},
				],
			},
		},
	});
	firstUserId = first.id;

	await db.productUser.create({
		data: {
			sourceId: source.id,
			externalId: `user-second-${suffix}`,
			email: sharedEmail,
			displayName: "Second Shared Identity",
			traits: {},
			syncedAt: new Date(),
			memberships: {
				create: {
					productOrganizationId: primaryOrganization.id,
					role: "member",
					syncedAt: new Date(),
				},
			},
		},
	});
});

afterAll(async () => {
	await db.dataSource.deleteMany({ where: { key: sourceKey } });
});

describe("ProductUsersService", () => {
	it("keeps two source users with the same email as separate people", async () => {
		const result = await service.list(input(sharedEmail));

		expect(result.total).toBe(2);
		expect(result.rows.map((row) => row.externalId)).toEqual([
			`user-first-${suffix}`,
			`user-second-${suffix}`,
		]);
	});

	it("searches stable ids, linked identities, organizations, and billing ids", async () => {
		for (const term of [
			`user-first-${suffix}`,
			`legacy-${suffix}`,
			`Second Workspace ${suffix}`,
			`cus_shared_${suffix}`,
		]) {
			const result = await service.list(input(term));
			expect(result.total).toBeGreaterThan(0);
		}
	});

	it("returns every organization membership on the user timeline", async () => {
		const user = await service.byId(firstUserId);

		expect(user.memberships).toHaveLength(2);
		expect(
			user.memberships.map(({ organization }) => organization.externalId),
		).toEqual([`org-secondary-${suffix}`, `org-primary-${suffix}`]);
		expect(user.emailDomain).toBe("example.test");
		expect(user.workDomain).toBe("example.test");
	});

	it("groups work-domain peers without merging their identities", async () => {
		const result = await service.domain({
			...input(""),
			domain: "example.test",
		});

		expect(result.total).toBe(2);
		expect(result.stats.people).toBe(2);
		expect(result.stats.organizations).toBe(2);
		expect(result.stats.paidOrganizations).toBe(1);
		expect(result.rows.map((row) => row.externalId)).toEqual([
			`user-first-${suffix}`,
			`user-second-${suffix}`,
		]);
	});

	it("refuses to turn a public mailbox provider into a company cohort", async () => {
		expect(
			service.domain({ ...input(""), domain: "gmail.com" }),
		).rejects.toThrow("does not treat that email provider as a company domain");
	});
});
