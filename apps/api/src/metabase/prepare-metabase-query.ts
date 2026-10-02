import {
	isQbrEnterpriseUsageRetentionQuestion,
	isQbrPlgQuestion,
} from "../atlas-query/qbr/queries";
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
import { boundRevenueUsage } from "./revenue-usage-bounds";
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
	revenueDoorPolicy: Pick<
		RevenueDoorPolicyService,
		"compileEnterprise" | "compileForQuestion"
	> &
		Partial<Pick<RevenueDoorPolicyService, "compile">>,
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
	const qbrEnterpriseUsageRetention = isQbrEnterpriseUsageRetentionQuestion(
		question.sourceExternalId,
	);
	if (
		prepared.language === "SQL" &&
		question.databaseExternalId === "166" &&
		!qbrEnterpriseUsageRetention
	) {
		prepared.queryText = boundRevenueUsage(question.number, prepared.queryText);
	}
	const qbrPlg = isQbrPlgQuestion(question.sourceExternalId);
	const revenueDoor =
		qbrPlg && prepared.language === "SQL"
			? await revenueDoorPolicy.compile?.(prepared.queryText)
			: qbrEnterpriseUsageRetention && prepared.language === "SQL"
				? await revenueDoorPolicy.compileEnterprise(prepared.queryText)
				: prepared.language === "SQL" && usesRevenueDoorPolicy(question.number)
					? await revenueDoorPolicy.compileForQuestion(
							question.number,
							prepared.queryText,
						)
					: null;
	if (
		qbrPlg &&
		(!revenueDoor?.evidence.applied || !revenueDoor.evidence.complete)
	) {
		throw new Error("QBR PLG requires a complete applied revenue-door policy.");
	}
	if (
		qbrEnterpriseUsageRetention &&
		(!revenueDoor?.evidence.applied || !revenueDoor.evidence.complete)
	) {
		throw new Error(
			"QBR Enterprise usage retention requires a complete applied Enterprise revenue-door policy.",
		);
	}
	const classifiedQueryText = revenueDoor?.queryText ?? prepared.queryText;
	let governed: GovernedTinybirdQuery | null = null;
	if (
		prepared.language === "SQL" &&
		["34", "166"].includes(question.databaseExternalId ?? "") &&
		!abuseUsesAllIdentities(question.sourceExternalId)
	) {
		const snapshot = qbrPlg
			? await eligibility.currentForPaidActivity()
			: qbrEnterpriseUsageRetention
				? await eligibility.currentForRevenue()
				: usesSubscribedRevenueEligibility(
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
