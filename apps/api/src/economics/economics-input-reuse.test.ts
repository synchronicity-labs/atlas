import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { MetabaseClient } from "../metabase/metabase.client";
import { economicsQuery } from "./economics.contracts";
import {
	ECONOMICS_OUTPUT_MINUTES_QUERY,
	EconomicsService,
	economicsResult,
} from "./economics.service";

const previousUrl = process.env.METABASE_BASE_URL;
const previousKey = process.env.METABASE_API_KEY;
afterEach(() => {
	mock.restore();
	if (previousUrl === undefined) delete process.env.METABASE_BASE_URL;
	else process.env.METABASE_BASE_URL = previousUrl;
	if (previousKey === undefined) delete process.env.METABASE_API_KEY;
	else process.env.METABASE_API_KEY = previousKey;
});

test("one refresh shares identical inputs without mixing custom SQL or retaining stale data", async () => {
	process.env.METABASE_BASE_URL = "https://metabase.example.test";
	process.env.METABASE_API_KEY = "test-only";
	const modalRows = [{ month: "2026-09", model: "sync-3", costUsd: 5 }];
	const warehouseRows = [
		{
			month: "2026-09",
			model: "sync-3",
			freeFrames: 10,
			paidFrames: 30,
			usageRevenueUsd: 100,
		},
	];
	const findFirst = mock(async () => ({
		capturedAt: new Date(),
		rows: [["2026-09", "sync-3", 5]],
	}));
	const service = new EconomicsService(
		{
			syncCursor: { findFirst: mock(async () => null) },
			resultSnapshot: { findFirst },
		} as never,
		{
			govern: (queryText: string) => ({ queryText }),
		} as never,
		{} as never,
	);
	const preview = spyOn(MetabaseClient.prototype, "preview")
		.mockResolvedValueOnce({
			columns: [],
			rows: [["2026-09", "sync-3", 10, 30, 100]],
		})
		.mockResolvedValue({
			columns: [],
			rows: [["2026-09", "sync-3", 15000, 30, 100]],
		});
	const inputs = new Map();
	for (const report of economicsQuery.shape.report.options) {
		const query = economicsQuery.parse({
			source: "atlas_economics",
			definitionVersion: "inference-economics-v1",
			report,
		});
		const outputMinutesRows =
			report === "cost-per-minute"
				? [{ month: "2026-09", model: "sync-3", outputMinutes: 10 }]
				: [];
		expect(await service["execute"](query, {} as never, inputs)).toEqual(
			economicsResult(query, warehouseRows, modalRows, outputMinutesRows),
		);
	}
	expect(preview).toHaveBeenCalledTimes(2);
	expect(preview.mock.calls[1]?.[0]).toMatchObject({
		databaseExternalId: "34",
		queryText: ECONOMICS_OUTPUT_MINUTES_QUERY,
	});
	expect(ECONOMICS_OUTPUT_MINUTES_QUERY).toContain(
		"sum(g.output_media_length * 25) as output_frames_25fps",
	);
	expect(findFirst).toHaveBeenCalledTimes(1);
	const query = economicsQuery.parse({
		source: "atlas_economics",
		definitionVersion: "inference-economics-v1",
		report: "usage-revenue",
	});
	await service["execute"](
		{ ...query, warehouseSql: "select 1" },
		{} as never,
		inputs,
	);
	expect(preview).toHaveBeenCalledTimes(3);
	await service["execute"](query, {} as never);
	expect(preview).toHaveBeenCalledTimes(4);
});

