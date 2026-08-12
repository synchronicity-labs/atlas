import { describe, expect, test } from "bun:test";
import {
	buildTinybirdEligibility,
	governTinybirdQuery,
} from "../src/metabase/tinybird-eligibility.service";

const capturedAt = new Date("2026-08-11T18:00:00Z");

describe("TinyBird eligibility", () => {
	test("builds a stable current-state exclusion snapshot", () => {
		const snapshot = buildTinybirdEligibility(
			[
				{
					userId: "banned-user",
					email: "person@example.com",
					banned: true,
					disabled: false,
					isAnonymous: false,
					membershipRole: "owner",
					organizationId: "blocked-org",
					customerId: "blocked-customer",
				},
				{
					userId: "internal-user",
					email: "person@sync.so",
					banned: false,
					disabled: false,
					isAnonymous: false,
					membershipRole: "member",
					organizationId: "shared-org",
					customerId: "shared-customer",
				},
				{
					userId: "eligible-user",
					email: "person@example.com",
					banned: false,
					disabled: false,
					isAnonymous: false,
					membershipRole: "owner",
					organizationId: "eligible-org",
					customerId: "eligible-customer",
				},
			],
			capturedAt,
		);

		expect(snapshot.excludedUserIds).toEqual(["banned-user", "internal-user"]);
		expect(snapshot.excludedOrganizationIds).toEqual(["blocked-org"]);
		expect(snapshot.excludedCustomerIds).toEqual(["blocked-customer"]);
		expect(snapshot.contentHash).toHaveLength(64);
	});

	test("filters raw usage and Stripe sources before aggregation", () => {
		const snapshot = buildTinybirdEligibility(
			[
				{
					userId: "blocked-user",
					email: "blocked@example.com",
					banned: false,
					disabled: true,
					isAnonymous: false,
					membershipRole: "owner",
					organizationId: "blocked-org",
					customerId: "blocked-customer",
				},
			],
			capturedAt,
		);
		const governed = governTinybirdQuery(
			`select count(*)
from sync_prod.sync_usage3
union all
select count(*) from sync_prod.sync_stripe_invoices
union all
select count(*) from sync_prod.paid_customer_monthly_revenue`,
			"166",
			snapshot,
		);

		expect(governed.applied).toBe(true);
		expect(governed.queryText).toContain(`"userId" not in ('blocked-user')`);
		expect(governed.queryText).toContain(
			`"organizationId" not in ('blocked-org')`,
		);
		expect(governed.queryText).toContain(
			`customer_id not in ('blocked-customer')`,
		);
		expect(governed.eligibility.contentHash).toBe(snapshot.contentHash);
	});

	test("does not rewrite a non-TinyBird database query", () => {
		const snapshot = buildTinybirdEligibility([], capturedAt);
		const queryText = "select count(*) from sync_prod.sync_usage3";
		const governed = governTinybirdQuery(queryText, "34", snapshot);

		expect(governed.applied).toBe(false);
		expect(governed.queryText).toBe(queryText);
	});
});
