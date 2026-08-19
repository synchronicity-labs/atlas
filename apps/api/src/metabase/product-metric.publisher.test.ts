import { describe, expect, test } from "bun:test";
import {
	PRODUCT_METRIC_SPECS,
	preferredAtlasQuestionNumber,
	REVENUE_CLOSE_METRIC_SPECS,
	REVENUE_METRIC_SPECS,
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

	test("registers separate self-serve usage, subscription, and combined run-rate metrics", () => {
		const revenueMetrics = REVENUE_METRIC_SPECS.filter((spec) =>
			[1102, 1110, 1111].includes(spec.questionNumber),
		).map((spec) => spec.name);

		expect(revenueMetrics).toEqual([
			"Self-serve combined run-rate",
			"Self-serve usage run-rate",
			"Self-serve subscription run-rate",
		]);
	});

	test("registers every Revenue close question in the governed metric layer", () => {
		expect(
			REVENUE_CLOSE_METRIC_SPECS.map((spec) => spec.questionNumber),
		).toEqual(Array.from({ length: 14 }, (_, index) => 1001 + index));
		expect(preferredAtlasQuestionNumber("revenue:usage-spend-ndr")).toBe(1007);
	});

	test("requires a live saved-question equivalence check", () => {
		const paidCustomerRevenue = REVENUE_CLOSE_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 1004,
		);

		expect(paidCustomerRevenue?.pendingChecks?.[0]?.name).toBe(
			"saved_question_equivalence",
		);
		expect(paidCustomerRevenue?.pendingChecks?.[0]?.reason).toContain(
			"compare the native SQL replacement",
		);
	});

	test("registers the partner usage, invoice, cash, breakdown, and reconciliation metrics", () => {
		const partnerMetrics = REVENUE_METRIC_SPECS.filter((spec) =>
			[1112, 1113, 1114, 1115, 1116].includes(spec.questionNumber),
		).map((spec) => spec.name);

		expect(partnerMetrics).toEqual([
			"Channel-partner usage run-rate",
			"Channel-partner invoices raised",
			"Channel-partner cash collected",
			"Channel-partner usage by partner",
			"Channel-partner revenue reconciliation",
		]);
	});
});
