import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { FactGrain } from "@crm/db";
import { GoogleServiceAccountClient } from "@crm/db/google-service-account";
import { inferMetricWindow } from "../metabase/product-metric.publisher";
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
	mock.restore();
});

describe("MarketingClient scoped Google weeks", () => {
	test("requests six complete GA4 months without current-month partials", async () => {
		spyOn(
			GoogleServiceAccountClient.prototype,
			"accessToken",
		).mockResolvedValue("test-only");
		const fetchMock = mock().mockResolvedValue(
			new Response(JSON.stringify({ rows: [] })),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		await new MarketingClient({
			...config,
			ga4: { landing: { id: "123", label: "sync.so" } },
		}).execute({
			source: "ga4",
			properties: ["landing"],
			dateRange: "6_months_and_mtd",
			dimensions: ["yearMonth"],
			metrics: ["sessions"],
			merge: "sum",
			completeMonthsOnly: true,
			limit: 1000,
		});
		const [, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		const now = new Date();
		const start = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 1),
		);
		const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
		expect(JSON.parse(String(init.body)).dateRanges).toEqual([
			{
				startDate: start.toISOString().slice(0, 10),
				endDate: end.toISOString().slice(0, 10),
			},
		]);
	});

	test("preserves the GA4 property time zone and half-open date range", async () => {
		spyOn(
			GoogleServiceAccountClient.prototype,
			"accessToken",
		).mockResolvedValue("test-only");
		const fetchMock = mock().mockResolvedValue(
			new Response(
				JSON.stringify({
					metadata: { timeZone: "America/Los_Angeles" },
					rows: [{ metricValues: [{ value: "42" }] }],
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const result = await new MarketingClient({
			...config,
			ga4: { lipsync: { id: "525331485", label: "lipsync.com" } },
		}).ga4Range(
			{
				source: "ga4",
				properties: ["lipsync"],
				dateRange: "30_days",
				dimensions: [],
				metrics: ["sessions"],
				merge: "rows",
				limit: 1,
			},
			new Date("2026-08-17T00:00:00Z"),
			new Date("2026-08-24T00:00:00Z"),
		);
		expect(result.sourceTimeZone).toBe("America/Los_Angeles");
		expect(result.rows).toEqual([["lipsync.com", 42]]);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toContain("properties/525331485:runReport");
		expect(JSON.parse(String(init.body)).dateRanges).toEqual([
			{ startDate: "2026-08-17", endDate: "2026-08-23" },
		]);
	});
	test("requests finalized ungrouped Search Console totals for the exact week", async () => {
		spyOn(
			GoogleServiceAccountClient.prototype,
			"accessToken",
		).mockResolvedValue("test-only");
		const fetchMock = mock().mockResolvedValue(
			new Response(
				JSON.stringify({
					rows: [
						{ keys: [], clicks: 10, impressions: 100, ctr: 0.1, position: 3 },
					],
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const result = await new MarketingClient({
			...config,
			searchConsole: { lipsync: "sc-domain:lipsync.com" },
		}).searchConsoleRange(
			{
				source: "search_console",
				site: "lipsync",
				dateRange: "30_days",
				dimensions: [],
				aggregate: "none",
				metrics: ["clicks", "impressions", "ctr_pct", "position"],
				limit: 25000,
			},
			new Date("2026-08-17T00:00:00Z"),
			new Date("2026-08-24T00:00:00Z"),
		);
		expect(result.rows).toEqual([[10, 100, 10, 3]]);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toContain("sc-domain%3Alipsync.com");
		expect(JSON.parse(String(init.body))).toMatchObject({
			startDate: "2026-08-17",
			endDate: "2026-08-23",
			dataState: "final",
			dimensions: [],
		});
	});
});

describe("MarketingClient ranged metric completeness", () => {
	test("does not turn a missing Google metric into a reported zero", async () => {
		spyOn(
			GoogleServiceAccountClient.prototype,
			"accessToken",
		).mockResolvedValue("test-only");
		globalThis.fetch = mock().mockResolvedValue(
			new Response(
				JSON.stringify({
					rows: [{ metricValues: [{}] }],
				}),
			),
		) as unknown as typeof fetch;
		const client = new MarketingClient({
			...config,
			ga4: { lipsync: { id: "525331485", label: "lipsync.com" } },
		});
		await expect(
			client.ga4Range(
				{
					source: "ga4",
					properties: ["lipsync"],
					dateRange: "30_days",
					dimensions: [],
					metrics: ["sessions"],
					merge: "rows",
					limit: 1,
				},
				new Date("2026-08-17"),
				new Date("2026-08-24"),
			),
		).rejects.toThrow("incomplete metrics");
	});
	test("does not turn a missing Search Console metric into zero", async () => {
		spyOn(
			GoogleServiceAccountClient.prototype,
			"accessToken",
		).mockResolvedValue("test-only");
		globalThis.fetch = mock().mockResolvedValue(
			new Response(
				JSON.stringify({
					rows: [{ keys: [], clicks: 10, impressions: 100, ctr: 0.1 }],
				}),
			),
		) as unknown as typeof fetch;
		const client = new MarketingClient({
			...config,
			searchConsole: { lipsync: "sc-domain:lipsync.com" },
		});
		await expect(
			client.searchConsoleRange(
				{
					source: "search_console",
					site: "lipsync",
					dateRange: "30_days",
					dimensions: [],
					aggregate: "none",
					metrics: ["clicks", "impressions", "ctr_pct", "position"],
					limit: 1,
				},
				new Date("2026-08-17"),
				new Date("2026-08-24"),
			),
		).rejects.toThrow("incomplete metrics");
	});
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
		const fetchMock = mock().mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						columns: ["day"],
						types: [["day", "DateTime"]],
						results: Array.from({ length: 100 }, (_, index) => [index]),
						hasMore: true,
					}),
					{ status: 200 },
				),
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

	test("normalizes native time-to-convert periods", async () => {
		const fetchMock = mock()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						results: {
							average_conversion_time: 600,
							median_conversion_time: 480,
							bins: [
								[100, 8],
								[200, 2],
							],
						},
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						results: {
							average_conversion_time: 540,
							median_conversion_time: 420,
							bins: [[100, 12]],
						},
					}),
				),
			);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await new MarketingClient(config, 0).execute({
			source: "posthog_insight",
			mode: "funnel_time_to_convert",
			grain: "week",
			periods: 2,
			query: {
				kind: "InsightVizNode",
				source: { kind: "FunnelsQuery", filterTestAccounts: true },
			},
		});

		expect(result.rows.map((row) => row.slice(1, 4))).toEqual([
			[480, 600, 10],
			[420, 540, 12],
		]);
		expectMetricWindow(result, FactGrain.WEEK);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const firstBody = JSON.parse(
			String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
		);
		expect(firstBody.query.source.dateRange.explicitDate).toBe(true);
	});

	test("normalizes native signup conversion counts and rate", async () => {
		const fetchMock = mock().mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						results: [
							{ name: "user_signed_up", count: 200 },
							{ name: "subscription_created", count: 25 },
						],
					}),
				),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await new MarketingClient(config, 0).execute({
			source: "posthog_insight",
			mode: "funnel_conversion",
			grain: "month",
			periods: 2,
			query: {
				kind: "InsightVizNode",
				source: { kind: "FunnelsQuery", filterTestAccounts: true },
			},
		});

		expect(result.rows.map((row) => row.slice(1, 4))).toEqual([
			[200, 25, 12.5],
			[200, 25, 12.5],
		]);
		expectMetricWindow(result, FactGrain.MONTH);
	});

	test("publishes only mature native week-two retention cohorts", async () => {
		const fetchMock = mock().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [
						{
							date: "2020-07-27T00:00:00-04:00",
							values: [
								{ label: "Week 0", count: 800 },
								{ label: "Week 1", count: 120 },
								{ label: "Week 2", count: 80 },
							],
						},
						{
							date: "2999-08-17T00:00:00-04:00",
							values: [
								{ label: "Week 0", count: 700 },
								{ label: "Week 1", count: 100 },
								{ label: "Week 2", count: 0 },
							],
						},
					],
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await new MarketingClient(config, 0).execute({
			source: "posthog_insight",
			mode: "retention_week_two",
			grain: "week",
			periods: 6,
			query: {
				kind: "InsightVizNode",
				source: { kind: "RetentionQuery", filterTestAccounts: true },
			},
		});

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.slice(1, 4)).toEqual([800, 80, 10]);
		expectMetricWindow(result, FactGrain.WEEK);
	});
});

function expectMetricWindow(
	result: Awaited<ReturnType<MarketingClient["execute"]>>,
	grain: FactGrain,
) {
	const window = inferMetricWindow(result, grain, new Date());
	expect(window.dataThrough.getTime()).toBeLessThanOrEqual(
		window.periodEnd.getTime(),
	);
}
