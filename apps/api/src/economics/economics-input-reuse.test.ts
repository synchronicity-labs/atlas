import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { MetabaseClient } from "../metabase/metabase.client";
import { economicsQuery } from "./economics.contracts";
import { EconomicsService, economicsResult } from "./economics.service";

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
		expect(await service["execute"](query, {} as never, inputs)).toEqual(
			economicsResult(query, warehouseRows, modalRows),
		);
	}
	expect(preview).toHaveBeenCalledTimes(1);
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
	expect(preview).toHaveBeenCalledTimes(2);
	await service["execute"](query, {} as never);
	expect(preview).toHaveBeenCalledTimes(3);
});
