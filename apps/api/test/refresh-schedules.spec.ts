import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("governed Sales refresh schedule", () => {
	test("refreshes native answers every six hours with time left before expiry", () => {
		const build = readFileSync(
			new URL("../scripts/build-func.mjs", import.meta.url),
			"utf8",
		);
		const schedules = [
			...build.matchAll(/path: "([^"]+)",\s*schedule: "([^"]+)"/g),
		];
		const sales = schedules.filter(
			(match) => match[1] === "/internal/sync/atlas/4/native",
		);
		expect(sales).toHaveLength(1);
		expect(sales[0]?.[2]).toBe("40 */6 * * *");
		expect(
			schedules.some((match) => match[1] === "/internal/sync/atlas/4/metabase"),
		).toBe(true);
	});
});
