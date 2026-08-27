import {
	assertReadOnlyQuery,
	bindDefaultMetabaseTemplateVariables,
	boundSensitiveIdentityResult,
} from "../questions/read-only-query";
import { abuseUsesAllIdentities } from "./abuse-detail-verification";
import type { MetabaseClient, MetabasePreviewInput } from "./metabase.client";
import {
	type RevenueDoorPolicyService,
	usesRevenueDoorPolicy,
	usesSubscribedRevenueEligibility,
} from "./revenue-door-policy.service";
import {
	type GovernedTinybirdQuery,
	hasSubscribedPopulation,
	type TinybirdEligibilityService,
} from "./tinybird-eligibility.service";

export type MetabaseQuestionContext = {
	number: number;
	name: string;
	sourceExternalId: string | null;
	databaseExternalId: string | null;
};

export async function prepareGovernedMetabaseQuery(
	question: MetabaseQuestionContext,
	input: Pick<MetabasePreviewInput, "language" | "queryText">,
	client: Pick<MetabaseClient, "preparePreview">,
	eligibility: Pick<
		TinybirdEligibilityService,
		"current" | "currentForRevenue" | "currentForPaidActivity" | "govern"
	>,
	revenueDoorPolicy: Pick<RevenueDoorPolicyService, "compileForQuestion">,
) {
	const prepared = await client.preparePreview({
		...input,
		queryText: bindDefaultMetabaseTemplateVariables(
			input.language,
			input.queryText,
		),
		databaseExternalId: question.databaseExternalId,
	});
	assertReadOnlyQuery(prepared.language, prepared.queryText);
	const revenueDoor =
		prepared.language === "SQL" && usesRevenueDoorPolicy(question.number)
			? await revenueDoorPolicy.compileForQuestion(
					question.number,
					prepared.queryText,
				)
			: null;
	const classifiedQueryText = revenueDoor?.queryText ?? prepared.queryText;
	let governed: GovernedTinybirdQuery | null = null;
	if (
		prepared.language === "SQL" &&
		["34", "166"].includes(question.databaseExternalId ?? "") &&
		!abuseUsesAllIdentities(question.sourceExternalId)
	) {
		const snapshot = usesSubscribedRevenueEligibility(
			question.number,
			question.name,
			classifiedQueryText,
		)
			? await eligibility.currentForRevenue()
			: hasSubscribedPopulation(classifiedQueryText)
				? await eligibility.currentForPaidActivity()
				: await eligibility.current();
		governed = eligibility.govern(
			classifiedQueryText,
			question.databaseExternalId,
			snapshot,
		);
		if (question.databaseExternalId === "34" && !governed.applied) {
			throw new Error(
				"Atlas could not apply the required clean-user filter. The Product query was not executed. Existing results are unchanged.",
			);
		}
	}
	const queryText = boundSensitiveIdentityResult(
		prepared.language,
		governed?.queryText ?? classifiedQueryText,
		question.databaseExternalId,
	);
	assertReadOnlyQuery(prepared.language, queryText);
	return { input: { ...prepared, queryText }, governed, revenueDoor };
}
