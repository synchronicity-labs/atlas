import { afterEach, describe, expect, it, mock } from "bun:test";
import { MetabaseClient } from "./metabase.client";

const originalFetch = globalThis.fetch;
const client = new MetabaseClient({
	baseUrl: "https://metabase.example.test",
	apiKey: "test-only",
	dashboardId: 1,
	userQuestionId: 2,
	cardBatchSize: 2,
	userBatchSize: 100,
	maxBackfillMonths: 6,
});
const visualQuery = {
	language: "MBQL" as const,
	databaseExternalId: "34",
	queryText: JSON.stringify({
		database: 34,
		type: "query",
		query: { "source-table": 1487 },
	}),
};

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("Metabase visual query preparation", () => {
	it("compiles a Product visual query without executing it", async () => {
		const request = mock(async (_input: Parameters<typeof fetch>[0]) =>
			Response.json({
				query: "select * from public.generation_feedback",
				params: null,
			}),
		);
		globalThis.fetch = request as unknown as typeof fetch;
		const prepared = await client.preparePreview(visualQuery);
		expect(prepared.language).toBe("SQL");
		expect(prepared.queryText).toBe("select * from public.generation_feedback");
		expect(request).toHaveBeenCalledTimes(1);
		expect(String(request.mock.calls[0]?.[0])).toEndWith("/api/dataset/native");
	});

	it("leaves SQL and other database queries unchanged", async () => {
		const request = mock(async () => Response.json({}));
		globalThis.fetch = request as unknown as typeof fetch;
		const sql = {
			...visualQuery,
			language: "SQL" as const,
			queryText: "select 1",
		};
		expect(await client.preparePreview(sql)).toEqual(sql);
		const other = { ...visualQuery, databaseExternalId: "166" };
		expect(await client.preparePreview(other)).toEqual(other);
		expect(request).not.toHaveBeenCalled();
	});

	it("rejects a database mismatch before making a request", async () => {
		const request = mock(async () => Response.json({}));
		globalThis.fetch = request as unknown as typeof fetch;
		await expect(
			client.preparePreview({ ...visualQuery, queryText: '{"database":166}' }),
		).rejects.toThrow("does not match");
		expect(request).not.toHaveBeenCalled();
	});

	it("does not silently discard visual query parameters", async () => {
		await expect(
			client.preparePreview({
				...visualQuery,
				queryText: JSON.stringify({
					database: 34,
					parameters: [{ value: "active" }],
				}),
			}),
		).rejects.toThrow("bound parameters");
	});

	it("rejects compiled SQL with unresolved parameter values", async () => {
		globalThis.fetch = mock(async () =>
			Response.json({
				query: "select * from public.generations where status = ?",
				params: ["COMPLETED"],
			}),
		) as unknown as typeof fetch;
		await expect(client.preparePreview(visualQuery)).rejects.toThrow(
			"bound parameters",
		);
	});

	it("requires a read-only SQL result", async () => {
		globalThis.fetch = mock(async () =>
			Response.json({ query: "delete from public.generations", params: [] }),
		) as unknown as typeof fetch;
		await expect(client.preparePreview(visualQuery)).rejects.toThrow(
			"read-only",
		);
		globalThis.fetch = mock(async () =>
			Response.json({ query: null }),
		) as unknown as typeof fetch;
		await expect(client.preparePreview(visualQuery)).rejects.toThrow(
			"did not return SQL",
		);
	});
});
