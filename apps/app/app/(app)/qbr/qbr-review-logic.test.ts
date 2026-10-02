import { describe, expect, test } from "bun:test";
import {
	buildTeamRequest,
	hasReviewedObservations,
	isAtlasFollowup,
	isManualMissing,
	needsObservationReview,
	observationReviewLabel,
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
				label:
					"Atlas governed source query; current-clean history; source-close verification pending",
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
		expect(draft).toContain("Quarter average of active teams.");
		expect(draft).toContain(
			"2026-08: 12 count, Atlas query result · provisional",
		);
		expect(draft).toContain(
			"The Q3 aggregate is missing; current monthly observations are 2026-08: 12 count (provisional)",
		);
		expect(draft).toContain(
			"Manual ask: Return the Q3 count with source evidence.",
		);
		expect(draft).not.toContain("Hi Tanmay");
	});

	test("labels reviewed evidence distinctly and never requests it again", () => {
		const verifiedObservation = {
			...suppliedAndMissing.observations["2026-08"],
			status: "verified",
			sourceQueryHash: "query-current",
			dataThrough: "2026-09-30T23:59:59.000Z",
			verification: {
				verifiedBy: "Source reviewer",
				verifiedAt: "2026-10-02T15:00:00.000Z",
				reviewedSnapshotId: "snapshot-current",
				reviewedQueryHash: "query-current",
				definition: {
					label: "Definition",
					url: "https://example.com/definition",
				},
				population: {
					label: "Population",
					url: "https://example.com/population",
				},
				coverage: { label: "Coverage", url: "https://example.com/coverage" },
				reconciliation: {
					label: "Reconciliation",
					url: "https://example.com/reconciliation",
				},
			},
		};
		const reviewedMetric = {
			...suppliedAndMissing,
			observations: { "2026-Q3": verifiedObservation },
		} as unknown as QbrMetric;
		expect(
			observationReviewLabel(
				verifiedObservation as QbrMetric["observations"][string],
			),
		).toBe("Reviewed source · verified");
		expect(hasReviewedObservations(reviewedMetric)).toBe(true);
		expect(needsObservationReview(reviewedMetric)).toBe(false);
		const reviewedDraft = buildTeamRequest(
			"Product",
			[["active_teams", reviewedMetric]],
			"https://atlas.pr.sync.so/qbr?team=product",
		);
		expect(reviewedDraft).not.toContain(
			"Please verify these supplied observations:",
		);
		expect(reviewedDraft).not.toContain("active_teams");
		const unprovenMetric = {
			...reviewedMetric,
			observations: {
				"2026-Q3": { ...verifiedObservation, verification: undefined },
			},
		} as unknown as QbrMetric;
		expect(observationReviewLabel(unprovenMetric.observations["2026-Q3"])).toBe(
			"Verified status · review evidence incomplete",
		);
		expect(needsObservationReview(unprovenMetric)).toBe(true);
		const staleReview = {
			...verifiedObservation,
			sourceQueryHash: "query-updated",
		};
		expect(observationReviewLabel(staleReview)).toBe(
			"Verified status · review evidence incomplete",
		);
		expect(
			hasReviewedObservations({
				...reviewedMetric,
				observations: { "2026-Q3": staleReview },
			} as QbrMetric),
		).toBe(false);
		const incompleteProof = {
			...verifiedObservation,
			verification: {
				...verifiedObservation.verification,
				coverage: undefined,
			},
		};
		expect(observationReviewLabel(incompleteProof)).toBe(
			"Verified status · review evidence incomplete",
		);
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
