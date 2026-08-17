import { describe, expect, test } from "bun:test";
import { textContent } from "../src/rudy/rudy.client";
import { rudyContext, rudySendInput } from "../src/rudy/rudy.contracts";
import { RudyService } from "../src/rudy/rudy.service";

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

	test("scopes Rudy conversation lists to the signed-in Atlas user", async () => {
		let where: unknown;
		const database = {
			rudySession: {
				findMany: async (input: { where: unknown }) => {
					where = input.where;
					return [];
				},
			},
		};
		const service = new RudyService(database as never, {} as never);

		await service.list({ kind: "workspace", id: "atlas" }, "atlas-user-1");

		expect(where).toEqual({
			userId: "atlas-user-1",
			contextKind: "workspace",
			contextId: "atlas",
		});
	});

	test("does not open a Rudy conversation owned by another user", async () => {
		const database = {
			rudySession: {
				findUnique: async () => ({
					id: "thread-1",
					userId: "atlas-user-1",
					hermesSessionId: "hermes-1",
				}),
			},
		};
		const service = new RudyService(database as never, {} as never);

		expect(service.messages("thread-1", "atlas-user-2")).rejects.toThrow(
			"That Rudy session does not exist.",
		);
	});
});
