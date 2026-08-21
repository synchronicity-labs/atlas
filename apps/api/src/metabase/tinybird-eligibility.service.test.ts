import { describe, expect, it } from "bun:test";
import {
	buildTinybirdEligibility,
	type EligibilityRow,
	governTinybirdQuery,
} from "./tinybird-eligibility.service";

const row = (input: Partial<EligibilityRow>): EligibilityRow => ({
	userId: "user-1",
	email: "person@example.com",
	banned: false,
	disabled: false,
	isAnonymous: false,
	membershipRole: "owner",
	organizationId: "org-1",
	customerId: "customer-1",
	hasSubscribed: false,
	...input,
});

describe("revenue TinyBird eligibility", () => {
	it("keeps paying banned customers in money metrics", () => {
		const snapshot = buildTinybirdEligibility(
			[
				row({ banned: true, hasSubscribed: true }),
				row({
					userId: "user-internal",
					email: "operator@sync.so",
					organizationId: "org-internal",
					customerId: "customer-internal",
				}),
				row({
					userId: "user-disabled",
					disabled: true,
					organizationId: "org-disabled",
					customerId: "customer-disabled",
				}),
			],
			new Date("2026-08-19T00:00:00.000Z"),
			3,
			"SUBSCRIBED_ORGANIZATIONS",
		);

		expect(snapshot.complete).toBe(true);
		expect(snapshot.scope).toBe("SUBSCRIBED_ORGANIZATIONS");
		expect(snapshot.policy).toBe("MONEY");
		expect(snapshot.excludedUserIds).toEqual(["user-internal"]);
		expect(snapshot.excludedOrganizationIds).toEqual(["org-internal"]);
		expect(snapshot.excludedCustomerIds).toEqual(["customer-internal"]);
	});

	it("applies the scoped exclusions only when the snapshot is complete", () => {
		const snapshot = buildTinybirdEligibility(
			[row({ email: "operator@sync.so" })],
			new Date("2026-08-19T00:00:00.000Z"),
			1,
			"SUBSCRIBED_ORGANIZATIONS",
		);
		const governed = governTinybirdQuery(
			"select * from sync_prod.sync_usage3",
			"166",
			snapshot,
		);

		expect(governed.applied).toBe(true);
		expect(governed.eligibility.scope).toBe("SUBSCRIBED_ORGANIZATIONS");
		expect(governed.eligibility.policy).toBe("MONEY");
		expect(governed.queryText).toContain(`"userId" not in ('user-1')`);
		expect(governed.queryText).toContain(`"organizationId" not in ('org-1')`);
	});

	it("keeps free-user questions pending until the banned-user join exists", () => {
		const snapshot = buildTinybirdEligibility(
			[row({ email: "operator@sync.so" })],
			new Date("2026-08-19T00:00:00.000Z"),
			1,
			"ALL_IDENTITIES",
		);
		const governed = governTinybirdQuery(
			"select count(*) from sync_prod.sync_usage3",
			"166",
			snapshot,
		);

		expect(governed.applied).toBe(true);
		expect(governed.eligibility.complete).toBe(false);
		expect(governed.eligibility.limitation).toBe(
			"BANNED_NEVER_SUBSCRIBED_JOIN_REQUIRED",
		);
	});

	it("approves paid-plan activity without excluding paying banned customers", () => {
		const snapshot = buildTinybirdEligibility(
			[row({ email: "operator@sync.so" })],
			new Date("2026-08-19T00:00:00.000Z"),
			1,
			"ALL_IDENTITIES",
		);
		const governed = governTinybirdQuery(
			`select count(*) from sync_prod.sync_usage3
where "organizationPlanType" in ('hobbyist', 'creator', 'growth', 'scale')`,
			"166",
			snapshot,
		);

		expect(governed.applied).toBe(true);
		expect(governed.eligibility.complete).toBe(true);
		expect(governed.eligibility.limitation).toBeUndefined();
	});
});

describe("product activity eligibility", () => {
	it("excludes banned people only when they never subscribed", () => {
		const snapshot = buildTinybirdEligibility(
			[
				row({ userId: "never-paid", banned: true }),
				row({
					userId: "paid-before-ban",
					organizationId: "paid-org",
					customerId: "paid-customer",
					banned: true,
					hasSubscribed: true,
				}),
				row({
					userId: "internal",
					email: "person@sync.so",
					organizationId: "internal-org",
					customerId: "internal-customer",
				}),
			],
			new Date("2026-08-19T00:00:00.000Z"),
			3,
			"ALL_IDENTITIES",
		);

		expect(snapshot.policy).toBe("PRODUCT_ACTIVITY");
		expect(snapshot.excludedUserIds).toEqual(["internal", "never-paid"]);
		expect(snapshot.excludedOrganizationIds).toEqual(["internal-org", "org-1"]);
		expect(snapshot.excludedUserIds).not.toContain("paid-before-ban");
	});
});
