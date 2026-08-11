import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

export type SearchHit = {
	kind: "company" | "contact" | "deal" | "user";
	id: string;
	label: string;
	detail: string | null;
	iconUrl: string | null;
	iconDarkUrl: string | null;
	iconTone: string | null;
	imageUrl: string | null;
};

const PER_KIND = 5;

@Injectable()
export class SearchService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async quick(q: string): Promise<{ hits: SearchHit[] }> {
		const term = q.trim();
		if (term.length < 2) return { hits: [] };

		const [companies, contacts, deals, productUsers] = await Promise.all([
			this.db.company.findMany({
				where: {
					OR: [
						{ name: { contains: term, mode: "insensitive" } },
						{ domain: { contains: term, mode: "insensitive" } },
					],
				},
				take: PER_KIND,
				orderBy: { name: "asc" },
				select: {
					id: true,
					name: true,
					domain: true,
					iconUrl: true,
					iconDarkUrl: true,
					iconTone: true,
				},
			}),
			this.db.contact.findMany({
				where: {
					OR: [
						{ firstName: { contains: term, mode: "insensitive" } },
						{ lastName: { contains: term, mode: "insensitive" } },
						{ email: { contains: term, mode: "insensitive" } },
					],
				},
				take: PER_KIND,
				orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					imageUrl: true,
					company: { select: { name: true } },
				},
			}),
			this.db.deal.findMany({
				where: { name: { contains: term, mode: "insensitive" } },
				take: PER_KIND,
				orderBy: [{ stage: "asc" }, { name: "asc" }],
				select: {
					id: true,
					name: true,
					company: {
						select: {
							name: true,
							iconUrl: true,
							iconDarkUrl: true,
							iconTone: true,
						},
					},
				},
			}),
			this.db.productUser.findMany({
				where: {
					OR: [
						{ externalId: { contains: term, mode: "insensitive" } },
						{ displayName: { contains: term, mode: "insensitive" } },
						{ email: { contains: term, mode: "insensitive" } },
						{
							identities: {
								some: {
									normalizedValue: {
										contains: term.toLowerCase(),
									},
								},
							},
						},
						{
							memberships: {
								some: {
									productOrganization: {
										OR: [
											{ name: { contains: term, mode: "insensitive" } },
											{ externalId: { contains: term, mode: "insensitive" } },
										],
									},
								},
							},
						},
					],
				},
				take: PER_KIND,
				orderBy: [{ displayName: "asc" }, { email: "asc" }],
				select: {
					id: true,
					externalId: true,
					displayName: true,
					email: true,
					avatarUrl: true,
					memberships: {
						take: 1,
						select: {
							productOrganization: { select: { name: true } },
						},
					},
				},
			}),
		]);

		return {
			hits: [
				...companies.map(
					(company): SearchHit => ({
						kind: "company",
						id: company.id,
						label: company.name,
						detail: company.domain,
						iconUrl: company.iconUrl,
						iconDarkUrl: company.iconDarkUrl,
						iconTone: company.iconTone,
						imageUrl: null,
					}),
				),
				...contacts.map(
					(contact): SearchHit => ({
						kind: "contact",
						id: contact.id,
						label:
							[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
							(contact.email ?? "Unnamed"),
						detail: contact.company?.name ?? contact.email,
						iconUrl: null,
						iconDarkUrl: null,
						iconTone: null,
						imageUrl: contact.imageUrl,
					}),
				),
				...deals.map(
					(deal): SearchHit => ({
						kind: "deal",
						id: deal.id,
						label: deal.name,
						detail: deal.company.name,
						iconUrl: deal.company.iconUrl,
						iconDarkUrl: deal.company.iconDarkUrl,
						iconTone: deal.company.iconTone,
						imageUrl: null,
					}),
				),
				...productUsers.map(
					(user): SearchHit => ({
						kind: "user",
						id: user.id,
						label: user.displayName ?? user.email ?? user.externalId,
						detail:
							user.memberships[0]?.productOrganization.name ??
							user.email ??
							user.externalId,
						iconUrl: null,
						iconDarkUrl: null,
						iconTone: null,
						imageUrl: user.avatarUrl,
					}),
				),
			],
		};
	}
}
