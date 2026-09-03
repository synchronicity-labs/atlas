import { describe, expect, test } from "bun:test";
import { type Db, MetricTrustStatus, SourceStatus } from "@crm/db";
import {
	AtlasQueryService,
	metricFreshnessDeadline,
	resolveFreshness,
	resolveMetricFreshness,
} from "../src/atlas-query/atlas-query.service";

describe("Atlas agent query freshness", () => {
	test("reports unavailable without a snapshot", () => {
		expect(resolveFreshness({ hasResult: false, historical: false })).toEqual({
			status: "unavailable",
			reason: "No result snapshot exists.",
		});
	});

	test("keeps explicitly selected snapshots historical", () => {
		expect(
			resolveFreshness({
				hasResult: true,
				historical: true,
				state: SourceStatus.ERROR,
			}),
		).toEqual({ status: "historical", reason: null });
	});

	test("reports current healthy snapshots as fresh", () => {
		expect(
			resolveFreshness({
				hasResult: true,
				historical: false,
				state: SourceStatus.HEALTHY,
				deadline: new Date(Date.now() + 60_000),
			}),
		).toEqual({ status: "fresh", reason: null });
	});

	test("does not publish an unverified metric as fresh", () => {
		expect(
			resolveMetricFreshness({
				hasResult: true,
				historical: false,
				trustStatus: MetricTrustStatus.PENDING,
				state: SourceStatus.HEALTHY,
				deadline: new Date(Date.now() + 60_000),
			}),
		).toEqual({
			status: "pending",
			reason:
				"The result exists, but one or more required checks are still open.",
		});
	});

	test("reports verified governed snapshots as fresh", () => {
		expect(
			resolveMetricFreshness({
				hasResult: true,
				historical: false,
				trustStatus: MetricTrustStatus.VERIFIED,
				state: SourceStatus.HEALTHY,
				deadline: new Date(Date.now() + 60_000),
			}),
		).toEqual({ status: "fresh", reason: null });
	});

	test("does not call a verified metric fresh when its source is failing", () => {
		expect(
			resolveMetricFreshness({
				hasResult: true,
				historical: false,
				trustStatus: MetricTrustStatus.VERIFIED,
				state: SourceStatus.ERROR,
				deadline: new Date(Date.now() + 60_000),
			}),
		).toEqual({
			status: "error",
			reason: "The source sync is failing.",
		});
	});

	test("uses the earlier source or successful metric-check deadline", () => {
		const checkedAt = new Date("2026-08-25T00:00:00.000Z");
		const sourceDeadline = new Date("2026-08-25T12:00:00.000Z");

		expect(
			metricFreshnessDeadline({
				sourceDeadline,
				checkedAt,
				maxLagSeconds: [36_000, 28_800],
			}),
		).toEqual(new Date("2026-08-25T08:00:00.000Z"));
	});

	test("uses the latest successful check with the latest verified snapshot", async () => {
		const checkedAt = new Date(Date.now() - 60_000);
		const computedAt = new Date(checkedAt.getTime() - 86_400_000);
		const deadline = new Date(checkedAt.getTime() + 36_000_000);
		let metricSnapshotWhere: unknown;
		const db = {
			question: {
				findFirst: async () => ({
					number: 7011,
					publicNumber: 243,
					name: "Q3 lifecycle funnel",
					description: null,
					metricVersionId: "metric-v1",
					lastCheckedAt: checkedAt,
					updatedAt: checkedAt,
					versions: [],
					source: {
						state: SourceStatus.HEALTHY,
						freshnessDeadlineAt: new Date(deadline.getTime() + 3_600_000),
					},
					metricVersion: {
						metric: { description: null },
						inputs: [{ required: true, maxLagSeconds: 36_000 }],
					},
				}),
			},
			resultSnapshot: { findFirst: async () => null },
			metricSnapshot: {
				findFirst: async (input: { where: unknown }) => {
					metricSnapshotWhere = input.where;
					return {
						computedAt,
						periodStart: computedAt,
						periodEnd: checkedAt,
						dataThrough: checkedAt,
						trustStatus: MetricTrustStatus.VERIFIED,
						metricRun: { verifications: [] },
					};
				},
			},
		} as unknown as Db;
		const service = new AtlasQueryService(db);
		expect((await service.question(243, {})).freshness).toEqual({
			status: "fresh",
			reason: null,
			checkedAt: checkedAt.toISOString(),
			deadlineAt: deadline.toISOString(),
		});
		expect(metricSnapshotWhere).toEqual(
			expect.objectContaining({ trustStatus: MetricTrustStatus.VERIFIED }),
		);
		expect(
			(await service.question(243, { reportingPeriod: "2026-08" })).freshness,
		).toEqual({
			status: "historical",
			reason: null,
			checkedAt: null,
			deadlineAt: null,
		});
	});
});
