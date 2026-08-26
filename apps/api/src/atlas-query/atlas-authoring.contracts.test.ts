import { describe, expect, test } from "bun:test";
import { atlasQuestionDraft } from "./atlas-authoring.contracts";

const valid = {
	requestKey: "weekly-product-health",
	name: "Weekly product health",
	businessDefinition: "Weekly active teams with a successful generation.",
	decisionUse: "Product uses this to find activation regressions.",
	ownerTeam: "Product",
	cadence: "weekly" as const,
	dimensions: ["model", "plan"],
	sourceHints: ["Product Postgres"],
	acceptanceChecks: ["Reconcile totals to the generation fact table."],
};

describe("Atlas question draft contract", () => {
	test("accepts a complete methodology request", () => {
		expect(atlasQuestionDraft.parse(valid)).toEqual(valid);
	});

	test("rejects attempts to set certification state", () => {
		expect(() =>
			atlasQuestionDraft.parse({ ...valid, status: "ACTIVE" }),
		).toThrow();
		expect(() =>
			atlasQuestionDraft.parse({ ...valid, purpose: "CERTIFIED" }),
		).toThrow();
	});
});
