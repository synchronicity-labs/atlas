import { describe, expect, test } from "bun:test";
import { canonicalQuestionReadiness } from "./metric-catalog.readiness";

const certified = {
	status: "ACTIVE" as const,
	purpose: "CERTIFIED" as const,
	metricVersion: {
		approvedAt: new Date("2026-09-01"),
		metric: { status: "CERTIFIED" as const },
		snapshots: [{ trustStatus: "VERIFIED" as const }],
	},
};

describe("canonical question readiness", () => {
	test("uses the canonical question instead of a different linked verified metric", () => {
		expect(
			canonicalQuestionReadiness("VERIFIED", {
				...certified,
				purpose: "RECONCILIATION",
				metricVersion: {
					...certified.metricVersion,
					approvedAt: null,
					snapshots: [{ trustStatus: "PENDING" }],
				},
			}),
		).toBe("RECONCILING");
	});

	test("requires an approved active certified question and a passing snapshot", () => {
		expect(canonicalQuestionReadiness("IMPLEMENTING", certified)).toBe(
			"VERIFIED",
		);
		expect(
			canonicalQuestionReadiness("VERIFIED", {
				...certified,
				metricVersion: {
					...certified.metricVersion,
					snapshots: [{ trustStatus: "FAILED" }],
				},
			}),
		).toBe("RECONCILING");
		expect(
			canonicalQuestionReadiness("VERIFIED", {
				...certified,
				metricVersion: { ...certified.metricVersion, snapshots: [] },
			}),
		).toBe("IMPLEMENTING");
		expect(
			canonicalQuestionReadiness("VERIFIED", {
				...certified,
				metricVersion: null,
			}),
		).toBe("RECONCILING");
	});

	test("preserves explicit owner blocks and catalog-only planning state", () => {
		expect(canonicalQuestionReadiness("BLOCKED", certified)).toBe("BLOCKED");
		expect(canonicalQuestionReadiness("NEEDS_DEFINITION", null)).toBe(
			"NEEDS_DEFINITION",
		);
	});
});
