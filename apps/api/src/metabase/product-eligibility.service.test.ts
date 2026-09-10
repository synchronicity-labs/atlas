import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MarketingClient } from "../marketing/marketing.client";
import { MetabaseClient } from "./metabase.client";
import { ProductEligibilityService } from "./product-eligibility.service";

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
const service = new ProductEligibilityService({} as never, {} as never);

function attributionRow(index: number, count: number) {
	return {
		period: "2026-03-01T00:00:00Z",
		organizationId: `org-${String(index).padStart(6, "0")}`,
		activity_date: "2026-03-02",
		user_id: index % 2 ? `user-${index}` : "",
		api_key_id: index % 2 ? "" : `key-${index}`,
		generations: index + 1,
		accrued_value_usd: index + 0.00001,
		last_activity_at: "2026-03-02T11:12:13Z",
		source_row_count: count,
	};
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	mock.restore();
});

describe("scoped deletion lookup", () => {
	it("does not query PostHog when there are no owners", async () => {
		const execute = spyOn(MarketingClient.prototype, "execute");
		expect(await service["userDeletionEvents"](new Map())).toEqual(new Map());
		expect(execute).not.toHaveBeenCalled();
	});

	it("batches unique owners, retaining earliest deletion across all history", async () => {
		const execute = spyOn(MarketingClient.prototype, "execute")
			.mockResolvedValueOnce({
				columns: [],
				rows: [["owner-0", "2025-01-01T00:00:00Z"]],
			})
			.mockResolvedValueOnce({
				columns: [],
				rows: [["owner-1000", "2026-09-01T00:00:00Z"]],
			});
		const principals = new Map(
			Array.from({ length: 1_001 }, (_, i) => [
				`user:${i}`,
				{ eligible: true, ownerUserId: `owner-${i}` },
			]),
		);
		principals.set("api:duplicate", { eligible: true, ownerUserId: "owner-0" });
		const result = await service["userDeletionEvents"](principals);
		expect(result.get("owner-0")).toEqual(new Date("2025-01-01T00:00:00Z"));
		expect(result.size).toBe(2);
		expect(execute).toHaveBeenCalledTimes(2);
		const first = execute.mock.calls[0]?.[0];
		expect(first).toMatchObject({
			source: "posthog",
			personPolicy: "all_events",
		});
		expect(first).toHaveProperty(
			"query",
			expect.stringContaining("min(timestamp)"),
		);
		expect(first).toHaveProperty(
			"query",
			expect.stringContaining("and distinct_id in ('owner-0',"),
		);
		expect(first).toHaveProperty(
			"query",
			expect.not.stringContaining("timestamp >="),
		);
		expect(execute.mock.calls[1]?.[0]).toHaveProperty(
			"query",
			expect.stringContaining("in ('owner-1000')"),
		);
	});

	it("escapes owners and rejects responses outside the requested set", async () => {
		const execute = spyOn(
			MarketingClient.prototype,
			"execute",
		).mockResolvedValue({ columns: [], rows: [["unexpected", "2026-01-01"]] });
		await expect(
			service["userDeletionEvents"](
				new Map([["user:1", { eligible: true, ownerUserId: "a\\b'c" }]]),
			),
		).rejects.toThrow("unexpected owners");
		expect(execute.mock.calls[0]?.[0]).toHaveProperty(
			"query",
			expect.stringContaining("'a\\\\b''c'"),
		);
	});

	it("propagates a failed lookup instead of treating it as no deletions", async () => {
		spyOn(MarketingClient.prototype, "execute").mockRejectedValue(
			new Error("lookup failed"),
		);
		await expect(
			service["userDeletionEvents"](
				new Map([["user:1", { eligible: true, ownerUserId: "owner-1" }]]),
			),
		).rejects.toThrow("lookup failed");
	});
});

describe("product attribution export", () => {
	it.each([0, 1, 1_000, 2_001, 49_288])(
		"returns every field in order for %i rows with one request",
		async (count) => {
			const source = Array.from({ length: count }, (_, index) =>
				attributionRow(index, count),
			);
			const request = mock(
				async (input: string | URL | Request, init?: RequestInit) => {
					expect(String(input)).toBe(
						"https://metabase.example.test/api/dataset/json",
					);
					const body = JSON.parse(String(init?.body));
					expect(body.format_rows).toBe(false);
					expect(body.query.database).toBe(166);
					expect(body.query.native.query).not.toMatch(/offset/i);
					return Response.json(source);
				},
			);
			globalThis.fetch = request as unknown as typeof fetch;
			const result = await service["attributionRows"](client, ["2026-03"]);
			expect(result).toEqual({
				complete: true,
				sourceRows: count,
				rows: source.map((row) => ({
					period: "2026-03",
					organizationId: row.organizationId,
					activityDate: row.activity_date,
					userId: row.user_id,
					apiKeyId: row.api_key_id,
					generations: row.generations,
					accruedValueUsd: row.accrued_value_usd,
					lastActivityAt: new Date(row.last_activity_at),
				})),
			});
			expect(request).toHaveBeenCalledTimes(1);
		},
	);

	it("rejects a truncated export instead of publishing a partial population", async () => {
		globalThis.fetch = mock(async () =>
			Response.json(
				Array.from({ length: 2_000 }, (_, i) => attributionRow(i, 49_288)),
			),
		) as unknown as typeof fetch;
		await expect(
			service["attributionRows"](client, ["2026-03"]),
		).rejects.toThrow("incomplete");
	});

	it.each([undefined, "invalid", 1.5, -1])(
		"rejects an invalid source count %s",
		async (count) => {
			globalThis.fetch = mock(async () =>
				Response.json([{ ...attributionRow(0, 1), source_row_count: count }]),
			) as unknown as typeof fetch;
			await expect(
				service["attributionRows"](client, ["2026-03"]),
			).rejects.toThrow("incomplete");
		},
	);

	it("rejects inconsistent source counts", async () => {
		globalThis.fetch = mock(async () =>
			Response.json([attributionRow(0, 2), attributionRow(1, 3)]),
		) as unknown as typeof fetch;
		await expect(
			service["attributionRows"](client, ["2026-03"]),
		).rejects.toThrow("incomplete");
	});

	it.each([{ error: "query failed" }, [null], [[1, 2]]])(
		"rejects malformed exports",
		async (body) => {
			globalThis.fetch = mock(async () =>
				Response.json(body),
			) as unknown as typeof fetch;
			await expect(
				service["attributionRows"](client, ["2026-03"]),
			).rejects.toThrow("did not return rows");
		},
	);

	it("propagates rate limits without starting another export", async () => {
		const request = mock(
			async () => new Response("rate limited", { status: 429 }),
		);
		globalThis.fetch = request as unknown as typeof fetch;
		await expect(
			service["attributionRows"](client, ["2026-03"]),
		).rejects.toThrow("429");
		expect(request).toHaveBeenCalledTimes(1);
	});
});
