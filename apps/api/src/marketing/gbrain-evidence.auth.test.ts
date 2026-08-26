import { describe, expect, test } from "bun:test";
import { validGbrainEvidenceAuthorization } from "./gbrain-evidence.auth";

describe("gBrain evidence authorization", () => {
	const secret = "a".repeat(32);

	test("accepts only the dedicated bearer secret", () => {
		expect(validGbrainEvidenceAuthorization(secret, `Bearer ${secret}`)).toBe(
			true,
		);
		expect(validGbrainEvidenceAuthorization(secret, "Bearer invalid")).toBe(
			false,
		);
		expect(validGbrainEvidenceAuthorization(secret, undefined)).toBe(false);
	});
});
