import { describe, expect, test } from "bun:test";
import {
	assertReadOnlyQuery,
	bindDefaultMetabaseTemplateVariables,
	boundSensitiveIdentityResult,
} from "./read-only-query";

describe("read-only Atlas questions", () => {
	test("allows read-only SQL", () => {
		expect(() => assertReadOnlyQuery("SQL", "select 1")).not.toThrow();
	});

	test("rejects write SQL", () => {
		expect(() => assertReadOnlyQuery("SQL", "delete from users")).toThrow(
			"Atlas questions only allow read-only SQL.",
		);
	});

	test("bounds Product Postgres identity results at the source", () => {
		const query = boundSensitiveIdentityResult(
			"SQL",
			"select id, email from auth.users;",
			"34",
		);

		expect(query).toContain("atlas_bounded_identity_result");
		expect(query).toEndWith("limit 2000");
	});

	test("does not change aggregate queries on other databases", () => {
		const query = "select count(*) from auth.users";
		expect(boundSensitiveIdentityResult("SQL", query, "166")).toBe(query);
	});

	test("binds the default monthly grain for stored Metabase SQL", () => {
		expect(
			bindDefaultMetabaseTemplateVariables(
				"SQL",
				"select {{ bucket }}::text as grain",
			),
		).toBe("select 'month'::text as grain");
	});

	test("does not change MBQL templates", () => {
		const query = '{"bucket":"{{bucket}}"}';
		expect(bindDefaultMetabaseTemplateVariables("MBQL", query)).toBe(query);
	});
});
