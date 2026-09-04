import { describe, expect, test } from "bun:test";
import type { MetabaseResult } from "../metabase/metabase.client";
import { billingScorecardVerificationChecks } from "./billing-scorecard-verification";

describe("billing scorecard verification", () => {
	test("accepts reconciled summary rows", () => {
		const names = [
			"section",
			"arm",
			"eligible_organizations",
			"paid_converters",
			"subscription_churn_30d_pct",
			"subscription_retention_30d_pct",
			"subscription_churn_60d_pct",
			"subscription_retention_60d_pct",
			"renewal_eligible",
			"renewed",
			"renewal_rate_pct",
			"failed_invoice_count",
			"failed_invoice_amount_usd",
			"data_through",
		];
		const result: MetabaseResult = {
			columns: names.map((name) => ({
				name,
				displayName: name,
				baseType: "type/Decimal",
			})),
			rows: [
				[
					"summary",
					"v2 control",
					100,
					20,
					25,
					75,
					40,
					60,
					10,
					8,
					80,
					1,
					20,
					"2026-09-04T00:00:00.000Z",
				],
				[
					"summary",
					"v3 treatment",
					100,
					30,
					20,
					80,
					30,
					70,
					20,
					10,
					50,
					0,
					0,
					"2026-09-04T00:00:00.000Z",
				],
			],
		};
		const checks = billingScorecardVerificationChecks(result);
		expect(checks.every((check) => check.status === "PASSED")).toBe(true);
	});
});
