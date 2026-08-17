import { describe, expect, test } from "bun:test";
import { MetricReadinessStatus } from "@crm/db";
import {
	preserveMetricReadiness,
	resolveMetricCatalogReadiness,
} from "./metric-catalog.service";

describe("metric catalog readiness", () => {
	test("advances an implementing metric when its first snapshot exists", () => {
		expect(
			preserveMetricReadiness(
				MetricReadinessStatus.IMPLEMENTING,
				MetricReadinessStatus.RECONCILING,
			),
		).toBe(MetricReadinessStatus.RECONCILING);
	});

	test("does not erase completed progress during a catalog refresh", () => {
		expect(
			preserveMetricReadiness(
				MetricReadinessStatus.VERIFIED,
				MetricReadinessStatus.IMPLEMENTING,
			),
		).toBe(MetricReadinessStatus.VERIFIED);
	});

	test("reflects a newer pending snapshot for a governed metric", () => {
		expect(
			resolveMetricCatalogReadiness(
				MetricReadinessStatus.VERIFIED,
				MetricReadinessStatus.RECONCILING,
				true,
			),
		).toBe(MetricReadinessStatus.RECONCILING);
	});

	test("keeps an explicit block until someone resolves it", () => {
		expect(
			preserveMetricReadiness(
				MetricReadinessStatus.BLOCKED,
				MetricReadinessStatus.VERIFIED,
			),
		).toBe(MetricReadinessStatus.BLOCKED);
	});
});
