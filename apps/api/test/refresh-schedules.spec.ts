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

describe("All Hands dashboard refresh schedules", () => {
	test("refreshes native and Metabase answers before September reporting", () => {
		const build = readFileSync(
			new URL("../scripts/build-func.mjs", import.meta.url),
			"utf8",
		);
		const schedules = [
			...build.matchAll(/path: "([^"]+)",\s*schedule: "([^"]+)"/g),
		];

		expect(
			schedules.some(
				(match) =>
					match[1] === "/internal/sync/atlas/18/native" &&
					match[2] === "49 */6 * * *",
			),
		).toBe(true);
		expect(
			schedules.some(
				(match) =>
					match[1] === "/internal/sync/atlas/18/metabase" &&
					match[2] === "11-59/15 * * * *",
			),
		).toBe(true);
	});
});

describe("governed refresh safety margin", () => {
	test("does not schedule an eight-hour source at its eight-hour freshness limit", () => {
		const build = readFileSync(
			new URL("../scripts/build-func.mjs", import.meta.url),
			"utf8",
		);
		const schedules = [
			...build.matchAll(/path: "([^"]+)",\s*schedule: "([^"]+)"/g),
		].map((match) => ({ path: match[1], schedule: match[2] }));

		expect(
			schedules.filter(({ schedule }) => schedule?.includes("*/8")),
		).toEqual([]);
	});
});
