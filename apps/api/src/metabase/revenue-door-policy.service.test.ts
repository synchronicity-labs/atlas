import { describe, expect, it } from "bun:test";
import { RevenueDoorPolicyStatus } from "@crm/db";
import { applyRevenueDoorPolicy } from "./revenue-door-policy.service";
import { governTinybirdQuery } from "./tinybird-eligibility.service";

const policy = {
	policyId: "company-revenue-doors",
	status: RevenueDoorPolicyStatus.PARTIAL,
	complete: false,
	ruleCount: 3,
	excludedPlans: ["enterprise", "partner", "program"],
	excludedDomains: ["fal.ai"],
	excludedOrganizationIds: ["org-fal", "org-replicate"],
	unresolvedDomains: [],
	contentHash: "policy-hash",
};

describe("applyRevenueDoorPolicy", () => {
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
			`"organizationId" not in ('org-fal', 'org-replicate')`,
		);
		expect(result.queryText).toContain(
			`lower(coalesce(plan, '')) not in ('enterprise', 'partner', 'program')`,
		);
		expect(result.queryText).toContain(
			`from sync_prod.sync_stripe_invoices where "organizationId" not in ('org-fal', 'org-replicate')`,
		);
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
		});

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain(
			`"organizationId" not in ('org-fal', 'org-replicate')`,
		);
		expect(governed.queryText).toContain(`"userId" not in ('user-internal')`);
	});
});
