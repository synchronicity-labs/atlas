import { describe, expect, it } from "bun:test";
import {
	buildTinybirdEligibility,
	type EligibilityRow,
	governProductPostgresQuery,
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

	it("joins Product Postgres generations to the shared reporting population", () => {
		const governed = governProductPostgresQuery(
			"select count(*) from public.generations g",
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain("atlas_population_generation.user_id");
		expect(governed.queryText).toContain(
			"atlas_population_organization.first_subscribed_at",
		);
		expect(governed.queryText).toContain("atlas_population_user.banned");
	});

	it("keeps banned paying customers in Product Postgres money queries", () => {
		const governed = governProductPostgresQuery(
			"select count(*) from generations g",
			"MONEY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).not.toContain("first_subscribed_at");
		expect(governed.queryText).not.toContain("atlas_population_user.banned");
	});

	it("joins Product Postgres organizations to the same population", () => {
		const governed = governProductPostgresQuery(
			"select count(*) from public.organizations o",
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain("public.user_organizations");
		expect(governed.queryText).toContain("atlas_population_user.email");
	});

	it("normalizes older clean-user clauses to the shared rule", () => {
		const governed = governProductPostgresQuery(
			`with clean_users as (
  select id from auth.users
  where coalesce(banned,false)=false
    and coalesce(disabled,false)=false
)
select count(*) from public.generations g join clean_users u on u.id = g.user_id`,
			"PRODUCT_ACTIVITY",
		);

		expect(governed.queryText).toContain(
			"id in (select user_id from atlas_subscribed_users)",
		);
		expect(governed.queryText).toContain("and true");
	});

	it("preserves leading SQL comments before an existing CTE", () => {
		const governed = governProductPostgresQuery(
			`-- source definition
-- second line
with recent as (select * from public.generations)
select count(*) from recent`,
			"PRODUCT_ACTIVITY",
		);

		expect(governed.queryText).toContain(
			"-- second line\nwith atlas_subscribed_users as",
		);
		expect(governed.queryText).not.toContain("\nwith recent as");
	});

	it("upgrades an existing clean-user join without wrapping the fact table", () => {
		const governed = governProductPostgresQuery(
			`with clean_users as (
  select id from auth.users
  where coalesce(banned, false) = false
    and coalesce(disabled, false) = false
    and coalesce(is_anonymous, false) = false
    and lower(coalesce(email, '')) not like '%@sync.so'
    and lower(coalesce(email, '')) not like '%@sync.labs'
), gens as (
  select g.id from public.generations g join clean_users u on u.id = g.user_id
)
select * from gens`,
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain("atlas_subscribed_users as");
		expect(governed.queryText).toContain("from public.generations g");
		expect(governed.queryText).not.toContain("atlas_population_generations");
		expect(governed.queryText).toContain(
			"coalesce(banned, false) = false or id in (select user_id from atlas_subscribed_users)",
		);
		expect(governed.queryText).toContain("and true");
	});

	it("does not change abuse questions that read users directly", () => {
		const queryText = "select count(*) from auth.users where banned is true";
		const governed = governProductPostgresQuery(queryText, "PRODUCT_ACTIVITY");

		expect(governed.applied).toBe(false);
		expect(governed.queryText).toBe(queryText);
	});
});
