import { describe, expect, test } from "bun:test";
import { textContent } from "../src/rudy/rudy.client";
import { rudyContext, rudySendInput } from "../src/rudy/rudy.contracts";

describe("Rudy Atlas channel contracts", () => {
	test("accepts stable Atlas context references", () => {
		expect(rudyContext.parse({ kind: "workspace", id: "atlas" })).toEqual({
			kind: "workspace",
			id: "atlas",
		});
		expect(rudyContext.parse({ kind: "dashboard", id: "4" })).toEqual({
			kind: "dashboard",
			id: "4",
		});
		expect(rudyContext.parse({ kind: "question", id: "125" })).toEqual({
			kind: "question",
			id: "125",
		});
	});

	test("rejects unstable or mismatched context ids", () => {
		expect(() =>
			rudyContext.parse({ kind: "workspace", id: "other" }),
		).toThrow();
		expect(() =>
			rudyContext.parse({ kind: "dashboard", id: "sales-dashboard" }),
		).toThrow();
	});

	test("requires a non-empty message", () => {
		expect(() =>
			rudySendInput.parse({
				context: { kind: "question", id: "1" },
				message: "   ",
			}),
		).toThrow();
	});

	test("normalizes Hermes multimodal text content", () => {
		expect(
			textContent([
				{ type: "text", text: "First" },
				{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
				{ type: "text", text: "Second" },
			]),
		).toBe("First\nSecond");
	});
});
