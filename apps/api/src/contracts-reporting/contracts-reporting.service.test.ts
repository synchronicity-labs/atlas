import { describe, expect, it } from "bun:test";
import { VerificationStatus } from "@crm/db";
import { enterpriseContractValueVerificationChecks } from "./contracts-reporting.service";

describe("enterprise contract value verification", () => {
	it("passes when the USD total and coverage are present", () => {
		const checks = enterpriseContractValueVerificationChecks({
			columns: [],
			rows: [["2026-09-01", 120_000, 3, 1, 2, 1, 7, "2026-09-03"]],
		});
		expect(checks.map((check) => check.status)).toEqual([
			VerificationStatus.PASSED,
			VerificationStatus.PASSED,
		]);
	});

	it("fails when the governed total is missing", () => {
		const checks = enterpriseContractValueVerificationChecks({
			columns: [],
			rows: [],
		});
		expect(checks[0]?.status).toBe(VerificationStatus.FAILED);
	});
});
