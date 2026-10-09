import {
	isQbrEnterpriseUsageRetentionQuestion,
	isQbrPaidAccountQuestion,
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
	governExplicitSubscriptionQuery,
	hasSubscribedPopulation,
	type TinybirdEligibilityService,
} from "./tinybird-eligibility.service";

export type MetabaseQuestionContext = {
	number: number;
	name: string;
	sourceExternalId: string | null;
	databaseExternalId: string | null;
};

function dedupeWeeklyRevenueStripePayments(
	question: MetabaseQuestionContext,
	language: "SQL" | "MBQL" | "API",
	queryText: string,
): string {
	if (
		language !== "SQL" ||
		question.databaseExternalId !== "166" ||
		!question.sourceExternalId?.startsWith("weekly-revenue:")
	) {
		return queryText;
	}
	return queryText.replace(
		/\bsync_prod\.sync_stripe_payments\b/gi,
		`(
  select
    stripe_payment_source.id as id,
    any(stripe_payment_source.payload) as payload,
    any(stripe_payment_source.eventType) as eventType,
    any(stripe_payment_source."organizationId") as "organizationId",
    any(stripe_payment_source.customerId) as customerId,
    any(stripe_payment_source.source) as source,
    any(stripe_payment_source.amount) as amount,
    any(stripe_payment_source.currency) as currency,
    any(stripe_payment_source.credits) as credits,
    any(stripe_payment_source.status) as status,
    any(stripe_payment_source."billingVersion") as "billingVersion",
    any(stripe_payment_source.orgPlan) as orgPlan,
    any(stripe_payment_source."createdAt") as "createdAt"
  from sync_prod.sync_stripe_payments as stripe_payment_source
  group by stripe_payment_source.id
  having throwIf(
    isNull(stripe_payment_source.id) or trimBoth(stripe_payment_source.id) = '' or uniqExact(tuple(
      stripe_payment_source.eventType,
      stripe_payment_source."organizationId",
      stripe_payment_source.customerId,
      stripe_payment_source.source,
      stripe_payment_source.amount,
      stripe_payment_source.currency,
      stripe_payment_source.credits,
      stripe_payment_source.status,
      stripe_payment_source."billingVersion",
      stripe_payment_source.orgPlan,
      stripe_payment_source."createdAt"
    )) != 1,
    'Weekly revenue has a missing or conflicting Stripe payment ID'
  ) = 0
)`,
	);
}

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
	prepared.queryText = dedupeWeeklyRevenueStripePayments(
		question,
		prepared.language,
		prepared.queryText,
	);
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
		if (isQbrPaidAccountQuestion(question.sourceExternalId)) {
			governed = governExplicitSubscriptionQuery(classifiedQueryText);
		} else {
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
		}
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
