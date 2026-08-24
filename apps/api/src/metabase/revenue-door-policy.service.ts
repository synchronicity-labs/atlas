import { createHash } from "node:crypto";
import {
	type Db,
	RevenueDoor,
	RevenueDoorMatchKind,
	RevenueDoorPolicyStatus,
} from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

const POLICY_ID = "company-revenue-doors";
const USAGE_TABLE = "sync_prod.sync_usage3";
const SUBSCRIPTION_TABLE = "sync_prod.sync_stripe_subscriptions_with_plan";
const RAW_SUBSCRIPTION_TABLE = "sync_prod.sync_stripe_subscriptions";
const ORGANIZATION_TABLES = [
	"sync_prod.sync_stripe_invoice_items",
	"sync_prod.sync_stripe_invoices",
	"sync_prod.sync_stripe_invoices_paid",
	"sync_prod.sync_stripe_invoices_pipe",
	"sync_prod.sync_stripe_payments",
	"sync_prod.sync_stripe_subscription_cancellations",
] as const;

export type RevenueDoorPolicyEvidence = {
	policyId: string;
	status: RevenueDoorPolicyStatus;
	applied: boolean;
	complete: boolean;
	matchMode: "EXCLUDE_NON_TOOLS" | "INCLUDE_PARTNERS" | "INCLUDE_ENTERPRISE";
	door: RevenueDoor;
	ruleCount: number;
	excludedPlans: string[];
	excludedDomains: string[];
	excludedOrganizationIds: string[];
	includedPlans: string[];
	includedDomains: string[];
	includedOrganizationIds: string[];
	includedOrganizationLabels: Array<{
		organizationId: string;
		label: string;
	}>;
	unresolvedDomains: string[];
	contentHash: string;
};

type ResolvedRevenueDoorPolicy = Omit<RevenueDoorPolicyEvidence, "applied">;

export function usesRevenueDoorPolicy(questionNumber: number): boolean {
	return questionNumber >= 1101 && questionNumber <= 1125;
}

export function usesSubscribedRevenueEligibility(
	questionNumber: number,
	questionName = "",
	queryText = "",
): boolean {
	if (questionNumber === 1003 || questionNumber === 1004) {
		return false;
	}
	if (
		(questionNumber >= 1001 && questionNumber <= 1014) ||
		usesRevenueDoorPolicy(questionNumber)
	) {
		return true;
	}
	const metricText = `${questionName}\n${queryText}`.toLowerCase();
	if (/free\s*(?:&|and)\s*paid|paid\s*(?:&|and)\s*free/.test(metricText)) {
		return false;
	}
	return [
		/paid[_\s-]*(?:org|organization|customer|team)/,
		/subscription/,
		/invoice/,
		/cash[_\s-]*(?:collected|collection|ltv|revenue)/,
		/revenue/,
		/run[_\s-]*rate/,
		/\bndr\b/,
		/gross[_\s-]*logo[_\s-]*retention/,
		/contribution[_\s-]*margin/,
	].some((pattern) => pattern.test(metricText));
}

export function usesPartnerRevenueDoorPolicy(questionNumber: number): boolean {
	return questionNumber >= 1112 && questionNumber <= 1116;
}

export function usesEnterpriseRevenueDoorPolicy(
	questionNumber: number,
): boolean {
	return questionNumber >= 1119 && questionNumber <= 1122;
}

export function assertResolvedAtlasQuery(
	questionNumber: number,
	queryText: string,
): void {
	const unresolvedTemplates = [
		...new Set(queryText.match(/__ATLAS_[A-Z0-9_]+__/g) ?? []),
	];
	if (unresolvedTemplates.length === 0) return;
	throw new Error(
		`Question ${questionNumber} has an unresolved Atlas query template: ${unresolvedTemplates.join(", ")}.`,
	);
}

