import { ContractMappingStatus, type Db, IdentityLinkMethod } from "@crm/db";
import { domainFromEmail } from "@crm/db/domain";
import {
	contractCustomerAliases,
	contractDomainMatch,
	contractNameMatch,
	contractSearchTerms,
} from "./contracts-mapping-names";
import { inputJson } from "./customer-source";
import { askTypeSafeChoice } from "./typesafe";

export type ContractOrganizationCandidate = {
	id: string;
	externalId: string;
	name: string | null;
	domain: string | null;
	plan: string | null;
	stripeCustomerId: string | null;
	confidence: number;
	matchedAlias: string;
	method: IdentityLinkMethod;
	signals: Array<{
		kind: "ORGANIZATION_NAME" | "MEMBER_NAME" | "MEMBER_DOMAIN";
		matchedAlias: string;
		value: string;
	}>;
};

export async function suggestContractCustomerMappings(
	db: Db,
	input: {
		contractCustomerId: string;
		folderName: string;
		legalName?: string | null;
	},
): Promise<ContractOrganizationCandidate[]> {
	const aliases = contractCustomerAliases(input.folderName, input.legalName);
	const queryTerms = contractSearchTerms(aliases);
	if (queryTerms.length === 0) return [];

	const memberTerms = [
		...new Set(
			queryTerms.flatMap((term) => [
				term,
				term.toLowerCase().replace(/[^a-z0-9]+/g, ""),
			]),
		),
	].filter((term) => term.length >= 3);
	const organizationSelect = {
		id: true,
		externalId: true,
		name: true,
		domain: true,
		plan: true,
		stripeCustomerId: true,
	} as const;
	const [organizations, memberships] = await Promise.all([
		db.productOrganization.findMany({
			where: {
				OR: queryTerms.map((term) => ({
					name: { contains: term, mode: "insensitive" as const },
				})),
			},
			take: 100,
			select: organizationSelect,
		}),
		db.productOrganizationMembership.findMany({
			where: {
				productUser: {
					OR: memberTerms.flatMap((term) => [
						{ email: { contains: term, mode: "insensitive" as const } },
						{
							displayName: {
								contains: term,
								mode: "insensitive" as const,
							},
						},
					]),
				},
			},
			take: 500,
			select: {
				productOrganization: { select: organizationSelect },
				productUser: { select: { email: true, displayName: true } },
			},
		}),
	]);

	const candidatesById = new Map<string, ContractOrganizationCandidate>();
	const add = (
		organization: (typeof organizations)[number],
		match: { confidence: number; matchedAlias: string },
		method: IdentityLinkMethod,
		signal: ContractOrganizationCandidate["signals"][number],
	) => {
		const existing = candidatesById.get(organization.id);
		const signals = existing
			? [...existing.signals, signal].filter(
					(value, index, all) =>
						all.findIndex(
							(candidate) =>
								candidate.kind === value.kind &&
								candidate.value === value.value,
						) === index,
				)
			: [signal];
		const strongest = Math.max(existing?.confidence ?? 0, match.confidence);
		candidatesById.set(organization.id, {
			...organization,
			confidence:
				signals.length > 1 ? Math.min(0.999, strongest + 0.004) : strongest,
			matchedAlias:
				match.confidence >= (existing?.confidence ?? 0)
					? match.matchedAlias
					: (existing?.matchedAlias ?? match.matchedAlias),
			method:
				method === IdentityLinkMethod.MEMBER_DOMAIN
					? method
					: (existing?.method ?? method),
			signals,
		});
	};

	for (const organization of organizations) {
		const match = contractNameMatch(aliases, organization.name);
		if (!match || !organization.name) continue;
		add(organization, match, IdentityLinkMethod.EXACT_NAME, {
			kind: "ORGANIZATION_NAME",
			matchedAlias: match.matchedAlias,
			value: organization.name,
		});
	}

	for (const membership of memberships) {
		const organization = membership.productOrganization;
		const memberNameMatch = contractNameMatch(
			aliases,
			membership.productUser.displayName,
		);
		if (memberNameMatch && membership.productUser.displayName) {
			add(organization, memberNameMatch, IdentityLinkMethod.EXACT_NAME, {
				kind: "MEMBER_NAME",
				matchedAlias: memberNameMatch.matchedAlias,
				value: membership.productUser.displayName,
			});
		}
		const memberDomain = domainFromEmail(membership.productUser.email);
		const memberDomainMatch = contractDomainMatch(aliases, memberDomain);
		if (memberDomainMatch && memberDomain) {
			add(organization, memberDomainMatch, IdentityLinkMethod.MEMBER_DOMAIN, {
				kind: "MEMBER_DOMAIN",
				matchedAlias: memberDomainMatch.matchedAlias,
				value: memberDomain,
			});
		}
	}

	const candidates = [...candidatesById.values()].sort(
		(left, right) =>
			right.confidence - left.confidence ||
			Number(Boolean(right.stripeCustomerId)) -
				Number(Boolean(left.stripeCustomerId)) ||
			(left.name ?? "").localeCompare(right.name ?? ""),
	);

	const ranked = await rankAmbiguousCandidates(candidates, input);

	if (ranked.length > 0) {
		await db.contractCustomerProductOrganization.createMany({
			data: ranked.map((candidate) => ({
				contractCustomerId: input.contractCustomerId,
				productOrganizationId: candidate.id,
				status: ContractMappingStatus.SUGGESTED,
				method: candidate.method,
				confidence: candidate.confidence,
				evidence: inputJson({
					folderName: input.folderName,
					legalName: input.legalName ?? null,
					matchedAlias: candidate.matchedAlias,
					signals: candidate.signals,
					productOrganizationExternalId: candidate.externalId,
					productOrganizationName: candidate.name,
					stripeCustomerId: candidate.stripeCustomerId,
				}),
			})),
			skipDuplicates: true,
		});
		await Promise.all(
			ranked.map((candidate) =>
				db.contractCustomerProductOrganization.updateMany({
					where: {
						contractCustomerId: input.contractCustomerId,
						productOrganizationId: candidate.id,
						status: ContractMappingStatus.SUGGESTED,
					},
					data: {
						method: candidate.method,
						confidence: candidate.confidence,
						evidence: inputJson({
							folderName: input.folderName,
							legalName: input.legalName ?? null,
							matchedAlias: candidate.matchedAlias,
							signals: candidate.signals,
							productOrganizationExternalId: candidate.externalId,
							productOrganizationName: candidate.name,
							stripeCustomerId: candidate.stripeCustomerId,
						}),
					},
				}),
			),
		);
	}

	return ranked;
}

