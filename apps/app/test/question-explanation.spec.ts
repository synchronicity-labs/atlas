import { describe, expect, test } from "bun:test";
import { definitionRows } from "../lib/question-explanation-language";

describe("question explanation language", () => {
	test("turns the professional contract into a short human explanation", () => {
		const rows = definitionRows({
			entity: "organization_month",
			population: "v2_self_serve",
			professional: {
				minimumAccruedValueUsd: 100,
				minimumCompletedBillableGenerations: 3,
				minimumActiveDays: 2,
				completedStatus: "COMPLETED",
				billableDefinition:
					"generation started while its organization was on a non-free plan",
				sourcePlanSnapshot:
					"Product Generations.organizationPlan is captured when the generation starts; V2 TinyBird organizationPlanType is derived from that admission snapshot",
				activeDayDefinition:
					"a distinct UTC date with a completed generation created on a non-free plan",
			},
			periodAssignment: "generationCreatedAt in UTC",
		});

		expect(rows).toEqual([
			{
				label: "What is counted",
				value: "One organization per UTC month",
			},
			{ label: "Who is included", value: "V2 self-serve plans" },
			{
				label: "Professional organization rule",
				value:
					"at least $100 in accrued value, at least 3 completed billable generations, and activity on at least 2 separate UTC days",
			},
			{
				label: "Assigned to a period by",
				value:
					"The UTC month when the generation started and its plan was recorded",
			},
		]);
	});

	test("does not expose implementation fields as user copy", () => {
		const rows = definitionRows({
			definition: "Internal draft note",
			questionName: "Question",
			questionNumber: 15,
			definitionState: "pending_owner_review",
			completedStatus: "COMPLETED",
			sourcePlanSnapshot: "Product Generations.organizationPlan",
		});

		expect(rows).toEqual([]);
	});

	test("explains finished-generation revenue without database field names", () => {
		expect(
			definitionRows({
				timeField: "generationEndedAt",
				valueBasis: "generationCostMillicents divided by 100000",
			}),
		).toEqual([
			{
				label: "Revenue month",
				value:
					"The UTC month when the generation finished and its final billable cost became known",
			},
			{
				label: "Value counted",
				value:
					"The final generation cost converted from millicents to US dollars",
			},
		]);
	});
});
