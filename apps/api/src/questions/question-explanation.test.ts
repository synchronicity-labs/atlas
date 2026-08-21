import { describe, expect, test } from "bun:test";
import { questionExplanation } from "./question-explanation";

describe("question explanations", () => {
	test("uses the question description first", () => {
		expect(
			questionExplanation({
				name: "Monthly professional organizations",
				description: "Counts qualified self-serve organizations.",
				metricDescription: "Metric fallback.",
			}),
		).toBe("Counts qualified self-serve organizations.");
	});

	test("falls back through governed metric and catalog descriptions", () => {
		expect(
			questionExplanation({
				name: "Monthly professional organizations",
				metricDescription: "Counts the governed organization cohort.",
				catalogDescription: "Workbook fallback.",
			}),
		).toBe("Counts the governed organization cohort.");

		expect(
			questionExplanation({
				name: "Monthly professional organizations",
				catalogDescription: "Workbook fallback.",
			}),
		).toBe("Workbook fallback.");
	});

	test("turns structured notes into a direct explanation", () => {
		expect(
			questionExplanation({
				name: "Monthly professional organizations",
				description:
					"Type: primary Input: Latest complete month. Description: Counts qualified organizations. Why: This is the product north star.",
			}),
		).toBe(
			"Counts qualified organizations. Why it matters: This is the product north star.",
		);
	});

	test("explains imported questions that have no saved description", () => {
		expect(
			questionExplanation({
				name: "Upvote rate by model and surface (last 90 days)",
			}),
		).toBe(
			"Compares the share of positive ratings across models and product surfaces over the last 90 days.",
		);
	});

	test("always explains questions with no saved description", () => {
		expect(questionExplanation({ name: "Negative generation feedback" })).toBe(
			"Lists generations that received negative feedback so the team can inspect the affected user, model, workflow, and failure context.",
		);
	});

	test("uses a clear governed explanation instead of an internal note", () => {
		expect(
			questionExplanation({
				name: "V2 self-serve - Primary professional orgs",
				description:
					"Type: primary Input: Latest complete month vs previous month. Description: Current V2 self-serve professional orgs. Why: Top-line north-star movement.",
			}),
		).toBe(
			"How many V2 self-serve organizations reached $100+ accrued value and completed 3+ billable generations on 2+ distinct UTC days in a complete month? Why it matters: This is the main measure of qualified self-serve organizations.",
		);
	});

	test("uses $100+ consistently in human-facing explanations", () => {
		expect(
			questionExplanation({
				name: "Paid-qualified professional organizations",
				description:
					"Accrued professional organization-months with at least 100 USD in paid invoices.",
			}),
		).toBe(
			"Accrued professional organization-months with $100+ in paid invoices.",
		);
	});

	test("uses the exact distinct UTC day rule consistently", () => {
		expect(
			questionExplanation({
				name: "Activation threshold",
				description:
					"Three billable generations across at least two distinct days.",
			}),
		).toBe("3+ billable generations across 2+ distinct UTC days.");

		expect(
			questionExplanation({
				name: "Professional threshold",
				description: "$100+ accrued value and two active days.",
			}),
		).toBe("$100+ accrued value and generations on 2+ distinct UTC days.");

		expect(
			questionExplanation({
				name: "Requalification threshold",
				description:
					"$100+ accrued value, three completed billable generations, two active days.",
			}),
		).toBe(
			"$100+ accrued value, 3+ billable generations, generations on 2+ distinct UTC days.",
		);
	});

	test("explains every question on the Revenue close tab", () => {
		const names = [
			"Product accrual run-rate",
			"Paid usage accrual",
			"Licensed subscription base proxy",
			"Paid customer monthly revenue",
			"Stripe paid invoice collections",
			"Stripe paid + open invoice billings",
			"Usage-spend NDR",
			"Product run-rate composition · history + MTD",
			"Revenue reconciliation · history + MTD",
			"Usage-spend NDR · history + MTD",
			"Annualized product run-rate",
			"Paid usage organizations",
			"NDR starting cohort spend",
			"NDR retained cohort spend",
		];

		for (const name of names) {
			expect(questionExplanation({ name })).not.toContain(
				"Open it to see the exact query",
			);
		}
	});

	test("explains every self-serve revenue component", () => {
		const names = [
			"Estimated self-serve month-end revenue",
			"Self-serve revenue history and current-month pace",
			"Self-serve subscription run-rate by billing type and plan",
			"Estimated self-serve V2 usage month-end",
			"Self-serve subscription run-rate",
			"Estimated self-serve V3 top-ups month-end",
			"Estimated self-serve variable revenue month-end",
		];

		for (const name of names) {
			const explanation = questionExplanation({ name });
			expect(explanation).not.toContain(
				"does not have a plain-language definition",
			);
			expect(explanation).toContain("Why it matters:");
		}
	});
});
