import { describe, expect, test } from "bun:test";
import {
	buildTeamRequest,
	isAtlasFollowup,
	isManualMissing,
	type QbrMetric,
	teamForOwner,
} from "./qbr-review-logic";

const suppliedAndMissing = {
	label: "Active teams",
	definition: "Quarter average of active teams.",
	unit: "count",
	notApplicable: false,
	automated: false,
	question: { number: 422, url: "https://atlas.pr.sync.so/questions/422" },
	preparation: {
		manualAsk: "Return the Q3 count with source evidence.",
		dataLocation: "Product generation ledger.",
	},
	observations: {
		"2026-08": {
			value: 12,
			status: "provisional",
			evidenceSource: {
				label: "Atlas",
				url: "https://atlas.pr.sync.so/questions/422",
			},
			asOf: "2026-09-01T00:00:00.000Z",
			dataThrough: null,
		},
	},
} as unknown as QbrMetric;

describe("QBR review drafts", () => {
	test("groups by outline owner and keeps unknown owners unassigned", () => {
		expect(teamForOwner("Noah (tentative)")).toBe("Product");
		expect(teamForOwner("Sanjit")).toBe("Sales and Customer Success");
		expect(teamForOwner("New owner")).toBe("Unassigned");
	});

	test("keeps monthly evidence in verification and requests manual metrics without a quarter result", () => {
		const draft = buildTeamRequest(
			"Product",
			[["active_teams", suppliedAndMissing]],
			"https://atlas.pr.sync.so/qbr?team=product",
		);
		expect(draft).toContain("Hi Product team,");
		expect(draft).toContain("Please verify these supplied observations:");
		expect(draft).toContain("2026-08: 12 count, provisional");
		expect(draft).toContain(
			"the Q3 aggregate is missing; current monthly observations are 2026-08: 12 count (provisional)",
		);
		expect(draft).toContain(
			"Manual ask: Return the Q3 count with source evidence.",
		);
		expect(draft).not.toContain("Hi Tanmay");
	});

	test("routes automated non-cohort gaps to Atlas and leaves observed cohorts review-only", () => {
		const automatedMonthly = { ...suppliedAndMissing, automated: true };
		const cohort = {
			...automatedMonthly,
			observations: {
				"2026-09": {
					...suppliedAndMissing.observations["2026-08"],
					cohortMonth: "2026-07",
				},
			},
		} as QbrMetric;
		const draft = buildTeamRequest(
			"Product",
			[
				["automated_monthly", automatedMonthly as QbrMetric],
				["mature_cohort", cohort],
			],
			"https://atlas.pr.sync.so/qbr?team=product",
		);
		expect(isAtlasFollowup(automatedMonthly as QbrMetric)).toBe(true);
		expect(isManualMissing(automatedMonthly as QbrMetric)).toBe(false);
		expect(draft).toContain("Atlas follow-up (Nacho)");
		expect(draft).toContain("automated_monthly");
		expect(draft).not.toContain("Manual ask: Return the Q3 count");
		expect(isAtlasFollowup(cohort)).toBe(false);
		expect(isManualMissing(cohort)).toBe(false);
		expect(draft).toContain("2026-09 (cohort 2026-07)");
		expect(draft).not.toContain("mature_cohort): the Q3 aggregate is missing");
	});
});
