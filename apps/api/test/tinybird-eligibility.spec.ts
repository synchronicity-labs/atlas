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
					hasSubscribed: false,
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
					hasSubscribed: false,
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
					hasSubscribed: false,
				},
			],
			capturedAt,
		);

		expect(snapshot.excludedUserIds).toEqual(["banned-user", "internal-user"]);
		expect(snapshot.excludedOrganizationIds).toEqual(["blocked-org"]);
		expect(snapshot.excludedCustomerIds).toEqual(["blocked-customer"]);
		expect(snapshot.complete).toBe(true);
		expect(snapshot.contentHash).toHaveLength(64);
	});

	test("observes disabled users without erasing their historical usage", () => {
		const snapshot = buildTinybirdEligibility(
			[
				{
					userId: "deleted-user",
					email: "person@example.com",
					banned: false,
					disabled: true,
					isAnonymous: false,
					membershipRole: "owner",
					organizationId: "historical-org",
					customerId: "historical-customer",
					hasSubscribed: false,
				},
			],
			capturedAt,
		);

		expect(snapshot.excludedUserIds).toEqual([]);
		expect(snapshot.excludedOrganizationIds).toEqual([]);
		expect(snapshot.excludedCustomerIds).toEqual([]);
	});

	test("filters raw usage and Stripe sources before aggregation", () => {
		const snapshot = buildTinybirdEligibility(
			[
				{
					userId: "blocked-user",
					email: "blocked@example.com",
					banned: true,
					disabled: false,
					isAnonymous: false,
					membershipRole: "owner",
					organizationId: "blocked-org",
					customerId: "blocked-customer",
					hasSubscribed: false,
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
		expect(governed.queryText).toContain(
			`("userId" is null or "userId" = '' or "userId" not in ('blocked-user'))`,
		);
		expect(governed.queryText).toContain(`"userId" not in ('blocked-user')`);
		expect(governed.queryText).toContain(
			`"organizationId" not in ('blocked-org')`,
		);
		expect(governed.queryText).toContain(
			`customer_id not in ('blocked-customer')`,
		);
		expect(governed.eligibility.contentHash).toBe(snapshot.contentHash);
	});

	test("does not apply or certify a truncated eligibility snapshot", () => {
		const snapshot = buildTinybirdEligibility(
			[
				{
					userId: "first-page-user",
					email: "person@example.com",
					banned: true,
					disabled: false,
					isAnonymous: false,
					membershipRole: "owner",
					organizationId: "first-page-org",
					customerId: "first-page-customer",
					hasSubscribed: false,
				},
			],
			capturedAt,
			2,
		);
		const queryText = "select count(*) from sync_prod.sync_usage3";
		const governed = governTinybirdQuery(queryText, "166", snapshot);

		expect(snapshot.complete).toBe(false);
		expect(governed.applied).toBe(false);
		expect(governed.queryText).toBe(queryText);
		expect(governed.eligibility).toMatchObject({
			complete: false,
			sourceRows: 2,
			returnedRows: 1,
		});
	});

	test("does not rewrite a non-TinyBird database query", () => {
		const snapshot = buildTinybirdEligibility([], capturedAt);
		const queryText = "select count(*) from sync_prod.sync_usage3";
		const governed = governTinybirdQuery(queryText, "34", snapshot);

		expect(governed.applied).toBe(false);
		expect(governed.queryText).toBe(queryText);
	});
});
