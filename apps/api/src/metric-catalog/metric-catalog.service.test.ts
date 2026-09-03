import { describe, expect, test } from "bun:test";
import { MetricReadinessStatus, VisualizationType } from "@crm/db";
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

		const questionNumbers = revenueTab?.cards.map(
			(card) => card.questionNumber,
		);
		expect(questionNumbers).toContain(197);
		expect(questionNumbers).toContain(198);
		expect(questionNumbers).toContain(199);
		expect(questionNumbers).not.toContain(182);
	});

	test("contains only explicit verified question references", () => {
		const questionNumbers = ALL_HANDS_DASHBOARD_CONFIGURATION.tabs.flatMap(
			(tab) => tab.cards.map((card) => card.questionNumber),
		);

		expect(questionNumbers.length).toBeGreaterThan(0);
		expect(questionNumbers.every((number) => number > 0)).toBe(true);
	});

	test("adds Prady's trend, self-serve history, and enterprise value views", () => {
		const executive = ALL_HANDS_DASHBOARD_CONFIGURATION.tabs.find(
			(tab) => tab.name === "Executive pulse",
		);
		const revenue = ALL_HANDS_DASHBOARD_CONFIGURATION.tabs.find(
			(tab) => tab.name === "Revenue by business line",
		);
		expect(
			executive?.cards.filter((card) => card.questionNumber === 13),
		).toEqual([
			{ questionNumber: 13, visualization: null },
			{ questionNumber: 13, visualization: VisualizationType.LINE },
		]);
		expect(revenue?.cards.map((card) => card.questionNumber)).toContain(156);
		expect(revenue?.cards.map((card) => card.questionNumber)).toContain(295);
	});
});
