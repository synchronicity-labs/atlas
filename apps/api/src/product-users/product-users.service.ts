import { type Db, Prisma } from "@crm/db";
import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { domainFromEmail, normalizeDomain } from "../companies/domain";
import { InjectDatabase } from "../database/database.constants";
import { MetabaseClient } from "../metabase/metabase.client";
import { metabaseConfig } from "../metabase/metabase.config";
import { MetabaseService } from "../metabase/metabase.service";
import { paginate, resolveOrderBy } from "../trpc/list-input";
import type {
	ProductUserDomainInput,
	ProductUserListInput,
} from "./product-users.contracts";

const SORTABLE: Record<
	string,
	(dir: Prisma.SortOrder) => Prisma.ProductUserOrderByWithRelationInput[]
> = {
	id: (dir) => [{ externalId: dir }],
	name: (dir) => [{ displayName: { sort: dir, nulls: "last" } }],
	email: (dir) => [{ email: { sort: dir, nulls: "last" } }],
	syncedAt: (dir) => [{ syncedAt: dir }],
};

function scalar(value: Prisma.JsonValue | null): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return null;
}

function stringValue(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const result = String(value).trim();
	return result.length > 0 ? result : null;
}

function emailDomain(email: string | null): string | null {
	const at = email?.lastIndexOf("@") ?? -1;
	return at > 0 ? normalizeDomain(email?.slice(at + 1)) : null;
}

function isPaidPlan(plan: string | null): boolean {
	return Boolean(plan && !/^(hobbyist|free)$/i.test(plan));
}

function booleanValue(value: unknown): boolean | null {
	if (typeof value === "boolean") return value;
	if (value === 1 || value === "true") return true;
	if (value === 0 || value === "false") return false;
	return null;
}

