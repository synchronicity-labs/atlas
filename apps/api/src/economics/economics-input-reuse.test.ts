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
	const preview = spyOn(MetabaseClient.prototype, "preview").mockResolvedValue({
		columns: [],
		rows: [["2026-09", "sync-3", 10, 30, 100]],
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

test("normalizes Product model aliases before joining Modal costs", async () => {
	process.env.METABASE_BASE_URL = "https://metabase.example.test";
	process.env.METABASE_API_KEY = "test-only";
	const service = new EconomicsService({} as never, {} as never, {} as never);
	spyOn(MetabaseClient.prototype, "preview").mockResolvedValue({
		columns: [],
		rows: [
			["2026-08", "sync2", 1],
			["2026-08", "sync-2.0-pro", 2],
			["2026-08", "sync3", 3],
		],
	});

	await expect(service["loadOutputMinutes"]()).resolves.toEqual([
		{ month: "2026-08", model: "sync-2", outputMinutes: 1 },
		{ month: "2026-08", model: "sync-2-pro", outputMinutes: 2 },
		{ month: "2026-08", model: "sync-3", outputMinutes: 3 },
	]);
});
