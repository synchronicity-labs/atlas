import { afterEach, describe, expect, mock, test } from "bun:test";
import {
	BetterStackClient,
	betterStackConnectionRegion,
} from "./betterstack.client";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const client = new BetterStackClient({
	telemetryApiKey: "test",
	sqlEuHost: "eu-central-1a-connect.betterstackdata.com",
	sqlEuRegion: "eu-central-1a",
	sqlEuUser: "test",
	sqlEuPass: "test",
});
const source = {
	id: "1018705",
	name: "test",
	dataRegion: "eu-central-1a",
	teamId: "202575",
	tableName: "test",
};

describe("BetterStack bounded timeout retry", () => {
	test("keeps one timeout retry after a transient HTTP failure", async () => {
		const fetch = mock()
			.mockResolvedValueOnce(new Response("retry", { status: 503 }))
			.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
			.mockResolvedValueOnce(new Response('{"count":1}\n'));
		globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
		expect(await client.sql(source, "select 1")).toEqual([{ count: 1 }]);
		expect(fetch).toHaveBeenCalledTimes(3);
	});
	test("retries a timed-out request once", async () => {
		const fetch = mock()
			.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
			.mockResolvedValueOnce(new Response('{"count":1}\n'));
		globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
		expect(
			await client.sql(source, "select count() from remote(test_logs)"),
		).toEqual([{ count: 1 }]);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	test("also retries a timeout while reading the response body", async () => {
		const fetch = mock()
			.mockResolvedValueOnce({
				ok: true,
				text: async () => {
					throw new DOMException("aborted", "AbortError");
				},
			})
			.mockResolvedValueOnce(new Response('{"count":1}\n'));
		globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
		expect(await client.sql(source, "select 1")).toEqual([{ count: 1 }]);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	test("stops after a second timeout and does not retry permissions or invalid JSON", async () => {
		const fetch = mock().mockRejectedValue(
			new DOMException("timed out", "TimeoutError"),
		);
		globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
		await expect(client.sql(source, "select 1")).rejects.toThrow("timed out");
		expect(fetch).toHaveBeenCalledTimes(2);
		const denied = mock().mockResolvedValue(
			new Response("denied", { status: 403 }),
		);
		globalThis.fetch = denied as unknown as typeof globalThis.fetch;
		await expect(client.sql(source, "select 1")).rejects.toThrow("HTTP 403");
		expect(denied).toHaveBeenCalledTimes(1);
		const invalid = mock().mockResolvedValue(new Response("invalid JSON"));
		globalThis.fetch = invalid as unknown as typeof globalThis.fetch;
		await expect(client.sql(source, "select 1")).rejects.toThrow();
		expect(invalid).toHaveBeenCalledTimes(1);
	});
});

describe("BetterStack connection region", () => {
	test("derives the source region from the configured read-only SQL host", () => {
		expect(
			betterStackConnectionRegion("eu-central-1a-connect.betterstackdata.com"),
		).toBe("eu-central-1a");
	});

	test("rejects hosts outside the BetterStack connection domain", () => {
		expect(betterStackConnectionRegion("logs.example.com")).toBe("");
		expect(betterStackConnectionRegion("betterstackdata.com.evil.test")).toBe(
			"",
		);
	});
});
