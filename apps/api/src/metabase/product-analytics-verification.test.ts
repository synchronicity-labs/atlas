import { describe, expect, test } from "bun:test";
import type { MetabaseResult } from "./metabase.client";
import {
	attributionOutcomeVerificationChecks,
	cohortOutcomeVerificationChecks,
} from "./product-analytics-verification";

function result(values: Record<string, unknown>): MetabaseResult {
	const entries = Object.entries(values);
	return {
		columns: entries.map(([name]) => ({
			name,
			displayName: name,
			baseType: "type/Decimal",
		})),
		rows: [entries.map(([, value]) => value)],
	};
}

describe("product analytics verification", () => {
	test("accepts a reconciled attribution cell", () => {
		const checks = attributionOutcomeVerificationChecks(
			result({
				first_touch_source: "unknown",
				utm_source: "(none)",
				utm_medium: "(none)",
				campaign: "(none)",
				landing_subdomain: "(none)",
				referring_domain: "(none)",
				first_touch_date: null,
				signups: 10,
				first_generations: 8,
				activated_organizations: 5,
				professional_organizations: 3,
				paid_conversions: 2,
				unknown_attribution_organizations: 10,
				first_generation_pct: 80,
				activation_pct: 50,
				professional_pct: 30,
				paid_conversion_pct: 20,
				unknown_attribution_pct: 100,
				data_through: "2026-09-01T00:00:00.000Z",
			}),
		);
		expect(checks.every((check) => check.status === "PASSED")).toBe(true);
	});

	test("accepts a mature cohort cell", () => {
		const checks = cohortOutcomeVerificationChecks(
			result({
				signup_cohort: "2026-01-01",
				cohort_size: 10,
				first_generation_completion_pct: 80,
				model_workflow_adoption_pct: 50,
				model: "sync-3",
				surface: "app",
				workflow: "(unstamped)",
				w1_generation_retention_pct: 40,
				w2_generation_retention_pct: 30,
				m1_generation_retention_pct: 20,
				m3_generation_retention_pct: 10,
				m1_professional_retention_pct: 20,
				m3_professional_retention_pct: 10,
				professional_qualification_pct: 30,
				paid_conversion_pct: 20,
				mature_w1: 10,
				mature_w2: 10,
				mature_m1: 10,
				mature_m3: 10,
				mature_professional_m1: 10,
				mature_professional_m3: 10,
				data_through: "2026-09-01T00:00:00.000Z",
			}),
		);
		expect(checks.every((check) => check.status === "PASSED")).toBe(true);
	});
});
