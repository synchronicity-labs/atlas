import { describe, expect, test } from "bun:test";
import { productUserEligibilityPredicate } from "./marketing.eligibility";

describe("marketing product-user eligibility", () => {
	test("deduplicates excluded identities before building the PostHog predicate", () => {
		expect(
			productUserEligibilityPredicate(["user-2", "user-1", "user-2"]),
		).toBe(
			"person_id not in (select person_id from events where distinct_id in ('user-1', 'user-2'))",
		);
	});

	test("escapes identity values used in HogQL", () => {
		expect(productUserEligibilityPredicate(["user'1"])).toContain("'user''1'");
	});
});
