import { describe, expect, test } from "bun:test";
import {
	AVERAGE_TEAM_METRIC_IDS,
	formatNorthStarValue,
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
});
