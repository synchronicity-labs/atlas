import { describe, expect, it } from "bun:test";
import { jsonDate } from "../agent/lib/json";

describe("read contract", () => {
	it("returns JSON-safe source timestamps", () => {
		const timestamp = jsonDate(new Date("2026-08-25T10:00:00.000Z"));

		expect(timestamp).toBe("2026-08-25T10:00:00.000Z");
		expect(JSON.stringify({ sourceUpdatedAt: timestamp })).toBe(
			'{"sourceUpdatedAt":"2026-08-25T10:00:00.000Z"}',
		);
		expect(jsonDate(null)).toBeNull();
	});
});
