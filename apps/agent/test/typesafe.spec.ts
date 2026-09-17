import { afterEach, describe, expect, it } from "bun:test";
import { askTypeSafeChoice } from "../agent/lib/typesafe";

const originalKey = process.env.TYPESAFE_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
	if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
	else process.env.TYPESAFE_API_KEY = originalKey;
	globalThis.fetch = originalFetch;
});

describe("TypeSafe client", () => {
	it("returns a typed choice from the API response", async () => {
		process.env.TYPESAFE_API_KEY = "test-key";
		globalThis.fetch = (async (_input, init) => {
			const body = JSON.parse(String(init?.body));
			expect(body.model).toBe("jev-latest");
			expect(body.questions.choice.type).toBe("choice");
			return Response.json({
				answers: {
					choice: {
						choice: "acme",
						probabilities: { acme: 0.9, other: 0.1 },
						confidence: 0.8,
					},
				},
			});
		}) as typeof fetch;

		expect(
			await askTypeSafeChoice({
				state: { customer: "Acme" },
				instructions: "Choose the match.",
				criteria: { acme: "Acme", other: "Something else" },
			}),
		).toEqual({
			choice: "acme",
			probabilities: { acme: 0.9, other: 0.1 },
			confidence: 0.8,
		});
	});

	it("does nothing without a key", async () => {
		delete process.env.TYPESAFE_API_KEY;
		globalThis.fetch = (() => {
			throw new Error("fetch should not run");
		}) as typeof fetch;

		expect(
			await askTypeSafeChoice({
				state: {},
				instructions: "Choose the match.",
				criteria: { acme: "Acme" },
			}),
		).toBeNull();
	});
});
