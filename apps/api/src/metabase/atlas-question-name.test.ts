import { describe, expect, it } from "bun:test";
import { atlasQuestionName } from "./atlas-question-name";

describe("atlasQuestionName", () => {
	it("removes Metabase ordering prefixes", () => {
		expect(atlasQuestionName("16 Capture rate by model and surface")).toBe(
			"Capture rate by model and surface",
		);
		expect(atlasQuestionName("07 Sentiment by model")).toBe(
			"Sentiment by model",
		);
	});

	it("removes source-specific API split labels", () => {
		expect(
			atlasQuestionName("API split - Weekly completion rate by surface"),
		).toBe("Weekly completion rate by surface");
	});

	it("removes catalog ordering prefixes", () => {
		expect(atlasQuestionName("R1 Reactivation funnel by send")).toBe(
			"Reactivation funnel by send",
		);
		expect(atlasQuestionName("R2: Did opening predict coming back?")).toBe(
			"Did opening predict coming back?",
		);
	});

	it("keeps numbers that are part of the metric name", () => {
		expect(atlasQuestionName("2026 Product scoreboard")).toBe(
			"2026 Product scoreboard",
		);
		expect(atlasQuestionName("30d product-led subscription conversion")).toBe(
			"30d product-led subscription conversion",
		);
		expect(atlasQuestionName("R2D2 generation quality")).toBe(
			"R2D2 generation quality",
		);
	});
});
