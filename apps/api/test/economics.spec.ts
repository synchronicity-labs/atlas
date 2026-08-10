import { describe, expect, test } from "bun:test";
import { buildMonthlyEconomics } from "../src/economics/economics.service";

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
			stagingOtherCostUsd: 40,
			contributionMarginUsd: 400,
			contributionMarginPct: 80,
			estimated: false,
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
		});
	});
});
