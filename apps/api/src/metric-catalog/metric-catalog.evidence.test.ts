import { describe, expect, test } from "bun:test";
import {
	catalogCanonicalQuestionNumber,
	catalogEvidenceFor,
} from "./metric-catalog.evidence";

describe("metric catalog evidence", () => {
	test("keeps competing revenue interpretations visible", () => {
		expect(
			catalogEvidenceFor({
				title: "actualized revenue (monthly + YTD)",
				ownerTeam: "sync.",
			}).map((candidate) => candidate.questionNumber),
		).toEqual([1005, 1006, 1102]);
	});

	test("links the conversion inputs and result without approving the metric", () => {
		expect(
			catalogEvidenceFor({
				title: "Visitor to Signup Conversion",
				ownerTeam: "Marketing",
			}).map((candidate) => candidate.questionNumber),
		).toEqual([2006, 2019]);
	});

	test("does not invent evidence for an unsupported metric", () => {
		expect(
			catalogEvidenceFor({ title: "Manual Health Check", ownerTeam: "CS" }),
		).toEqual([]);
	});

	test("selects a canonical question only when the current query matches", () => {
		expect(
			catalogCanonicalQuestionNumber({
				title: "actualized revenue (monthly + YTD)",
				ownerTeam: "sync.",
			}),
		).toBe(1006);
		expect(
			catalogCanonicalQuestionNumber({
				title: "gross margin",
				ownerTeam: "sync.",
			}),
		).toBeNull();
	});
});