function dateValue(value: unknown): Date | null {
	if (typeof value !== "string") return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function searchOrderBy(input: ProductUserListInput): Prisma.Sql {
	const direction = input.dir === "desc" ? "DESC" : "ASC";
	const expression = (() => {
		switch (input.sort) {
			case "id":
				return `u."externalId" ${direction}`;
			case "name":
				return `u."displayName" ${direction} NULLS LAST`;
			case "email":
				return `u.email ${direction} NULLS LAST`;
			case "syncedAt":
				return `u."syncedAt" ${direction}`;
			default:
				return `u."syncedAt" DESC`;
		}
	})();

	return Prisma.raw(`${expression}, u."externalId" ASC, u.id ASC`);
}

@Injectable()
export class ProductUsersService {
	private readonly logger = new Logger(ProductUsersService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
		@Inject(MetabaseService) private readonly metabase: MetabaseService,
	) {}

	async list(input: ProductUserListInput) {
		await this.hydrateEmailSearch(input.q);
		const searchPage = await this.searchPage(input);
		const where: Prisma.ProductUserWhereInput = searchPage
			? { id: { in: searchPage.ids } }
			: {};
		const { skip, take } = paginate(input);
		const [foundRows, total, source] = await Promise.all([
			this.db.productUser.findMany({
				where,
				...(searchPage
					? {}
					: {
							skip,
							take,
							orderBy: resolveOrderBy(input, SORTABLE, [{ syncedAt: "desc" }]),
						}),
				select: {
					id: true,
					externalId: true,
					email: true,
					displayName: true,
					role: true,
					avatarUrl: true,
					lastSeenAt: true,
					syncedAt: true,
					memberships: {
						orderBy: { productOrganization: { name: "asc" } },
						select: {
							role: true,
							productOrganization: {
								select: {
									id: true,
									externalId: true,
									name: true,
									domain: true,
									plan: true,
									paymentStatus: true,
								},
							},
						},
					},
				},
			}),
			searchPage?.total ?? this.db.productUser.count(),
			this.db.dataSource.findUnique({
				where: { key: "metabase:sync" },
				select: {
					state: true,
					lastSyncAt: true,
					freshnessDeadlineAt: true,
					lastError: true,
				},
			}),
		]);
		const rows = searchPage
			? searchPage.ids.flatMap((id) => {
					const row = foundRows.find((candidate) => candidate.id === id);
					return row ? [row] : [];
				})
			: foundRows;

		return {
			rows: rows.map((row) => ({
				...row,
				lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
				syncedAt: row.syncedAt.toISOString(),
				organizations: row.memberships.map((membership) => ({
					...membership.productOrganization,
					membershipRole: membership.role,
					paymentStatus: scalar(membership.productOrganization.paymentStatus),
				})),
				memberships: undefined,
			})),
			total,
			facetCounts: {},
			source: source
				? {
						...source,
						lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
						freshnessDeadlineAt:
							source.freshnessDeadlineAt?.toISOString() ?? null,
					}
				: null,
		};
	}

	async byId(id: string) {
		const identity = await this.db.productUser.findUnique({
			where: { id },
			select: { externalId: true },
		});
		if (!identity)
			throw new NotFoundException(`No product user with id ${id}.`);
		await this.agent.productUserViewed(id);
		await this.hydrateDetails(id, identity.externalId);

		const user = await this.db.productUser.findUnique({
			where: { id },
			select: {
				id: true,
				externalId: true,
				email: true,
				displayName: true,
				role: true,
				disabled: true,
				banned: true,
				isAnonymous: true,
				avatarUrl: true,
				locale: true,
				phoneNumber: true,
				emailVerified: true,
				createdAtSource: true,
				updatedAtSource: true,
				lastSeenAt: true,
				syncedAt: true,
				identities: {
					orderBy: [{ kind: "asc" }, { value: "asc" }],
					select: { id: true, kind: true, value: true, source: true },
				},
				memberships: {
					orderBy: { productOrganization: { name: "asc" } },
					select: {
						role: true,
						syncedAt: true,
						productOrganization: {
							select: {
								id: true,
								externalId: true,
								name: true,
								domain: true,
								plan: true,
								paymentStatus: true,
								stripeCustomerId: true,
							},
						},
					},
				},
				snapshots: {
					orderBy: { capturedAt: "desc" },
					take: 12,
					select: {
						id: true,
						capturedAt: true,
						contentHash: true,
					},
				},
				sourceLinks: {
					orderBy: { updatedAt: "desc" },
					select: {
						method: true,
						confidence: true,
						evidence: true,
						sourceRecord: {
							select: {
								kind: true,
								externalId: true,
								payload: true,
								syncedAt: true,
								source: {
									select: {
										key: true,
										label: true,
										state: true,
										lastSyncAt: true,
										freshnessDeadlineAt: true,
									},
								},
							},
						},
					},
				},
				contactLinks: {
					orderBy: { updatedAt: "desc" },
					select: {
						method: true,
						confidence: true,
						contact: {
							select: {
								id: true,
								firstName: true,
								lastName: true,
								email: true,
								title: true,
								company: { select: { id: true, name: true, domain: true } },
							},
						},
					},
				},
				companyLinks: {
					orderBy: { updatedAt: "desc" },
					select: {
						method: true,
						confidence: true,
						company: { select: { id: true, name: true, domain: true } },
					},
				},
			},
		});

		if (!user) throw new NotFoundException(`No product user with id ${id}.`);

		return {
			...user,
			emailDomain: emailDomain(user.email),
			workDomain: domainFromEmail(user.email),
			createdAtSource: user.createdAtSource?.toISOString() ?? null,
			updatedAtSource: user.updatedAtSource?.toISOString() ?? null,
			lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
			syncedAt: user.syncedAt.toISOString(),
			memberships: user.memberships.map((membership) => ({
				role: membership.role,
				syncedAt: membership.syncedAt.toISOString(),
				organization: {
					...membership.productOrganization,
					paymentStatus: scalar(membership.productOrganization.paymentStatus),
				},
			})),
			sourceLinks: user.sourceLinks.map((link) => ({
				...link,
				sourceRecord: {
					...link.sourceRecord,
					syncedAt: link.sourceRecord.syncedAt.toISOString(),
					source: {
						...link.sourceRecord.source,
						lastSyncAt:
							link.sourceRecord.source.lastSyncAt?.toISOString() ?? null,
						freshnessDeadlineAt:
							link.sourceRecord.source.freshnessDeadlineAt?.toISOString() ??
							null,
					},
				},
			})),
			snapshots: user.snapshots.map((snapshot) => ({
				...snapshot,
				capturedAt: snapshot.capturedAt.toISOString(),
			})),
		};
	}

	private async hydrateDetails(id: string, externalId: string): Promise<void> {
		if (
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				externalId,
			)
		) {
			return;
		}
		const config = metabaseConfig();
		if (!config) return;

		try {
			const client = new MetabaseClient(config);
			const card = await client.card(config.userQuestionId);
			const detail = await client.userDetail(card, externalId);
			if (!detail) return;
			await this.db.productUser.update({
				where: { id },
				data: {
					displayName: stringValue(detail.display_name),
					disabled: booleanValue(detail.disabled),
					banned: booleanValue(detail.banned),
					isAnonymous: booleanValue(detail.is_anonymous),
					avatarUrl: stringValue(detail.avatar_url),
					locale: stringValue(detail.locale),
					phoneNumber: stringValue(detail.phone_number),
					emailVerified: booleanValue(detail.email_verified),
					createdAtSource: dateValue(detail.created_at),
					updatedAtSource: dateValue(detail.updated_at),
					lastSeenAt: dateValue(detail.last_seen),
				},
			});
		} catch (error) {
			this.logger.warn({
				message: "Live Metabase user details were unavailable",
				reason: error instanceof Error ? error.message : "Unknown failure",
			});
		}
	}

	async domain(input: ProductUserDomainInput) {
		const domain = normalizeDomain(input.domain);
		if (!domain || domainFromEmail(`member@${domain}`) !== domain) {
			throw new BadRequestException(
				"Atlas does not treat that email provider as a company domain.",
			);
		}

		const emailFilter: Prisma.StringNullableFilter = {
			endsWith: `@${domain}`,
			mode: "insensitive",
		};
		const term = input.q.trim();
		const where: Prisma.ProductUserWhereInput = {
			email: emailFilter,
			...(term
				? {
						AND: [
							{
								OR: [
									{ externalId: { contains: term, mode: "insensitive" } },
									{ email: { contains: term, mode: "insensitive" } },
									{ displayName: { contains: term, mode: "insensitive" } },
								],
							},
						],
					}
				: {}),
		};
		const allDomainUsers: Prisma.ProductUserWhereInput = { email: emailFilter };
		const { skip, take } = paginate(input);
		const [rows, total, aggregate, memberships] = await Promise.all([
			this.db.productUser.findMany({
				where,
				skip,
				take,
				orderBy: resolveOrderBy(input, SORTABLE, [
					{ displayName: { sort: "asc", nulls: "last" } },
					{ email: "asc" },
				]),
				select: {
					id: true,
					externalId: true,
					email: true,
					displayName: true,
					avatarUrl: true,
					role: true,
					lastSeenAt: true,
					syncedAt: true,
					memberships: {
						orderBy: { productOrganization: { name: "asc" } },
						select: {
							productOrganization: {
								select: {
									id: true,
									externalId: true,
									name: true,
									plan: true,
								},
							},
						},
					},
				},
			}),
			this.db.productUser.count({ where }),
			this.db.productUser.aggregate({
				where: allDomainUsers,
				_min: { syncedAt: true },
				_max: { syncedAt: true, lastSeenAt: true },
			}),
			this.db.productOrganizationMembership.findMany({
				where: { productUser: allDomainUsers },
				distinct: ["productOrganizationId"],
				select: {
					productOrganization: {
						select: { id: true, name: true, plan: true },
					},
				},
			}),
		]);

		const organizations = memberships.map(
			(membership) => membership.productOrganization,
		);
		const planCounts = Object.entries(
			organizations.reduce<Record<string, number>>((counts, organization) => {
				const plan = organization.plan?.trim() || "No plan";
				counts[plan] = (counts[plan] ?? 0) + 1;
				return counts;
			}, {}),
		)
			.map(([plan, count]) => ({ plan, count }))
			.sort((a, b) => b.count - a.count || a.plan.localeCompare(b.plan));

		return {
			domain,
			rows: rows.map((row) => ({
				...row,
				lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
				syncedAt: row.syncedAt.toISOString(),
				organizations: row.memberships.map(
					(membership) => membership.productOrganization,
				),
				memberships: undefined,
			})),
			total,
			stats: {
				people: await this.db.productUser.count({ where: allDomainUsers }),
				organizations: organizations.length,
				paidOrganizations: organizations.filter((organization) =>
					isPaidPlan(organization.plan),
				).length,
				firstObservedAt: aggregate._min.syncedAt?.toISOString() ?? null,
				lastObservedAt: aggregate._max.syncedAt?.toISOString() ?? null,
				lastSeenAt: aggregate._max.lastSeenAt?.toISOString() ?? null,
				planCounts,
			},
		};
	}

	private async searchPage(input: ProductUserListInput): Promise<{
		ids: string[];
		total: number;
	} | null> {
		const term = input.q.trim();
		if (!term) return null;
		const pattern = `%${term}%`;
		const normalizedPattern = `%${term.toLowerCase()}%`;
		const { skip, take } = paginate(input);
		const matches = await this.db.$queryRaw<
			Array<{ id: string; total: number }>
		>(Prisma.sql`
			WITH "matchingUsers" AS (
				SELECT u.id
				FROM "productUser" u
				WHERE u."externalId" ILIKE ${pattern}
					OR u.email ILIKE ${pattern}
					OR u."displayName" ILIKE ${pattern}
					OR u.role ILIKE ${pattern}
				UNION
				SELECT i."productUserId" AS id
				FROM "productUserIdentity" i
				WHERE i."normalizedValue" ILIKE ${normalizedPattern}
				UNION
				SELECT m."productUserId" AS id
				FROM "productOrganizationMembership" m
				JOIN "productOrganization" o ON o.id = m."productOrganizationId"
				WHERE o."externalId" ILIKE ${pattern}
					OR o.name ILIKE ${pattern}
					OR o.domain ILIKE ${pattern}
					OR o."stripeCustomerId" ILIKE ${pattern}
			)
			SELECT u.id, count(*) OVER ()::int AS total
			FROM "matchingUsers" matched
			JOIN "productUser" u ON u.id = matched.id
			ORDER BY ${searchOrderBy(input)}
			LIMIT ${take}
			OFFSET ${skip}
		`);

		return {
			ids: matches.map(({ id }) => id),
			total: matches[0]?.total ?? 0,
		};
	}

	private async hydrateEmailSearch(term: string): Promise<void> {
		const value = term.trim().toLowerCase().replace(/^@/, "");
		if (!value.includes(".") || /\s/.test(value)) return;
		try {
			await this.metabase.syncUsersMatchingEmail(value);
		} catch (error) {
			this.logger.warn({
				message: "Live Metabase email search was unavailable",
				reason: error instanceof Error ? error.message : "Unknown failure",
			});
		}
	}
}
