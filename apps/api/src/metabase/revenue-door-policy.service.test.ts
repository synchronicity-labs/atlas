import { describe, expect, it } from "bun:test";
import { RevenueDoor, RevenueDoorPolicyStatus } from "@crm/db";
import {
	applyPartnerRevenueDoorPolicy,
	applyRevenueDoorPolicy,
	assertResolvedAtlasQuery,
	usesPartnerRevenueDoorPolicy,
	usesRevenueDoorPolicy,
	usesSubscribedRevenueEligibility,
} from "./revenue-door-policy.service";
import { governTinybirdQuery } from "./tinybird-eligibility.service";

const policy = {
	policyId: "company-revenue-doors",
	status: RevenueDoorPolicyStatus.PARTIAL,
	complete: false,
	matchMode: "EXCLUDE_NON_TOOLS" as const,
	door: RevenueDoor.TOOLS,
	ruleCount: 3,
	excludedPlans: ["enterprise", "partner", "program"],
	excludedDomains: ["fal.ai"],
	excludedOrganizationIds: ["org-fal", "org-replicate"],
	includedPlans: [],
	includedDomains: [],
	includedOrganizationIds: [],
	includedOrganizationLabels: [],
	unresolvedDomains: [],
	contentHash: "policy-hash",
};

const partnerPolicy = {
	...policy,
	matchMode: "INCLUDE_PARTNERS" as const,
	door: RevenueDoor.PARTNERS,
	excludedPlans: [],
	excludedDomains: [],
	excludedOrganizationIds: [],
	includedPlans: ["partner"],
	includedDomains: ["fal.ai", "replicate.com"],
	includedOrganizationIds: ["org-fal", "org-replicate"],
	includedOrganizationLabels: [
		{ organizationId: "org-fal", label: "fal.ai" },
		{ organizationId: "org-replicate", label: "replicate.com" },
	],
};

describe("applyRevenueDoorPolicy", () => {
	it("covers every governed revenue question", () => {
		expect(usesRevenueDoorPolicy(1101)).toBe(true);
		expect(usesRevenueDoorPolicy(1111)).toBe(true);
		expect(usesRevenueDoorPolicy(1112)).toBe(true);
		expect(usesRevenueDoorPolicy(1116)).toBe(true);
		expect(usesRevenueDoorPolicy(1117)).toBe(false);
		expect(usesSubscribedRevenueEligibility(1001)).toBe(true);
		expect(usesSubscribedRevenueEligibility(1014)).toBe(true);
		expect(usesSubscribedRevenueEligibility(1101)).toBe(true);
		expect(usesSubscribedRevenueEligibility(999)).toBe(false);
		expect(
			usesSubscribedRevenueEligibility(
				6027,
				"Gross Logo Retention",
				"select starting_paid_organizations from retention",
			),
		).toBe(true);
		expect(
			usesSubscribedRevenueEligibility(
				5007,
				"Free & paid frames",
				"select paid_frames, free_frames from usage",
			),
		).toBe(false);
		expect(usesPartnerRevenueDoorPolicy(1111)).toBe(false);
		expect(usesPartnerRevenueDoorPolicy(1112)).toBe(true);
		expect(usesPartnerRevenueDoorPolicy(1116)).toBe(true);
	});

	it("filters usage and subscription rows before the saved query runs", () => {
		const result = applyRevenueDoorPolicy(
			`select * from sync_prod.sync_usage3
union all
select * from sync_prod.sync_stripe_subscriptions_with_plan
union all
select * from sync_prod.sync_stripe_invoices`,
			policy,
		);

		expect(result.applied).toBe(true);
		expect(result.queryText).toContain(
			`lower(coalesce("organizationPlanType", '')) not in ('enterprise', 'partner', 'program')`,
		);
		expect(result.queryText).toContain(
			`"organizationId" in (select distinct "organizationId"`,
		);
		expect(result.queryText).toContain(
			`"organizationId" not in ('org-fal', 'org-replicate')`,
		);
		expect(result.queryText).toContain(
			`lower(coalesce(plan, '')) not in ('enterprise', 'partner', 'program')`,
		);
		expect(result.queryText).toContain(
			`from sync_prod.sync_stripe_invoices where "organizationId" not in ('org-fal', 'org-replicate')`,
		);
	});

	it("includes only governed partner rows and resolves partner labels", () => {
		const result = applyPartnerRevenueDoorPolicy(
			`select __ATLAS_PARTNER_LABEL__ as partner from sync_prod.sync_usage3
union all
select 'invoice' from sync_prod.sync_stripe_invoices`,
			partnerPolicy,
		);

		expect(result.applied).toBe(true);
		expect(result.queryText).toContain(
			`lower(coalesce("organizationPlanType", '')) in ('partner')`,
		);
		expect(result.queryText).toContain(
			`"organizationId" in (select distinct "organizationId"`,
		);
		expect(result.queryText).toContain(
			`"organizationId" in ('org-fal', 'org-replicate')`,
		);
		expect(result.queryText).toContain(
			`multiIf("organizationId" = 'org-fal', 'fal.ai', "organizationId" = 'org-replicate', 'replicate.com', 'Other partner')`,
		);
	});

	it("rejects an unresolved Atlas query template before execution", () => {
		expect(() =>
			assertResolvedAtlasQuery(
				1115,
				"select __ATLAS_PARTNER_LABEL__ as partner",
			),
		).toThrow("Question 1115 has an unresolved Atlas query template");
		expect(() =>
			assertResolvedAtlasQuery(1115, "select 'fal.ai' as partner"),
		).not.toThrow();
	});

	it("leaves unrelated source queries unchanged", () => {
		const queryText = "select * from public.other_table";
		expect(applyRevenueDoorPolicy(queryText, policy)).toEqual({
			queryText,
			applied: false,
		});
	});

	it("composes with the governed user eligibility filter", () => {
		const classified = applyRevenueDoorPolicy(
			"select * from sync_prod.sync_usage3",
			policy,
		);
		const governed = governTinybirdQuery(classified.queryText, "166", {
			capturedAt: new Date("2026-08-18T12:00:00.000Z"),
			contentHash: "eligibility-hash",
			excludedUserIds: ["user-internal"],
			excludedOrganizationIds: [],
			excludedCustomerIds: [],
			complete: true,
			sourceRows: 1,
			returnedRows: 1,
			scope: "SUBSCRIBED_ORGANIZATIONS",
		});

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain(
			`"organizationId" not in ('org-fal', 'org-replicate')`,
		);
		expect(governed.queryText).toContain(`"userId" not in ('user-internal')`);
	});
});
