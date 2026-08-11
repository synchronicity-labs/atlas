import { describe, expect, test } from "bun:test";
import {
	assertMetricContract,
	commonDataThrough,
	rollingWindow,
	stableMetricContractHash,
	utcMonthWindow,
} from "../src";

const contract = {
	key: "product.professional_orgs",
	name: "Monthly professional organizations",
	ownerTeam: "Product",
	businessDefinition: { entity: "organization", boundary: "UTC" },
	normalizationPolicy: { eligibility: "current_non_abuse" },
	computation: { aggregate: "count_distinct" },
	verificationPolicy: { tolerance: 0 },
	cadence: { everyMinutes: 60 },
	inputs: [
		{
			alias: "organization_month",
			datasetKey: "tinybird.organization_month",
			queryLanguage: "SQL" as const,
			queryText: "select organization_id from organization_month",
			expectedGrain: "MONTH" as const,
			maxLagSeconds: 3600,
			required: true,
		},
	],
};

describe("metric contracts", () => {
	test("uses exact UTC calendar month boundaries", () => {
		const window = utcMonthWindow("2026-08");
		expect(window.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
		expect(window.end.toISOString()).toBe("2026-09-01T00:00:00.000Z");
	});

	test("anchors rolling windows to the shared data-through time", () => {
		const window = rollingWindow(
			new Date("2026-08-11T14:00:00.000Z"),
			28 * 24 * 60 * 60 * 1000,
		);
		expect(window.start.toISOString()).toBe("2026-07-14T14:00:00.000Z");
		expect(window.end.toISOString()).toBe("2026-08-11T14:00:00.000Z");
	});

	test("uses the oldest complete source watermark", () => {
		expect(
			commonDataThrough([
				{
					datasetKey: "usage",
					dataThrough: new Date("2026-08-11T14:00:00.000Z"),
					complete: true,
				},
				{
					datasetKey: "billing",
					dataThrough: new Date("2026-08-11T13:00:00.000Z"),
					complete: true,
				},
			]).toISOString(),
		).toBe("2026-08-11T13:00:00.000Z");
	});

	test("hashes a valid contract deterministically", () => {
		assertMetricContract(contract);
		expect(stableMetricContractHash(contract)).toBe(
			stableMetricContractHash({ ...contract }),
		);
	});
});
