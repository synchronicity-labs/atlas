import { describe, expect, test } from "bun:test";
import { economicsQuery } from "../src/economics/economics.contracts";
import {
	buildMonthlyEconomics,
	economicsResult,
} from "../src/economics/economics.service";

describe("inference economics", () => {
	test("allocates known model cost by free and paid frame share", () => {
		const rows = buildMonthlyEconomics(
			[
				{
					month: "2026-07",
					model: "sync-3",
					freeFrames: 25,
					paidFrames: 75,
					usageRevenueUsd: 500,
				},
			],
			[
				{ month: "2026-07", model: "sync-3", costUsd: 100 },
				{ month: "2026-07", model: "other", costUsd: 40 },
			],
		);
		expect(rows[0]).toMatchObject({
			freeInferenceCostUsd: 25,
			paidInferenceCostUsd: 75,
			prodInferenceCostUsd: 100,
			totalModalCostUsd: 140,
			stagingOtherCostUsd: null,
			contributionMarginUsd: null,
			contributionMarginPct: null,
			estimated: false,
			costStatus: "incomplete",
			unallocatedModalCostUsd: 40,
		});
	});

	test("estimates older months with the actual per-model cost rate", () => {
		const rows = buildMonthlyEconomics(
			[
				{
					month: "2026-06",
					model: "sync-3",
					freeFrames: 50,
					paidFrames: 50,
					usageRevenueUsd: 300,
				},
				{
					month: "2026-07",
					model: "sync-3",
					freeFrames: 25,
					paidFrames: 75,
					usageRevenueUsd: 500,
				},
			],
			[{ month: "2026-07", model: "sync-3", costUsd: 100 }],
		);
		expect(rows[0]).toMatchObject({
			prodInferenceCostUsd: 100,
			estimated: true,
		});
	});

	test("weights estimation rates across all actual billing months", () => {
		const rows = buildMonthlyEconomics(
			[
				{
					month: "2026-05",
					model: "sync-3",
					freeFrames: 50,
					paidFrames: 50,
					usageRevenueUsd: 400,
				},
				{
					month: "2026-06",
					model: "sync-3",
					freeFrames: 0,
					paidFrames: 100,
					usageRevenueUsd: 500,
				},
				{
					month: "2026-07",
					model: "sync-3",
					freeFrames: 0,
					paidFrames: 300,
					usageRevenueUsd: 900,
				},
			],
			[
				{ month: "2026-06", model: "sync-3", costUsd: 100 },
				{ month: "2026-07", model: "sync-3", costUsd: 600 },
			],
		);
		expect(rows[0]).toMatchObject({
			prodInferenceCostUsd: 175,
			estimated: true,
			costStatus: "estimated",
		});
	});

	test("withholds full inference cost and margin when a model has no cost match", () => {
		const warehouseRows = [
			{
				month: "2026-07",
				model: "sync-3",
				freeFrames: 0,
				paidFrames: 100,
				usageRevenueUsd: 200,
			},
			{
				month: "2026-07",
				model: "react-1",
				freeFrames: 0,
				paidFrames: 20,
				usageRevenueUsd: 20,
			},
			{
				month: "2026-09",
				model: "sync-3",
				freeFrames: 0,
				paidFrames: 100,
				usageRevenueUsd: 200,
			},
			{
				month: "2026-09",
				model: "react-1",
				freeFrames: 0,
				paidFrames: 20,
				usageRevenueUsd: 20,
			},
			{
				month: "2026-09",
				model: "empty-model",
				freeFrames: 0,
				paidFrames: 0,
				usageRevenueUsd: 0,
			},
		];
		const modalRows = [
			{ month: "2026-09", model: "sync-3", costUsd: 50 },
			{ month: "2026-09", model: "other", costUsd: 30 },
			{ month: "2026-09", model: "empty-model", costUsd: 7 },
		];
		const rows = buildMonthlyEconomics(warehouseRows, modalRows);
		expect(rows[0]).toMatchObject({
			prodInferenceCostUsd: 50,
			contributionMarginUsd: null,
			contributionMarginPct: null,
			totalModalCostUsd: null,
			stagingOtherCostUsd: null,
			estimated: true,
			costStatus: "incomplete",
			unpricedModels: ["react-1"],
		});
		expect(rows[1]).toMatchObject({
			prodInferenceCostUsd: 50,
			contributionMarginUsd: null,
			totalModalCostUsd: 87,
			stagingOtherCostUsd: null,
			costStatus: "incomplete",
			unpricedModels: ["react-1"],
			unallocatedModalCostUsd: 37,
		});
		const costQuery = economicsQuery.parse({
			source: "atlas_economics",
			definitionVersion: "inference-economics-v1",
			report: "prod-inference-cost",
		});
		const marginQuery = economicsQuery.parse({
			source: "atlas_economics",
			definitionVersion: "inference-economics-v1",
			report: "margin-pct",
		});
		const historyQuery = economicsQuery.parse({
			source: "atlas_economics",
			definitionVersion: "inference-economics-v1",
			report: "margin-history",
		});
		const spendQuery = economicsQuery.parse({
			source: "atlas_economics",
			definitionVersion: "inference-economics-v1",
			report: "modal-spend",
		});
		const costResult = economicsResult(costQuery, warehouseRows, modalRows);
		const marginResult = economicsResult(marginQuery, warehouseRows, modalRows);
		const historyResult = economicsResult(
			historyQuery,
			warehouseRows,
			modalRows,
		);
		const spendResult = economicsResult(spendQuery, warehouseRows, modalRows);
		expect(costResult.columns.map((item) => item.name)).toEqual([
			"month",
			"prod_inference_cost_usd",
			"cost_status",
		]);
		expect(costResult.rows[0]).toEqual([
			"2026-07-01T00:00:00.000Z",
			null,
			"incomplete",
		]);
		expect(
			costResult.rows[0].filter((cell) => typeof cell === "number"),
		).toEqual([]);
		const completeCost = economicsResult(
			costQuery,
			[
				{
					month: "2026-09",
					model: "sync-3",
					freeFrames: 0,
					paidFrames: 100,
					usageRevenueUsd: 200,
				},
			],
			[{ month: "2026-09", model: "sync-3", costUsd: 50 }],
		);
		expect(completeCost.rows).toEqual([
			["2026-09-01T00:00:00.000Z", 50, "matched"],
		]);
		expect(marginResult.rows[0]).toEqual([
			"2026-07-01T00:00:00.000Z",
			null,
			"incomplete",
		]);
		expect(historyResult.rows[0]).toEqual([
			"2026-07-01T00:00:00.000Z",
			220,
			null,
			50,
			null,
			"incomplete",
		]);
		expect(spendResult.rows).toEqual([
			["2026-07-01T00:00:00.000Z", null],
			["2026-09-01T00:00:00.000Z", 87],
		]);
	});
});