async function rankAmbiguousCandidates(
	candidates: ContractOrganizationCandidate[],
	input: { folderName: string; legalName?: string | null },
): Promise<ContractOrganizationCandidate[]> {
	if (
		candidates.length < 2 ||
		candidates.some((candidate) => candidate.confidence >= 0.995)
	) {
		return candidates;
	}

	const shortlist = candidates.slice(0, 12);
	const criteria = Object.fromEntries(
		shortlist.map((candidate) => [
			candidate.externalId,
			[
				candidate.name,
				candidate.domain,
				candidate.signals
					.map((signal) => `${signal.kind}: ${signal.value}`)
					.join(", "),
			]
				.filter(Boolean)
				.join("; "),
		]),
	);
	const answer = await askTypeSafeChoice({
		state: {
			contractCustomer: {
				folderName: input.folderName,
				legalName: input.legalName ?? null,
			},
			candidates: shortlist.map((candidate) => ({
				id: candidate.externalId,
				name: candidate.name,
				domain: candidate.domain,
				signals: candidate.signals,
			})),
		},
		instructions:
			"Which candidate product organization best matches this contract customer? Choose the best-supported candidate; do not choose based on a generic or weak partial match.",
		criteria,
	});
	if (
		!answer ||
		!criteria[answer.choice] ||
		(answer.confidence !== null && answer.confidence < 0.6)
	) {
		return candidates;
	}

	const position = shortlist.findIndex(
		(candidate) => candidate.externalId === answer.choice,
	);
	if (position < 1) return candidates;

	const chosen = shortlist[position];
	if (!chosen) return candidates;
	return [
		chosen,
		...shortlist.filter((candidate) => candidate !== chosen),
		...candidates.slice(shortlist.length),
	];
}
