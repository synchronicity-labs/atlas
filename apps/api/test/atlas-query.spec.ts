import { describe, expect, test } from "bun:test";
import { MetricTrustStatus, SourceStatus } from "@crm/db";
import {
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
			}),
		).toEqual({
			status: "pending",
			reason: "Metric verification is not complete.",
		});
	});

	test("reports verified governed snapshots as fresh", () => {
		expect(
			resolveMetricFreshness({
				hasResult: true,
				historical: false,
				trustStatus: MetricTrustStatus.VERIFIED,
			}),
		).toEqual({ status: "fresh", reason: null });
	});
});
