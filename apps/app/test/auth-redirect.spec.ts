import { describe, expect, it } from "bun:test";
import {
	DEFAULT_AUTH_DESTINATION,
	getSafeAuthDestination,
	getSignInPath,
} from "../lib/auth-redirect";

describe("auth redirects", () => {
	it("keeps a shared Atlas path and its query string", () => {
		expect(
			getSafeAuthDestination("/questions/55?rudy=question%3A55&tab=2"),
		).toBe("/questions/55?rudy=question%3A55&tab=2");
	});

	it("falls back when the destination could leave Atlas or loop", () => {
		for (const destination of [
			undefined,
			"https://example.com",
			"//example.com",
			"/\\example.com",
			"/sign-in",
		]) {
			expect(getSafeAuthDestination(destination)).toBe(
				DEFAULT_AUTH_DESTINATION,
			);
		}
	});

	it("encodes the destination in the sign-in URL", () => {
		const path = getSignInPath("/dashboards/2?tab=3", "google");
		const url = new URL(path, "https://atlas.local");

		expect(url.pathname).toBe("/sign-in");
		expect(url.searchParams.get("next")).toBe("/dashboards/2?tab=3");
		expect(url.searchParams.get("method")).toBe("google");
	});
});
