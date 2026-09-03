import { describe, expect, test } from "bun:test";
import { betterStackConnectionRegion } from "./betterstack.client";

describe("BetterStack connection region", () => {
	test("derives the source region from the configured read-only SQL host", () => {
		expect(
			betterStackConnectionRegion("eu-central-1a-connect.betterstackdata.com"),
		).toBe("eu-central-1a");
	});

	test("rejects hosts outside the BetterStack connection domain", () => {
		expect(betterStackConnectionRegion("logs.example.com")).toBe("");
		expect(betterStackConnectionRegion("betterstackdata.com.evil.test")).toBe(
			"",
		);
	});
});
