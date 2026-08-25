import { describe, expect, test } from "bun:test";
import { MetricTrustStatus, SourceStatus } from "@crm/db";
import {
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
});
