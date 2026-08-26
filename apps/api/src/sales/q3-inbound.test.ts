import { describe, expect, test } from "bun:test";
import { validQ3InboundAuthorization } from "./q3-inbound.auth";
import { q3InboundImport } from "./q3-inbound.contracts";

const valid = {
	quarterStart: "2026-07-01T00:00:00.000Z",
	dataThrough: "2026-07-13T00:00:00.000Z",
	sourceItemCount: 3,
	rows: [
		{
			weekStart: "2026-07-01T00:00:00.000Z",
			periodEnd: "2026-07-06T00:00:00.000Z",
			enterpriseInbound: 1,
		},
		{
			weekStart: "2026-07-06T00:00:00.000Z",
			periodEnd: "2026-07-13T00:00:00.000Z",
			enterpriseInbound: 2,
		},
	],
};

describe("Q3 inbound evidence", () => {
	test("accepts a contiguous reconciled UTC snapshot", () => {
		expect(q3InboundImport.parse(valid)).toEqual(valid);
	});

	test("rejects a gap and a count mismatch", () => {
		expect(() =>
			q3InboundImport.parse({
				...valid,
				sourceItemCount: 4,
				rows: [
					valid.rows[0],
					{
						...valid.rows[1],
						weekStart: "2026-07-07T00:00:00.000Z",
					},
				],
			}),
		).toThrow();
	});

	test("accepts only the dedicated bearer secret", () => {
		const secret = "a".repeat(32);
		expect(validQ3InboundAuthorization(secret, `Bearer ${secret}`)).toBe(true);
		expect(validQ3InboundAuthorization(secret, "Bearer invalid")).toBe(false);
		expect(validQ3InboundAuthorization(secret, undefined)).toBe(false);
	});
});
