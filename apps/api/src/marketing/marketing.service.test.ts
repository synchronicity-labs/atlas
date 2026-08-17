import { describe, expect, test } from "bun:test";
import { marketingAttemptVerificationRows } from "./marketing.service";

describe("marketing metric attempts", () => {
	test("records the approved visitor definition and keeps the identity bridge pending", () => {
		const rows = marketingAttemptVerificationRows({
			questionNumber: 2001,
			questionVersion: 2,
			capturedAt: new Date("2026-08-14T12:00:00.000Z"),
			resultPresent: true,
		});

		expect(rows.map((row) => [row.name, row.status])).toEqual([
			["read_only_query", "PASSED"],
			["source_snapshot", "PASSED"],
			["result_non_empty", "PASSED"],
			["approved_cross_property_definition", "PASSED"],
			["cross_site_identity_bridge", "PENDING"],
		]);
	});
});
