import { describe, expect, test } from "bun:test";
import { summarizeQbrReadiness } from "./qbr-readiness";

describe("QBR readiness", () => {
	test("is ready only when every card is verified and every source is healthy", () => {
		expect(
			summarizeQbrReadiness(
				[
					{ snapshot: { rows: [[1]] }, verification: { status: "VERIFIED" } },
					{ snapshot: { rows: [[2]] }, verification: { status: "VERIFIED" } },
				],
				[
					{ label: "Stripe", state: "HEALTHY" },
					{ label: "TinyBird", state: "HEALTHY" },
				],
			),
		).toEqual({
			status: "READY",
			verifiedCards: 2,
			blockedCards: 0,
			attentionSources: [],
		});
	});

	test("blocks stale sources even when saved cards are verified", () => {
		expect(
			summarizeQbrReadiness(
				[{ snapshot: { rows: [[1]] }, verification: { status: "VERIFIED" } }],
				[{ label: "GA4", state: "ERROR" }],
			),
		).toMatchObject({
			status: "BLOCKED",
			verifiedCards: 1,
			blockedCards: 0,
			attentionSources: ["GA4"],
		});
	});

	test("blocks cards without a verified snapshot", () => {
		expect(
			summarizeQbrReadiness(
				[
					{ snapshot: { rows: [[1]] }, verification: { status: "VERIFIED" } },
					{ snapshot: null, verification: null },
				],
				[],
			),
		).toMatchObject({
			status: "BLOCKED",
			verifiedCards: 1,
			blockedCards: 1,
		});
	});

	test("blocks verified snapshots with no rows in the QBR period", () => {
		expect(
			summarizeQbrReadiness(
				[{ snapshot: { rows: [] }, verification: { status: "VERIFIED" } }],
				[],
			),
		).toMatchObject({
			status: "BLOCKED",
			verifiedCards: 0,
			blockedCards: 1,
		});
	});
});
