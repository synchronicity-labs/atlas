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
	ruleCount: number;
	excludedPlans: string[];
	excludedDomains: string[];
	excludedOrganizationIds: string[];
	unresolvedDomains: string[];
	contentHash: string;
};

type ResolvedRevenueDoorPolicy = Omit<RevenueDoorPolicyEvidence, "applied">;

export function usesRevenueDoorPolicy(questionNumber: number): boolean {
	return questionNumber >= 1101 && questionNumber <= 1109;
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

	async current(): Promise<ResolvedRevenueDoorPolicy> {
		const policy = await this.db.revenueDoorPolicy.findUniqueOrThrow({
			where: { id: POLICY_ID },
			include: {
				rules: {
					where: { active: true, door: { not: RevenueDoor.TOOLS } },
					orderBy: [{ matchKind: "asc" }, { matchValue: "asc" }],
				},
			},
		});
		const excludedPlans = sortedUnique(
			policy.rules
				.filter((rule) => rule.matchKind === RevenueDoorMatchKind.PLAN)
				.map((rule) => normalize(rule.matchValue)),
		);
		const excludedDomains = sortedUnique(
			policy.rules
				.filter((rule) => rule.matchKind === RevenueDoorMatchKind.EMAIL_DOMAIN)
				.map((rule) => normalize(rule.matchValue)),
		);
		const directOrganizationIds = policy.rules
			.filter((rule) => rule.matchKind === RevenueDoorMatchKind.ORGANIZATION_ID)
			.map((rule) => rule.matchValue.trim());
		const stripeCustomerIds = policy.rules
			.filter(
				(rule) => rule.matchKind === RevenueDoorMatchKind.STRIPE_CUSTOMER_ID,
			)
			.map((rule) => rule.matchValue.trim());
		const planOrganizations = excludedPlans.length
			? await this.db.productOrganization.findMany({
					where: {
						OR: excludedPlans.map((plan) => ({
							plan: { equals: plan, mode: "insensitive" },
						})),
					},
					select: { externalId: true },
				})
			: [];
		const domainMatches = await Promise.all(
			excludedDomains.map(async (domain) => ({
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
					select: { externalId: true },
				}),
			})),
		);
		const customerOrganizations = stripeCustomerIds.length
			? await this.db.productOrganization.findMany({
					where: { stripeCustomerId: { in: stripeCustomerIds } },
					select: { externalId: true },
				})
			: [];
		const excludedOrganizationIds = sortedUnique([
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
		const summary = {
			policyId: policy.id,
			status: policy.status,
			complete:
				policy.status === RevenueDoorPolicyStatus.COMPLETE &&
				unresolvedDomains.length === 0,
			ruleCount: policy.rules.length,
			excludedPlans,
			excludedDomains,
			excludedOrganizationIds,
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

export function applyRevenueDoorPolicy(
	queryText: string,
	policy: ResolvedRevenueDoorPolicy,
): { queryText: string; applied: boolean } {
	const usage = wrapTable(
		queryText,
		USAGE_TABLE,
		combinedPredicate(
			"lower(coalesce(\"organizationPlanType\", ''))",
			'"organizationId"',
			policy,
		),
	);
	const subscriptions = wrapTable(
		usage.queryText,
		SUBSCRIPTION_TABLE,
		combinedPredicate("lower(coalesce(plan, ''))", '"organizationId"', policy),
	);
	let governed = subscriptions.queryText;
	let applied = usage.applied || subscriptions.applied;
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