@Injectable()
export class RevenueDoorPolicyService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async compile(queryText: string): Promise<{
		queryText: string;
		evidence: RevenueDoorPolicyEvidence;
	}> {
		const policy = await this.current();
		const compiled = applyRevenueDoorPolicy(queryText, policy);
		return {
			queryText: compiled.queryText,
			evidence: { ...policy, applied: compiled.applied },
		};
	}

	async compileForQuestion(
		questionNumber: number,
		queryText: string,
	): Promise<{
		queryText: string;
		evidence: RevenueDoorPolicyEvidence;
	}> {
		const compiled = usesPartnerRevenueDoorPolicy(questionNumber)
			? this.compilePartners(queryText)
			: usesEnterpriseRevenueDoorPolicy(questionNumber)
				? this.compileEnterprise(queryText)
				: this.compile(queryText);
		const result = await compiled;
		assertResolvedAtlasQuery(questionNumber, result.queryText);
		return result;
	}

	async compilePartners(queryText: string): Promise<{
		queryText: string;
		evidence: RevenueDoorPolicyEvidence;
	}> {
		const policy = await this.partners();
		const compiled = applyPartnerRevenueDoorPolicy(queryText, policy);
		return {
			queryText: compiled.queryText,
			evidence: { ...policy, applied: compiled.applied },
		};
	}

	async compileEnterprise(queryText: string): Promise<{
		queryText: string;
		evidence: RevenueDoorPolicyEvidence;
	}> {
		const policy = await this.enterprise();
		const compiled = applyEnterpriseRevenueDoorPolicy(queryText, policy);
		return {
			queryText: compiled.queryText,
			evidence: { ...policy, applied: compiled.applied },
		};
	}

	async current(): Promise<ResolvedRevenueDoorPolicy> {
		return this.resolve("EXCLUDE_NON_TOOLS");
	}

	async partners(): Promise<ResolvedRevenueDoorPolicy> {
		return this.resolve("INCLUDE_PARTNERS");
	}

	async enterprise(): Promise<ResolvedRevenueDoorPolicy> {
		const [enterprise, partners] = await Promise.all([
			this.resolve("INCLUDE_ENTERPRISE"),
			this.resolve("INCLUDE_PARTNERS"),
		]);
		const summary = {
			...enterprise,
			complete: enterprise.complete && partners.complete,
			ruleCount: enterprise.ruleCount + partners.ruleCount,
			excludedDomains: partners.includedDomains,
			excludedOrganizationIds: partners.includedOrganizationIds,
			unresolvedDomains: sortedUnique([
				...enterprise.unresolvedDomains,
				...partners.unresolvedDomains,
			]),
		};
		return {
			...summary,
			contentHash: createHash("sha256")
				.update(JSON.stringify({ ...summary, contentHash: undefined }))
				.digest("hex"),
		};
	}

	private async resolve(
		matchMode: "EXCLUDE_NON_TOOLS" | "INCLUDE_PARTNERS" | "INCLUDE_ENTERPRISE",
	): Promise<ResolvedRevenueDoorPolicy> {
		const policy = await this.db.revenueDoorPolicy.findUniqueOrThrow({
			where: { id: POLICY_ID },
			include: {
				rules: {
					where: { active: true },
					orderBy: [{ matchKind: "asc" }, { matchValue: "asc" }],
				},
			},
		});
		const rules = policy.rules.filter((rule) => {
			if (matchMode === "INCLUDE_PARTNERS") {
				return rule.door === RevenueDoor.PARTNERS;
			}
			if (matchMode === "INCLUDE_ENTERPRISE") {
				return rule.door === RevenueDoor.ENTERPRISE;
			}
			return rule.door !== RevenueDoor.TOOLS;
		});
		const plans = sortedUnique(
			rules
				.filter((rule) => rule.matchKind === RevenueDoorMatchKind.PLAN)
				.map((rule) => normalize(rule.matchValue)),
		);
		const domains = sortedUnique(
			rules
				.filter((rule) => rule.matchKind === RevenueDoorMatchKind.EMAIL_DOMAIN)
				.map((rule) => normalize(rule.matchValue)),
		);
		const directOrganizationIds = rules
			.filter((rule) => rule.matchKind === RevenueDoorMatchKind.ORGANIZATION_ID)
			.map((rule) => rule.matchValue.trim());
		const stripeCustomerIds = rules
			.filter(
				(rule) => rule.matchKind === RevenueDoorMatchKind.STRIPE_CUSTOMER_ID,
			)
			.map((rule) => rule.matchValue.trim());
		const organizationSelect = {
			externalId: true,
			domain: true,
			memberships: {
				select: { productUser: { select: { email: true } } },
			},
		} as const;
		const planOrganizations = plans.length
			? await this.db.productOrganization.findMany({
					where: {
						OR: plans.map((plan) => ({
							plan: { equals: plan, mode: "insensitive" },
						})),
					},
					select: organizationSelect,
				})
			: [];
		const domainMatches = await Promise.all(
			domains.map(async (domain) => ({
				domain,
				organizations: await this.db.productOrganization.findMany({
					where: {
						OR: [
							{ domain: { equals: domain, mode: "insensitive" } },
							{
								memberships: {
									some: {
										productUser: {
											email: {
												endsWith: `@${domain}`,
												mode: "insensitive",
											},
										},
									},
								},
							},
						],
					},
					select: organizationSelect,
				}),
			})),
		);
		const customerOrganizations = stripeCustomerIds.length
			? await this.db.productOrganization.findMany({
					where: { stripeCustomerId: { in: stripeCustomerIds } },
					select: organizationSelect,
				})
			: [];
		const organizationIds = sortedUnique([
			...directOrganizationIds,
			...planOrganizations.map((organization) => organization.externalId),
			...customerOrganizations.map((organization) => organization.externalId),
			...domainMatches.flatMap((match) =>
				match.organizations.map((organization) => organization.externalId),
			),
		]);
		const unresolvedDomains = domainMatches
			.filter((match) => match.organizations.length === 0)
			.map((match) => match.domain);
		const labels = new Map<string, string>();
		for (const match of domainMatches) {
			for (const organization of match.organizations) {
				labels.set(organization.externalId, match.domain);
			}
		}
		for (const organization of [
			...planOrganizations,
			...customerOrganizations,
		]) {
			if (!labels.has(organization.externalId)) {
				labels.set(organization.externalId, organizationLabel(organization));
			}
		}
		for (const rule of rules.filter(
			(rule) => rule.matchKind === RevenueDoorMatchKind.ORGANIZATION_ID,
		)) {
			labels.set(rule.matchValue.trim(), rule.label ?? rule.matchValue.trim());
		}
		const includedOrganizationLabels = organizationIds.map(
			(organizationId) => ({
				organizationId,
				label: labels.get(organizationId) ?? "Other partner",
			}),
		);
		const isIncludePolicy = matchMode !== "EXCLUDE_NON_TOOLS";
		const summary = {
			policyId: policy.id,
			status: policy.status,
			matchMode,
			door:
				matchMode === "INCLUDE_PARTNERS"
					? RevenueDoor.PARTNERS
					: matchMode === "INCLUDE_ENTERPRISE"
						? RevenueDoor.ENTERPRISE
						: RevenueDoor.TOOLS,
			complete:
				policy.status === RevenueDoorPolicyStatus.COMPLETE &&
				unresolvedDomains.length === 0,
			ruleCount: rules.length,
			excludedPlans: isIncludePolicy ? [] : plans,
			excludedDomains: isIncludePolicy ? [] : domains,
			excludedOrganizationIds: isIncludePolicy ? [] : organizationIds,
			includedPlans: isIncludePolicy ? plans : [],
			includedDomains: isIncludePolicy ? domains : [],
			includedOrganizationIds: isIncludePolicy ? organizationIds : [],
			includedOrganizationLabels: isIncludePolicy
				? includedOrganizationLabels
				: [],
			unresolvedDomains,
		};

		return {
			...summary,
			contentHash: createHash("sha256")
				.update(JSON.stringify(summary))
				.digest("hex"),
		};
	}
}

