import { describe, expect, test } from "bun:test";
import {
	AVERAGE_TEAM_METRIC_IDS,
	formatNorthStarValue,
	groupMissingNorthStarMetrics,
	metricRowLabel,
	metricSectionId,
} from "./north-star-display";

describe("North Star metric display", () => {
	test("labels monthly-average and quarter-end team metrics separately", () => {
		expect(AVERAGE_TEAM_METRIC_IDS).toEqual([
			"company_teams",
			"plg_teams",
			"enterprise_teams",
			"channel_teams",
			"productions_teams",
		]);
		expect(metricRowLabel("enterprise_teams", "Enterprise teams")).toBe(
			"Average monthly · Enterprise teams",
		);
		expect(
			metricRowLabel("enterprise_teams_period_end", "Enterprise teams"),
		).toBe("Quarter end · Enterprise teams");
		expect(metricSectionId("Professional teams")).toBe(
			"north-star-professional-teams",
		);
	});

	test("preserves source precision in evidence values", () => {
		expect(formatNorthStarValue(91.63, "percent", false, true)).toBe("91.63%");
		expect(formatNorthStarValue(542.6666666666666, "count", false, true)).toBe(
			"542.6666666666666",
		);
		expect(formatNorthStarValue(12.345, "months", false, true)).toBe(
			"12.345 months",
		);
		expect(formatNorthStarValue(650614.99, "usd", false, true)).toBe(
			"$650614.99",
		);
		expect(formatNorthStarValue(91.63, "percent", true)).toBe("91.6%");
	});

	test("groups North Star source gaps by evidence need exactly once", () => {
		const metrics = [
			{ id: "productions_revenue" },
			{ id: "productions_booked_revenue" },
			{ id: "productions_teams" },
			{ id: "productions_teams_adds" },
			{ id: "productions_contract_retention" },
			{ id: "productions_top1" },
			{ id: "company_revenue" },
			{ id: "plg_revenue_subscriptions" },
			{ id: "enterprise_revenue" },
			{ id: "channel_revenue" },
			{ id: "company_top1" },
			{ id: "plg_top3" },
			{ id: "enterprise_top10" },
			{ id: "channel_top1" },
			{ id: "plg_active_rate" },
			{ id: "enterprise_contract_retention" },
			{ id: "marketing_visitors" },
		];
		const groups = groupMissingNorthStarMetrics(metrics);
		const assigned = groups.flatMap((group) => group.metrics);

		expect(assigned).toHaveLength(metrics.length);
		expect(new Set(assigned).size).toBe(metrics.length);
		expect(assigned.map(({ id }) => id).sort()).toEqual(
			metrics.map(({ id }) => id).sort(),
		);
		expect(
			groups.find(({ key }) => key === "finance")?.metrics.map(({ id }) => id),
		).toEqual([
			"productions_revenue",
			"company_revenue",
			"plg_revenue_subscriptions",
			"enterprise_revenue",
			"channel_revenue",
		]);
		expect(
			groups
				.find(({ key }) => key === "commercial-records")
				?.metrics.map(({ id }) => id),
		).toEqual([
			"productions_top1",
			"company_top1",
			"plg_top3",
			"enterprise_top10",
			"channel_top1",
			"enterprise_contract_retention",
		]);
		expect(
			groups
				.find(({ key }) => key === "production")
				?.metrics.map(({ id }) => id),
		).toEqual([
			"productions_booked_revenue",
			"productions_teams",
			"productions_teams_adds",
			"productions_contract_retention",
		]);
		expect(groups.find(({ key }) => key === "other")?.metrics).toEqual([
			{ id: "marketing_visitors" },
		]);
	});
});