test("cost per minute reports matched and estimated model coverage", () => {
	const query = economicsQuery.parse({
		source: "atlas_economics",
		definitionVersion: "inference-economics-v1",
		report: "cost-per-minute",
		months: 2,
	});
	const result = economicsResult(
		query,
		[
			{
				month: "2026-08",
				model: "sync-3",
				freeFrames: 100,
				paidFrames: 0,
				usageRevenueUsd: 0,
			},
			{
				month: "2026-09",
				model: "sync-3",
				freeFrames: 100,
				paidFrames: 0,
				usageRevenueUsd: 0,
			},
		],
		[{ month: "2026-08", model: "sync-3", costUsd: 1 }],
		[
			{ month: "2026-08", model: "sync-3", outputMinutes: 2 },
			{ month: "2026-09", model: "sync-3", outputMinutes: 2 },
		],
	);
	expect(result.rows).toEqual([
		["2026-08-01T00:00:00.000Z", "sync-3", 1, 2, 0.5, "matched"],
		["2026-09-01T00:00:00.000Z", "sync-3", null, 2, 0.5, "estimated"],
	]);
});

test("cost per minute keeps monthly Modal costs available across Q2 and Q3", () => {
	const query = economicsQuery.parse({
		source: "atlas_economics",
		definitionVersion: "inference-economics-v1",
		report: "cost-per-minute",
		months: 7,
	});
	const months = [
		"2026-04",
		"2026-05",
		"2026-06",
		"2026-07",
		"2026-08",
		"2026-09",
	];
	const result = economicsResult(
		query,
		months.map((period) => ({
			month: period,
			model: "sync-3",
			freeFrames: 0,
			paidFrames: 0,
			usageRevenueUsd: 0,
		})),
		months.map((period) => ({ month: period, model: "sync-3", costUsd: 1 })),
		months.map((period) => ({
			month: period,
			model: "sync-3",
			outputMinutes: 2,
		})),
	);

	expect(result.rows).toHaveLength(6);
	expect(result.rows.map((row) => [row[0], row[2], row[5]])).toEqual(
		months.map((period) => [`${period}-01T00:00:00.000Z`, 1, "matched"]),
	);
});

test("accepts the versioned 25 fps cost-per-minute definition", () => {
	const query = economicsQuery.parse({
		source: "atlas_economics",
		definitionVersion: "inference-economics-v2",
		report: "cost-per-minute",
	});

	expect(query.definitionVersion).toBe("inference-economics-v2");
});

test("normalizes Product model aliases before joining Modal costs", async () => {
	process.env.METABASE_BASE_URL = "https://metabase.example.test";
	process.env.METABASE_API_KEY = "test-only";
	const service = new EconomicsService({} as never, {} as never, {} as never);
	spyOn(MetabaseClient.prototype, "preview").mockResolvedValue({
		columns: [],
		rows: [
			["2026-08", "sync2", 1500],
			["2026-08", "sync-2.0-pro", 3000],
			["2026-08", "sync3", 4500],
		],
	});

	await expect(service["loadOutputMinutes"]()).resolves.toEqual([
		{ month: "2026-08", model: "sync-2", outputMinutes: 1 },
		{ month: "2026-08", model: "sync-2-pro", outputMinutes: 2 },
		{ month: "2026-08", model: "sync-3", outputMinutes: 3 },
	]);
});

test("cost per minute does not depend on the eligibility export", async () => {
	process.env.METABASE_BASE_URL = "https://metabase.example.test";
	process.env.METABASE_API_KEY = "test-only";
	const now = new Date();
	const preview = spyOn(MetabaseClient.prototype, "preview").mockResolvedValue({
		columns: [],
		rows: [["2026-09", "sync-3", 1500]],
	});
	const current = mock(async () => {
		throw new Error("Product eligibility export is incomplete.");
	});
	const service = new EconomicsService(
		{
			syncCursor: { findFirst: mock(async () => null) },
			resultSnapshot: {
				findFirst: mock(async () => ({
					capturedAt: now,
					rows: [["2026-09", "sync-3", 5]],
				})),
			},
		} as never,
		{ current, currentForRevenue: current, govern: mock() } as never,
		{} as never,
	);
	const query = economicsQuery.parse({
		source: "atlas_economics",
		definitionVersion: "inference-economics-v2",
		report: "cost-per-minute",
	});

	const result = await service["execute"](query);

	expect(result.rows).toEqual([
		["2026-09-01T00:00:00.000Z", "sync-3", 5, 1, 5, "matched"],
	]);
	expect(current).not.toHaveBeenCalled();
	expect(preview).toHaveBeenCalledTimes(1);
	expect(preview.mock.calls[0]?.[0]).toMatchObject({
		databaseExternalId: "34",
		queryText: ECONOMICS_OUTPUT_MINUTES_QUERY,
	});
});

