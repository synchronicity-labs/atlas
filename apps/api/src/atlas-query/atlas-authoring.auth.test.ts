import { describe, expect, test } from "bun:test";
import { validAtlasAuthoringAuthorization } from "./atlas-authoring.auth";

describe("Atlas authoring authorization", () => {
	const secret = "a".repeat(32);

	test("accepts only the dedicated bearer secret", () => {
		expect(validAtlasAuthoringAuthorization(secret, `Bearer ${secret}`)).toBe(
			true,
		);
		expect(
			validAtlasAuthoringAuthorization(secret, `Bearer ${"b".repeat(32)}`),
		).toBe(false);
		expect(validAtlasAuthoringAuthorization(secret, undefined)).toBe(false);
	});
});