export function applyEnterpriseRevenueDoorPolicy(
	queryText: string,
	policy: ResolvedRevenueDoorPolicy,
): { queryText: string; applied: boolean } {
	const usage = wrapTable(
		queryText,
		USAGE_TABLE,
		[
			enterpriseCombinedPredicate(
				"lower(coalesce(\"organizationPlanType\", ''))",
				'"organizationId"',
				policy,
			),
			hasSubscriptionHistoryPredicate('"organizationId"'),
		].join(" and "),
	);
	const subscriptions = wrapTable(
		usage.queryText,
		SUBSCRIPTION_TABLE,
		enterpriseCombinedPredicate(
			"lower(coalesce(plan, ''))",
			'"organizationId"',
			policy,
		),
	);
	const rawSubscriptions = wrapTable(
		subscriptions.queryText,
		RAW_SUBSCRIPTION_TABLE,
		enterpriseCombinedPredicate(
			"lower(coalesce(orgPlan, ''))",
			'"organizationId"',
			policy,
		),
	);
	let governed = rawSubscriptions.queryText;
	let applied =
		usage.applied || subscriptions.applied || rawSubscriptions.applied;
	for (const table of ORGANIZATION_TABLES) {
		const result = wrapTable(
			governed,
			table,
			enterpriseOrganizationPredicate('"organizationId"', policy),
		);
		governed = result.queryText;
		applied ||= result.applied;
	}
	return { queryText: governed, applied };
}

