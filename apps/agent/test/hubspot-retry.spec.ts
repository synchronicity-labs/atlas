import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgresql://user:pass@127.0.0.1:5432/atlas";
const { hubspotRetryDelay } = await import("../agent/lib/hubspot-sync");

describe("HubSpot retry delay", () => {
	for (const header of [null, "", "0", "invalid", "-1"]) {
		test(`backs off when Retry-After is ${String(header)}`, () => {
			expect(hubspotRetryDelay(header, 0)).toBe(1000);
			expect(hubspotRetryDelay(header, 3)).toBe(8000);
		});
	}

	test("honors a numeric server delay", () => {
		expect(hubspotRetryDelay("5", 0)).toBe(5000);
	});

	test("honors an HTTP-date server delay", () => {
		expect(
			hubspotRetryDelay(
				"Thu, 27 Aug 2026 14:00:05 GMT",
				0,
				Date.parse("2026-08-27T14:00:00Z"),
			),
		).toBe(5000);
	});
});
