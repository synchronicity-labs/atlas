import { describe, expect, it } from "bun:test";
import { contractsReportingQuery } from "./contracts-reporting.contracts";

describe("contractsReportingQuery", () => {
	it("accepts the governed contract reports", () => {
		for (const report of [
			"action-summary",
			"price-mismatches",
			"contract-account-gaps",
			"product-account-gaps",
			"open-findings",
			"ingestion-health",
			"customer-coverage",
			"enterprise-contract-value",
			"enterprise-contract-commitments",
		] as const) {
			expect(
				contractsReportingQuery.parse({
					source: "atlas_contracts",
					report,
					definitionVersion: "contract-reconciliation-v1",
				}).report,
			).toBe(report);
		}
	});

	it("rejects an unknown report", () => {
		expect(() =>
			contractsReportingQuery.parse({
				source: "atlas_contracts",
				report: "raw-contract-text",
				definitionVersion: "contract-reconciliation-v1",
			}),
		).toThrow();
	});
});
