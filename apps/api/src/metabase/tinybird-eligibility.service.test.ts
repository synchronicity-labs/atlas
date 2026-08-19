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
	...input,
});

describe("revenue TinyBird eligibility", () => {
	it("builds a complete subscribed-organization exclusion snapshot", () => {
		const snapshot = buildTinybirdEligibility(
			[
				row({ banned: true }),
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
		expect(snapshot.excludedUserIds).toEqual(["user-1", "user-internal"]);
		expect(snapshot.excludedOrganizationIds).toEqual(["org-1", "org-internal"]);
		expect(snapshot.excludedCustomerIds).toEqual([
			"customer-1",
			"customer-internal",
		]);
	});

	it("applies the scoped exclusions only when the snapshot is complete", () => {
		const snapshot = buildTinybirdEligibility(
			[row({ banned: true })],
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
		expect(governed.queryText).toContain(`"userId" not in ('user-1')`);
	});
});
