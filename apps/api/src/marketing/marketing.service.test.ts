import { describe, expect, mock, spyOn, test } from "bun:test";
import type { Db } from "@crm/db";
import type { ProductMetricPublisher } from "../metabase/product-metric.publisher";
import type { TinybirdEligibilityService } from "../metabase/tinybird-eligibility.service";
import type { GbrainEvidenceService } from "./gbrain-evidence.service";
import { MarketingClient } from "./marketing.client";
import {
	groupMarketingQuestionsBySource,
	MarketingService,
	marketingAttemptVerificationRows,
	requiresProductUserEligibility,
} from "./marketing.service";

describe("marketing metric attempts", () => {
	test("records the approved visitor definition and keeps the identity bridge pending", () => {
		const rows = marketingAttemptVerificationRows({
			questionNumber: 2001,
			questionVersion: 2,
			capturedAt: new Date("2026-08-14T12:00:00.000Z"),
			resultPresent: true,
		});

		expect(rows.map((row) => [row.name, row.status])).toEqual([
			["read_only_query", "PASSED"],
			["source_snapshot", "PASSED"],
			["result_non_empty", "PASSED"],
			["approved_cross_property_definition", "PASSED"],
			["cross_site_identity_bridge", "PENDING"],
		]);
	});
});

describe("marketing source runs", () => {
	test("records a timed-out question and still publishes the next question", async () => {
		const publish = mock(async () => undefined);
		const updateRun = mock(async () => ({}));
		const updateSource = mock(async () => ({}));
		const db = {
			dashboard: {
				findUnique: async () => ({
					cards: [1, 2].map((number) => ({
						question: {
							id: String(number),
							number,
							sourceId: "marketing",
							versions: [
								{
									version: 1,
									queryLanguage: "API",
									queryText: JSON.stringify({
										source: "posthog",
										personPolicy: "all_events",
										query: "select 1",
									}),
								},
							],
						},
					})),
				}),
			},
			dataSource: {
				findUnique: async () => ({ id: "marketing", key: "atlas:marketing" }),
				update: updateSource,
			},
			syncRun: { create: async () => ({ id: "run" }), update: updateRun },
			resultSnapshot: { createMany: async () => ({ count: 1 }) },
			$transaction: async (operations: Promise<unknown>[]) =>
				Promise.all(operations),
		} as unknown as Db;
		const execute = spyOn(MarketingClient.prototype, "execute")
			.mockRejectedValueOnce(
				new DOMException("PostHog deadline reached", "TimeoutError"),
			)
			.mockResolvedValueOnce({ columns: [], rows: [[1]] });
		try {
			const service = new MarketingService(
				db,
				{ publish } as unknown as ProductMetricPublisher,
				{} as TinybirdEligibilityService,
				{} as GbrainEvidenceService,
			);
			const result = await service.syncDashboard(3);
			expect(result.cardsProcessed).toBe(1);
			expect(result.snapshotsCreated).toBe(1);
			expect(result.errors).toEqual([
				{ number: 1, message: "PostHog deadline reached" },
			]);
			expect(publish).toHaveBeenCalledTimes(1);
			expect(publish).toHaveBeenCalledWith(
				expect.objectContaining({
					question: expect.objectContaining({ number: 2 }),
				}),
			);
			expect(updateRun).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ status: "FAILED" }),
				}),
			);
			expect(updateSource).toHaveBeenLastCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ state: "ERROR" }),
				}),
			);
		} finally {
			execute.mockRestore();
		}
	});

	test("a targeted refresh never starts an unrelated source", async () => {
		const sourceLookup = mock(async () => null);
		const db = {
			dashboard: {
				findUnique: async () => ({
					cards: [
						{
							question: {
								id: "other",
								number: 241,
								sourceId: "other-source",
								versions: [
									{
										queryLanguage: "API",
										queryText: JSON.stringify({
											source: "api_reliability",
											report: "weekly-performance",
											version: 1,
										}),
									},
								],
							},
						},
					],
				}),
			},
			dataSource: { findUnique: sourceLookup },
		} as unknown as Db;
		const service = new MarketingService(
			db,
			{} as ProductMetricPublisher,
			{} as TinybirdEligibilityService,
			{} as GbrainEvidenceService,
		);
		await expect(service.syncDashboard(1, "target-source")).rejects.toThrow(
			"no marketing questions",
		);
		expect(sourceLookup).not.toHaveBeenCalled();
	});

	test("keeps each configured source in an independent run group", () => {
		const groups = groupMarketingQuestionsBySource([
			{ number: 240, sourceId: "api-operations" },
			{ number: 241, sourceId: "api-operations" },
			{ number: 7014, sourceId: "model-feedback" },
		]);

		expect(
			[...groups].map(([sourceId, questions]) => [
				sourceId,
				questions.map((question) => question.number),
			]),
		).toEqual([
			["api-operations", [240, 241]],
			["model-feedback", [7014]],
		]);
	});

	test("fails closed when a question has no configured source", () => {
		expect(() =>
			groupMarketingQuestionsBySource([{ number: 7014, sourceId: null }]),
		).toThrow("Q7014 has no configured Atlas source");
	});

	test("isolates the provisional conversion query from canonical report refreshes", () => {
		const groups = groupMarketingQuestionsBySource([
			{ number: 2002, sourceId: "atlas-marketing-source" },
			{ number: 2006, sourceId: "atlas-marketing-conversion-rate-source" },
			{ number: 2019, sourceId: "atlas-marketing-conversion-rate-source" },
			{ number: 7003, sourceId: "atlas-marketing-source" },
			{ number: 7100, sourceId: "atlas-lipsync-weekly-source" },
		]);
		expect(groups.get("atlas-marketing-source")?.map((q) => q.number)).toEqual([
			2002, 7003,
		]);
		expect(
			groups
				.get("atlas-marketing-conversion-rate-source")
				?.map((q) => q.number),
		).toEqual([2006, 2019]);
	});

	test("does not gate independent composite sources on product eligibility", () => {
		expect(
			requiresProductUserEligibility({
				source: "model_feedback",
				report: "weekly-coverage",
				version: 1,
			}),
		).toBe(false);
		expect(
			requiresProductUserEligibility({
				source: "posthog",
				personPolicy: "all_events",
				query: "select 1",
			}),
		).toBe(false);
		expect(
			requiresProductUserEligibility({
				source: "posthog",
				personPolicy: "exclude_banned_product_users",
				query: "select 1",
			}),
		).toBe(true);
	});
});
