import { describe, expect, test } from "bun:test";
import { VerificationStatus } from "@crm/db";
import { comparePaidCustomerRevenue } from "./saved-question-equivalence";

describe("saved-question revenue equivalence", () => {
	test("passes when overlapping monthly totals match within one cent", () => {
		const check = comparePaidCustomerRevenue(
			{
				columns: [column("createdAt"), column("sum")],
				rows: [
					["2026-07-01T00:00:00Z", 733_883.4600000003],
					["2026-06-01T00:00:00Z", 663_061.9399999985],
				],
			},
			{
				columns: [column("month"), column("revenue_usd")],
				rows: [
					["2026-06", 663_061.9399999966],
					["2026-07", 733_883.4599999994],
				],
			},
			1256,
		);

		expect(check.status).toBe(VerificationStatus.PASSED);
		expect(check.reason).toContain("match for 2 months");
	});

	test("fails when a month is missing or differs", () => {
		const check = comparePaidCustomerRevenue(
			{
				columns: [column("createdAt"), column("sum")],
				rows: [["2026-07-01T00:00:00Z", 100]],
			},
			{
				columns: [column("month"), column("revenue_usd")],
				rows: [
					["2026-06", 50],
					["2026-07", 99],
				],
			},
			1256,
		);

		expect(check.status).toBe(VerificationStatus.FAILED);
		expect(check.reason).toContain("differ for 2 of 2");
	});
});

function column(name: string) {
	return { name, displayName: name, baseType: null };
}
