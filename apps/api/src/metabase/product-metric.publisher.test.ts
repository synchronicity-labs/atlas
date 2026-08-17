import { describe, expect, test } from "bun:test";
import {
	PRODUCT_METRIC_SPECS,
	preferredAtlasQuestionNumber,
} from "./product-metric.publisher";

describe("product feedback metric registry", () => {
	test("maps the existing Metabase feedback cards to their Atlas questions", () => {
		expect(preferredAtlasQuestionNumber("8318")).toBe(42);
		expect(preferredAtlasQuestionNumber("8252")).toBe(39);
	});

	test("computes feedback metrics without silently approving their remaining definition decisions", () => {
		const checks = PRODUCT_METRIC_SPECS.filter((spec) =>
			[39, 42].includes(spec.questionNumber),
		).flatMap((spec) => spec.pendingChecks?.map((check) => check.name) ?? []);

		expect(checks).toEqual([
			"approved_rating_definition",
			"approved_completed_status",
		]);
	});
});
