import { describe, expect, test } from "bun:test";
import { MetricReadinessStatus } from "@crm/db";
import {
	ALL_HANDS_DASHBOARD_CONFIGURATION,
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

describe("All Hands dashboard configuration", () => {
	test("uses the current channel-partner questions", () => {
		const revenueTab = ALL_HANDS_DASHBOARD_CONFIGURATION.tabs.find(
			(tab) => tab.name === "Revenue by business line",
		);

		expect(revenueTab?.questionNumbers).toContain(197);
		expect(revenueTab?.questionNumbers).toContain(198);
		expect(revenueTab?.questionNumbers).toContain(199);
		expect(revenueTab?.questionNumbers).not.toContain(182);
	});

	test("contains only explicit verified question references", () => {
		const questionNumbers = ALL_HANDS_DASHBOARD_CONFIGURATION.tabs.flatMap(
			(tab) => tab.questionNumbers,
		);

		expect(questionNumbers.length).toBeGreaterThan(0);
		expect(questionNumbers.every((number) => number > 0)).toBe(true);
	});
});
