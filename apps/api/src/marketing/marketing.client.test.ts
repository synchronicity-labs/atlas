import { afterEach, describe, expect, mock, test } from "bun:test";
import { MarketingClient } from "./marketing.client";
import type { MarketingConfig } from "./marketing.config";

const config: MarketingConfig = {
	google: null,
	ga4: {},
	searchConsole: {},
	posthog: {
		host: "https://posthog.example",
		apiKey: "test-key",
		projectId: "1",
	},
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("MarketingClient PostHog retries", () => {
	test("retries a transient gateway failure", async () => {
		const fetchMock = mock()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: "timeout" }), { status: 504 }),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						columns: ["signups"],
						types: [["signups", "UInt64"]],
						results: [[42]],
					}),
					{ status: 200 },
				),
			);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await new MarketingClient(config, 0).execute({
			source: "posthog",
			personPolicy: "all_events",
			query: "select 42 as signups",
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.rows).toEqual([[42]]);
	});

	test("does not retry a bad query", async () => {
		const fetchMock = mock().mockResolvedValue(
			new Response(JSON.stringify({ error: "bad query" }), { status: 400 }),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(
			new MarketingClient(config, 0).execute({
				source: "posthog",
				personPolicy: "all_events",
				query: "select broken",
			}),
		).rejects.toThrow("PostHog query failed (400).");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("rejects a truncated PostHog result", async () => {
		const fetchMock = mock().mockResolvedValue(
			new Response(
				JSON.stringify({
					columns: ["day"],
					types: [["day", "DateTime"]],
					results: Array.from({ length: 100 }, (_, index) => [index]),
					hasMore: true,
				}),
				{ status: 200 },
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(
			new MarketingClient(config, 0).execute({
				source: "posthog",
				personPolicy: "all_events",
				query: "select day from events order by day",
			}),
		).rejects.toThrow(
			"PostHog query result was truncated. Add an explicit LIMIT to the saved query.",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