test("syncDashboard publishes cost per minute when eligibility is incomplete", async () => {
	process.env.METABASE_BASE_URL = "https://metabase.example.test";
	process.env.METABASE_API_KEY = "test-only";
	const costQuery = JSON.stringify({
		source: "atlas_economics",
		definitionVersion: "inference-economics-v2",
		report: "cost-per-minute",
	});
	const blockedQuery = JSON.stringify({
		source: "atlas_economics",
		definitionVersion: "inference-economics-v1",
		report: "usage-revenue",
	});
	const costQuestion = {
		id: "cost",
		number: 5008,
		name: "Cost per 25 fps output minute by model",
		description: "Cost per completed output minute.",
		connector: "ATLAS",
		sourceId: "economics",
		sourceExternalId: "economics:cost-per-minute",
		databaseExternalId: "34",
		metricVersionId: null,
		versions: [
			{
				id: "cost-v2",
				version: 2,
				queryLanguage: "API",
				queryText: costQuery,
			},
		],
	};
	const blockedQuestion = {
		...costQuestion,
		id: "blocked",
		number: 5003,
		name: "Paid usage revenue",
		sourceExternalId: "economics:usage-revenue",
		versions: [
			{
				id: "blocked-v1",
				version: 1,
				queryLanguage: "API",
				queryText: blockedQuery,
			},
		],
	};
	const snapshots: unknown[] = [];
	const sourceUpdates: unknown[] = [];
	const preview = spyOn(MetabaseClient.prototype, "preview").mockResolvedValue({
		columns: [],
		rows: [["2026-09", "sync-3", 1500]],
	});
	const db = {
		dashboard: {
			findUnique: mock(async () => ({
				cards: [{ question: costQuestion }, { question: blockedQuestion }],
			})),
		},
		dataSource: {
			findUnique: mock(async () => ({ id: "economics" })),
			update: mock(async (input: unknown) => {
				sourceUpdates.push(input);
				return {};
			}),
		},
		syncRun: {
			create: mock(async () => ({ id: "run" })),
			update: mock(async () => ({})),
		},
		resultSnapshot: {
			findFirst: mock(async () => ({
				capturedAt: new Date(),
				rows: [["2026-09", "sync-3", 5]],
			})),
			createMany: mock(async (input: unknown) => {
				snapshots.push(input);
				return { count: 1 };
			}),
		},
		syncCursor: { findFirst: mock(async () => null) },
		$transaction: mock(async (operations: Promise<unknown>[]) =>
			Promise.all(operations),
		),
	};
	const currentForRevenue = mock(async () => {
		throw new Error("Product eligibility export is incomplete.");
	});
	const publish = mock(async () => ({}));
	const service = new EconomicsService(
		db as never,
		{ currentForRevenue, govern: mock() } as never,
		{ publish } as never,
	);

	const result = await service.syncDashboard(6);

	expect(result.cardsProcessed).toBe(1);
	expect(result.errors).toEqual([
		{ number: 5003, message: "Product eligibility export is incomplete." },
	]);
	expect(snapshots[0]).toMatchObject({
		data: [
			expect.objectContaining({
				questionExternalId: "economics:cost-per-minute",
			}),
		],
	});
	expect(currentForRevenue).toHaveBeenCalledTimes(1);
	expect(preview).toHaveBeenCalledTimes(1);
	expect(preview.mock.calls[0]?.[0]).toMatchObject({
		databaseExternalId: "34",
	});
	expect(sourceUpdates.at(-1)).toMatchObject({
		data: { state: "ERROR" },
	});
});
