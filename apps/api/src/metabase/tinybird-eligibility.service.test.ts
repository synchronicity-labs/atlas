import { describe, expect, it } from "bun:test";
import {
	buildTinybirdEligibility,
	compactEligibilityQuery,
	type EligibilityRow,
	governProductPostgresQuery,
	governTinybirdQuery,
	hasSubscribedPopulation,
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

	it("keeps free-user questions pending until a source-side join exists", () => {
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
	it("requests only bounded internal exclusion rows", () => {
		const query = compactEligibilityQuery().toLowerCase();

		expect(query).toContain("@sync.so");
		expect(query).toContain("@sync.labs");
		expect(query).not.toContain("u.banned");
		expect(query).not.toContain("first_subscribed_at");
		expect(query).toContain("limit 2000");
	});

	it("recognizes quoted paid-plan predicates", () => {
		expect(
			hasSubscribedPopulation(`select count(*) from sync_prod.sync_usage3
where "organizationPlanType" is not null
  and "organizationPlanType" != ''`),
		).toBe(true);
		expect(
			hasSubscribedPopulation(`select count(*) from sync_prod.sync_usage3
where "organizationPlanType" in ('hobbyist', 'creator')`),
		).toBe(true);
	});

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

	it("filters both the churn cohort and its requalification outcomes at the source", () => {
		const governed = governProductPostgresQuery(
			`with churn as (
  select organization_id, month from public.org_movement_months where state = 'churn' and is_clean
), qualified as (
  select organization_id, month from org_movement_months where state = 'reactivation'
)
select count(*) from churn c left join qualified q on q.organization_id = c.organization_id`,
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain("atlas_subscribed_users as");
		expect(governed.queryText).toContain("atlas_population_organizations as");
		expect(governed.queryText).toContain(
			"atlas_eligible_org.id = atlas_cohort.organization_id",
		);
		expect(
			governed.queryText.match(/from atlas_population_org_movement_months/g),
		).toHaveLength(2);
		expect(
			governed.queryText.match(/from public.org_movement_months/g),
		).toHaveLength(1);
		expect(governed.queryText).toContain("state = 'churn' and is_clean");
	});

	it("filters holdback assignments as well as generation outcomes", () => {
		const governed = governProductPostgresQuery(
			`select f.organization_id from organization_features f
left join lateral (select 1 from generations g where g.organization_id = f.organization_id limit 1) returned on true`,
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain(
			"from atlas_population_organization_features f",
		);
		expect(governed.queryText).toContain("from atlas_population_generations g");
		expect(governed.queryText).toContain(
			"from public.organization_features atlas_cohort",
		);
		expect(governed.queryText).toContain(
			"from public.generations atlas_population_generation",
		);
		expect(governed.queryText).not.toContain("disabled");
	});

	it("preserves a cohort CTE while filtering its real source table", () => {
		const governed = governProductPostgresQuery(
			`with organization_features as (
select f.* from public.organization_features f where f.is_clean
) select count(*) from organization_features`,
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain(
			"from atlas_population_organization_features f where f.is_clean",
		);
		expect(governed.queryText).toEndWith(
			"select count(*) from organization_features",
		);
	});

	it("respects nested CTE scopes and does not mistake literal text for tables", () => {
		const governed = governProductPostgresQuery(
			`select 'from organization_features' as note, f.organization_id
from public.organization_features f
where exists (
with organization_features as (select 1 as id)
select 1 from organization_features
)
-- join org_movement_months`,
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain(
			"'from organization_features' as note",
		);
		expect(governed.queryText).toContain(
			"from atlas_population_organization_features f",
		);
		expect(governed.queryText).toContain("select 1 from organization_features");
		expect(governed.queryText).toEndWith("-- join org_movement_months");
		expect(governed.queryText).not.toContain(
			"atlas_population_org_movement_months",
		);
	});

	it("filters quoted source names and preserves explicit and implicit aliases", () => {
		const governed = governProductPostgresQuery(
			`select "organization_features".organization_id, m.month
from "organization_features", "public"."org_movement_months" m
where "organization_features".organization_id = m.organization_id`,
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain(
			'from atlas_population_organization_features as "organization_features", atlas_population_org_movement_months m',
		);
		expect(governed.queryText).toContain(
			'where "organization_features".organization_id = m.organization_id',
		);
	});

	it("keeps schema-qualified column references valid after replacing a source", () => {
		const governed = governProductPostgresQuery(
			"select public.generations.id, generations.user_id from public.generations",
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toEndWith(
			'select "generations".id, generations.user_id from atlas_population_generations as "generations"',
		);
	});

	it("does not approve a user-defined cohort with no governed source", () => {
		const queryText =
			"with organization_features as (select 1 as id) select * from organization_features";
		expect(governProductPostgresQuery(queryText, "PRODUCT_ACTIVITY")).toEqual({
			queryText,
			applied: false,
		});
	});

	it("preserves recursive references while filtering qualified sources", () => {
		const governed = governProductPostgresQuery(
			`with recursive organization_features(id) as (
select organization_id from public.organization_features
union all select id from organization_features where false
) select * from organization_features`,
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain(
			'select organization_id from atlas_population_organization_features as "organization_features"',
		);
		expect(governed.queryText).toContain(
			"union all select id from organization_features where false",
		);
		expect(governed.queryText).toEndWith("select * from organization_features");
	});

	it("fails closed on unsupported queries, writes, and reserved CTE names", () => {
		for (const queryText of [
			"select * from public.organization_features; select * from public.generations",
			"delete from public.organization_features returning *",
			"with removed as (delete from public.organization_features returning *) select * from removed",
			"with atlas_population_organization_features as (select 1) select * from public.organization_features",
			"select from public.organization_features where",
			"select * from other.organization_features",
			'select * from "Organization_Features"',
			"select 'from organization_features' as note -- join org_movement_months",
		]) {
			expect(governProductPostgresQuery(queryText, "PRODUCT_ACTIVITY")).toEqual(
				{ queryText, applied: false },
			);
		}
	});

	it("preserves feedback CTE column lists and values while filtering generations", () => {
		const governed = governProductPostgresQuery(
			`with fail_tags(tag) as (values ('unexpected_failure'), ('rejected_wrongly')),
chip_map(workflow, tag, polarity) as (values ('lipsync', 'no_lip_movement', 'negative'))
select g.id from public.generations g
join fail_tags f on f.tag = g.status
join chip_map c on c.tag = f.tag`,
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain(
			"fail_tags(tag) as (values ('unexpected_failure'), ('rejected_wrongly'))",
		);
		expect(governed.queryText).toContain(
			"chip_map(workflow, tag, polarity) as (values ('lipsync', 'no_lip_movement', 'negative'))",
		);
		expect(governed.queryText).toContain("from atlas_population_generations g");
	});

	it("respects quoted CTE column lists and their shadowed source names", () => {
		const governed = governProductPostgresQuery(
			`with "organization_features" ("organization_id") as (
select organization_id from public.organization_features
)
select * from "organization_features"`,
			"PRODUCT_ACTIVITY",
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain(
			'"organization_features" ("organization_id") as (',
		);
		expect(governed.queryText).toContain(
			'from atlas_population_organization_features as "organization_features"',
		);
		expect(governed.queryText).toEndWith(
			'select * from "organization_features"',
		);
	});

	it("never applies parser compatibility changes to literals, comments, or writes", () => {
		for (const queryText of [
			"with tags(tag) as (values ('x')) select 'fake(column) as (' from public.generations",
			"with tags(tag) as (values ('x')) select * from public.generations -- fake(column) as (",
			"with removed(id) as (delete from public.generations returning id) select * from removed",
			"with atlas_population_generations(id) as (select 1) select * from public.generations",
		]) {
			expect(governProductPostgresQuery(queryText, "PRODUCT_ACTIVITY")).toEqual(
				{ queryText, applied: false },
			);
		}
	});
});