export function applyPartnerRevenueDoorPolicy(
	queryText: string,
	policy: ResolvedRevenueDoorPolicy,
): { queryText: string; applied: boolean } {
	const usage = wrapTable(
		queryText,
		USAGE_TABLE,
		[
			partnerCombinedPredicate(
				"lower(coalesce(\"organizationPlanType\", ''))",
				'"organizationId"',
				policy,
			),
			hasSubscriptionHistoryPredicate('"organizationId"'),
		].join(" and "),
	);
	const subscriptions = wrapTable(
		usage.queryText,
		SUBSCRIPTION_TABLE,
		partnerCombinedPredicate(
			"lower(coalesce(plan, ''))",
			'"organizationId"',
			policy,
		),
	);
	const rawSubscriptions = wrapTable(
		subscriptions.queryText,
		RAW_SUBSCRIPTION_TABLE,
		partnerCombinedPredicate(
			"lower(coalesce(orgPlan, ''))",
			'"organizationId"',
			policy,
		),
	);
	let governed = rawSubscriptions.queryText;
	let applied =
		usage.applied || subscriptions.applied || rawSubscriptions.applied;
	for (const table of ORGANIZATION_TABLES) {
		const result = wrapTable(
			governed,
			table,
			partnerOrganizationPredicate('"organizationId"', policy),
		);
		governed = result.queryText;
		applied ||= result.applied;
	}
	return {
		queryText: governed
			.replaceAll(
				"__ATLAS_PARTNER_LABEL__",
				partnerLabelExpression('"organizationId"', policy),
			)
			.replaceAll(
				"__ATLAS_PARTNER_USAGE_COLUMNS__",
				partnerUsageColumns(policy),
			),
		applied,
	};
}

export function applyRevenueDoorPolicy(
	queryText: string,
	policy: ResolvedRevenueDoorPolicy,
): { queryText: string; applied: boolean } {
	const usage = wrapTable(
		queryText,
		USAGE_TABLE,
		[
			combinedPredicate(
				"lower(coalesce(\"organizationPlanType\", ''))",
				'"organizationId"',
				policy,
			),
			hasSubscriptionHistoryPredicate('"organizationId"'),
		].join(" and "),
	);
	const subscriptions = wrapTable(
		usage.queryText,
		SUBSCRIPTION_TABLE,
		combinedPredicate("lower(coalesce(plan, ''))", '"organizationId"', policy),
	);
	const rawSubscriptions = wrapTable(
		subscriptions.queryText,
		RAW_SUBSCRIPTION_TABLE,
		combinedPredicate(
			"lower(coalesce(orgPlan, ''))",
			'"organizationId"',
			policy,
		),
	);
	let governed = rawSubscriptions.queryText;
	let applied =
		usage.applied || subscriptions.applied || rawSubscriptions.applied;
	for (const table of ORGANIZATION_TABLES) {
		const result = wrapTable(
			governed,
			table,
			organizationPredicate('"organizationId"', policy),
		);
		governed = result.queryText;
		applied ||= result.applied;
	}
	return {
		queryText: governed,
		applied,
	};
}

function combinedPredicate(
	planColumn: string,
	organizationColumn: string,
	policy: ResolvedRevenueDoorPolicy,
): string {
	const predicates = [];
	if (policy.excludedPlans.length > 0) {
		predicates.push(
			`${planColumn} not in (${policy.excludedPlans.map(sqlString).join(", ")})`,
		);
	}
	if (policy.excludedOrganizationIds.length > 0) {
		predicates.push(
			`${organizationColumn} not in (${policy.excludedOrganizationIds
				.map(sqlString)
				.join(", ")})`,
		);
	}
	return predicates.length > 0 ? predicates.join(" and ") : "1 = 1";
}

function organizationPredicate(
	organizationColumn: string,
	policy: ResolvedRevenueDoorPolicy,
): string {
	if (policy.excludedOrganizationIds.length === 0) return "1 = 1";
	return `${organizationColumn} not in (${policy.excludedOrganizationIds
		.map(sqlString)
		.join(", ")})`;
}

function hasSubscriptionHistoryPredicate(organizationColumn: string): string {
	return `${organizationColumn} in (select distinct "organizationId" from ${SUBSCRIPTION_TABLE} where "organizationId" is not null and "organizationId" != '')`;
}

