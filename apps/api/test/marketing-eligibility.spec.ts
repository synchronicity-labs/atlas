import { describe, expect, test } from "bun:test";
import {
	applyPosthogPersonPolicy,
	applyProductUserEligibility,
	PRODUCT_USER_ELIGIBILITY_TOKEN,
	productUserEligibilityPredicate,
} from "../src/marketing/marketing.eligibility";

describe("marketing product-user eligibility", () => {
	test("creates a stable person exclusion for banned product identities", () => {
		expect(
			productUserEligibilityPredicate(["user-2", "user-1", "user-2"]),
		).toBe(
			"person_id not in (select person_id from events where distinct_id in ('user-1', 'user-2'))",
		);
	});

	test("escapes product identifiers before placing them in HogQL", () => {
		expect(productUserEligibilityPredicate(["user'1"])).toContain("'user''1'");
	});

	test("uses a no-op predicate when no product users are banned", () => {
		expect(productUserEligibilityPredicate([])).toBe("1 = 1");
	});

	test("applies the policy to every eligibility token", () => {
		const query = `select * from events where ${PRODUCT_USER_ELIGIBILITY_TOKEN} or ${PRODUCT_USER_ELIGIBILITY_TOKEN}`;
		expect(applyProductUserEligibility(query, "person_id != 'blocked'")).toBe(
			"select * from events where person_id != 'blocked' or person_id != 'blocked'",
		);
	});

	test("rejects PostHog questions that omit the eligibility policy", () => {
		expect(() =>
			applyProductUserEligibility("select * from events", "1 = 1"),
		).toThrow(PRODUCT_USER_ELIGIBILITY_TOKEN);
	});

	test("allows pre-account event questions to opt into all events", () => {
		expect(
			applyPosthogPersonPolicy(
				"select count() from events where event = 'signup_blocked'",
				"all_events",
				"person_id != 'blocked'",
			),
		).toBe("select count() from events where event = 'signup_blocked'");
	});

	test("rejects a contradictory eligibility token on all-events queries", () => {
		expect(() =>
			applyPosthogPersonPolicy(
				`select count() from events where ${PRODUCT_USER_ELIGIBILITY_TOKEN}`,
				"all_events",
				"1 = 1",
			),
		).toThrow("must omit");
	});
});
