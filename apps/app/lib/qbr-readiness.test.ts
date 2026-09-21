import { describe, expect, test } from "bun:test";
import { summarizeQbrReadiness } from "./qbr-readiness";

describe("QBR readiness", () => {
	test("is ready only when every card is verified and every source is healthy", () => {
		expect(
			summarizeQbrReadiness(
				[
					{ snapshot: {}, verification: { status: "VERIFIED" } },
					{ snapshot: {}, verification: { status: "VERIFIED" } },
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
				[{ snapshot: {}, verification: { status: "VERIFIED" } }],
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
					{ snapshot: {}, verification: { status: "VERIFIED" } },
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
});