function partnerCombinedPredicate(
	planColumn: string,
	organizationColumn: string,
	policy: ResolvedRevenueDoorPolicy,
): string {
	const predicates = [];
	if (policy.includedPlans.length > 0) {
		predicates.push(
			`${planColumn} in (${policy.includedPlans.map(sqlString).join(", ")})`,
		);
	}
	if (policy.includedOrganizationIds.length > 0) {
		predicates.push(
			`${organizationColumn} in (${policy.includedOrganizationIds
				.map(sqlString)
				.join(", ")})`,
		);
	}
	return predicates.length > 0 ? `(${predicates.join(" or ")})` : "0 = 1";
}

function partnerOrganizationPredicate(
	organizationColumn: string,
	policy: ResolvedRevenueDoorPolicy,
): string {
	if (policy.includedOrganizationIds.length === 0) return "0 = 1";
	return `${organizationColumn} in (${policy.includedOrganizationIds
		.map(sqlString)
		.join(", ")})`;
}

function enterpriseCombinedPredicate(
	planColumn: string,
	organizationColumn: string,
	policy: ResolvedRevenueDoorPolicy,
): string {
	const inclusions = [];
	if (policy.includedPlans.length > 0) {
		inclusions.push(
			`${planColumn} in (${policy.includedPlans.map(sqlString).join(", ")})`,
		);
	}
	if (policy.includedOrganizationIds.length > 0) {
		inclusions.push(
			`${organizationColumn} in (${policy.includedOrganizationIds
				.map(sqlString)
				.join(", ")})`,
		);
	}
	const inclusion =
		inclusions.length > 0 ? `(${inclusions.join(" or ")})` : "0 = 1";
	if (policy.excludedOrganizationIds.length === 0) return inclusion;
	return `${inclusion} and ${organizationColumn} not in (${policy.excludedOrganizationIds
		.map(sqlString)
		.join(", ")})`;
}

function enterpriseOrganizationPredicate(
	organizationColumn: string,
	policy: ResolvedRevenueDoorPolicy,
): string {
	if (policy.includedOrganizationIds.length === 0) return "0 = 1";
	const inclusion = `${organizationColumn} in (${policy.includedOrganizationIds
		.map(sqlString)
		.join(", ")})`;
	if (policy.excludedOrganizationIds.length === 0) return inclusion;
	return `${inclusion} and ${organizationColumn} not in (${policy.excludedOrganizationIds
		.map(sqlString)
		.join(", ")})`;
}

function partnerLabelExpression(
	organizationColumn: string,
	policy: ResolvedRevenueDoorPolicy,
): string {
	const branches = policy.includedOrganizationLabels.flatMap((entry) => [
		`${organizationColumn} = ${sqlString(entry.organizationId)}`,
		sqlString(entry.label),
	]);
	return branches.length > 0
		? `multiIf(${branches.join(", ")}, 'Other partner')`
		: "'Other partner'";
}

function partnerUsageColumns(policy: ResolvedRevenueDoorPolicy): string {
	const labels = sortedUnique(
		policy.includedOrganizationLabels
			.map((entry) => entry.label)
			.filter((label) => label !== "Other partner"),
	);
	const columns = labels.map(
		(label) =>
			`sumIf(partner_usage.usage_accrual, partner_usage.partner = ${sqlString(label)}) as ${sqlIdentifier(label)}`,
	);
	columns.push(
		"sumIf(partner_usage.usage_accrual, partner_usage.partner = 'Other partner') as other_partner",
	);
	return columns.join(",\n  ");
}

function wrapTable(queryText: string, table: string, predicate: string) {
	const pattern = new RegExp(
		`\\b${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
		"gi",
	);
	let applied = false;
	const next = queryText.replace(pattern, (match) => {
		applied = true;
		return `(select * from ${match} where ${predicate})`;
	});
	return { queryText: next, applied };
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort();
}

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function sqlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function sqlIdentifier(value: string): string {
	const identifier = value
		.normalize("NFKD")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toLowerCase();
	return identifier || "partner";
}

function organizationLabel(organization: {
	domain: string | null;
	memberships: Array<{ productUser: { email: string | null } }>;
}): string {
	if (organization.domain) return normalize(organization.domain);
	for (const membership of organization.memberships) {
		const domain = membership.productUser.email?.split("@")[1];
		if (domain) return normalize(domain);
	}
	return "Other partner";
}
