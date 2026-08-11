import { DataSourceKind, type Db, type Prisma, QuestionStatus } from "@crm/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { BillingExperimentService } from "../billing-experiment/billing-experiment.service";
import { InjectDatabase } from "../database/database.constants";
import { EconomicsService } from "../economics/economics.service";
import { MarketingService } from "../marketing/marketing.service";
import { MetabaseClient } from "../metabase/metabase.client";
import { metabaseConfig } from "../metabase/metabase.config";
import { SalesService } from "../sales/sales.service";
import { paginate, resolveOrderBy } from "../trpc/list-input";
import type {
	QuestionListInput,
	QuestionPreviewInput,
	QuestionSaveVersionInput,
} from "./questions.contracts";
import { assertReadOnlyQuery } from "./read-only-query";

const SORTABLE: Record<
	string,
	(dir: Prisma.SortOrder) => Prisma.QuestionOrderByWithRelationInput[]
> = {
	number: (dir) => [{ number: dir }],
	name: (dir) => [{ name: dir }],
	updatedAt: (dir) => [{ updatedAt: dir }],
};

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

@Injectable()
export class QuestionsService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly billingExperiment: BillingExperimentService,
		private readonly marketing: MarketingService,
		private readonly sales: SalesService,
		private readonly economics: EconomicsService,
	) {}

	async list(input: QuestionListInput) {
		const term = input.q.trim();
		const where: Prisma.QuestionWhereInput = {
			status: QuestionStatus.ACTIVE,
			...(term
				? {
						OR: [
							{ name: { contains: term, mode: "insensitive" as const } },
							{
								description: { contains: term, mode: "insensitive" as const },
							},
							{
								sourceExternalId: {
									contains: term,
									mode: "insensitive" as const,
								},
							},
						],
					}
				: {}),
		};
		const { skip, take } = paginate(input);
		const [rows, total] = await Promise.all([
			this.db.question.findMany({
				where,
				skip,
				take,
				orderBy: resolveOrderBy(input, SORTABLE, [{ updatedAt: "desc" }]),
				select: {
					id: true,
					number: true,
					name: true,
					description: true,
					connector: true,
					purpose: true,
					sourceExternalId: true,
					status: true,
					updatedAt: true,
					metricVersion: {
						select: {
							version: true,
							metric: {
								select: { key: true, name: true, status: true },
							},
						},
					},
					versions: {
						orderBy: { version: "desc" },
						take: 1,
						select: { version: true, queryLanguage: true, display: true },
					},
					_count: { select: { dashboardCards: true } },
				},
			}),
			this.db.question.count({ where }),
		]);

		return {
			rows: rows.map((row) => ({
				...row,
				latestVersion: row.versions[0] ?? null,
				versions: undefined,
				dashboardCount: row._count.dashboardCards,
				_count: undefined,
				updatedAt: row.updatedAt.toISOString(),
			})),
			total,
			facetCounts: {},
		};
	}

	async byNumber(number: number) {
		const question = await this.db.question.findUnique({
			where: { number },
			select: {
				id: true,
				number: true,
				name: true,
				description: true,
				connector: true,
				purpose: true,
				metricVersionId: true,
				metricVersion: {
					select: {
						version: true,
						approvedAt: true,
						businessDefinition: true,
						normalizationPolicy: true,
						computation: true,
						verificationPolicy: true,
						cadence: true,
						metric: {
							select: {
								key: true,
								name: true,
								description: true,
								ownerTeam: true,
								status: true,
							},
						},
					},
				},
				source: { select: { key: true } },
				sourceExternalId: true,
				sourceDashboardExternalId: true,
				databaseExternalId: true,
				status: true,
				updatedAt: true,
				versions: {
					orderBy: { version: "desc" },
					select: {
						id: true,
						version: true,
						queryLanguage: true,
						queryText: true,
						display: true,
						visualization: true,
						createdBy: true,
						createdAt: true,
					},
				},
				dashboardCards: {
					select: {
						dashboard: { select: { number: true, name: true } },
						tab: { select: { number: true, name: true } },
					},
				},
			},
		});

		if (!question) {
			throw new NotFoundException(`No Atlas question ${number}.`);
		}

		const snapshots = question.metricVersionId
			? await this.db.metricSnapshot
					.findMany({
						where: { metricVersionId: question.metricVersionId },
						orderBy: { computedAt: "desc" },
						take: 12,
						select: {
							id: true,
							reportingPeriod: true,
							computedAt: true,
							dataThrough: true,
							trustStatus: true,
							columns: true,
							rows: true,
							rowCount: true,
						},
					})
					.then((rows) =>
						rows.map((row) => ({
							id: row.id,
							reportingPeriod: row.reportingPeriod,
							capturedAt: row.computedAt,
							dataThrough: row.dataThrough,
							trustStatus: row.trustStatus,
							columns: row.columns,
							rows: row.rows,
							rowCount: row.rowCount,
						})),
					)
			: question.sourceExternalId
				? await this.db.resultSnapshot
						.findMany({
							where: { questionExternalId: question.sourceExternalId },
							orderBy: { capturedAt: "desc" },
							take: question.sourceExternalId.startsWith(
								"atlas:failed-generations:",
							)
								? 1
								: 12,
							select: {
								id: true,
								reportingPeriod: true,
								capturedAt: true,
								columns: true,
								rows: true,
								rowCount: true,
							},
						})
						.then((rows) =>
							rows.map((row) => ({
								...row,
								dataThrough: null,
								trustStatus: null,
							})),
						)
				: [];
		const config = metabaseConfig();
		const hubspotPortalId = process.env.HUBSPOT_PORTAL_ID?.trim();
		const posthogProjectId = process.env.POSTHOG_PROJECT_ID?.trim();

		return {
			...question,
			metric: question.metricVersion
				? {
						...question.metricVersion.metric,
						version: question.metricVersion.version,
						approvedAt:
							question.metricVersion.approvedAt?.toISOString() ?? null,
						contract: {
							businessDefinition: question.metricVersion.businessDefinition,
							normalizationPolicy: question.metricVersion.normalizationPolicy,
							computation: question.metricVersion.computation,
							verificationPolicy: question.metricVersion.verificationPolicy,
							cadence: question.metricVersion.cadence,
						},
					}
				: null,
			metricVersion: undefined,
			metricVersionId: undefined,
			sourceKey: question.source?.key ?? null,
			source: undefined,
			updatedAt: question.updatedAt.toISOString(),
			versions: question.versions.map((version) => ({
				...version,
				createdAt: version.createdAt.toISOString(),
			})),
			snapshots: snapshots.map((snapshot) => ({
				...snapshot,
				capturedAt: snapshot.capturedAt.toISOString(),
				dataThrough: snapshot.dataThrough?.toISOString() ?? null,
			})),
			sourceUrl:
				config &&
				question.connector === DataSourceKind.METABASE &&
				question.sourceExternalId &&
				/^\d+$/.test(question.sourceExternalId)
					? `${config.baseUrl}/question/${question.sourceExternalId}`
					: question.connector === DataSourceKind.HUBSPOT &&
							hubspotPortalId &&
							question.sourceDashboardExternalId
						? `https://app-na2.hubspot.com/reports-dashboard/${hubspotPortalId}/view/${question.sourceDashboardExternalId}`
						: question.source?.key === "atlas:billing-experiment" &&
								posthogProjectId
							? `https://us.posthog.com/project/${posthogProjectId}/feature_flags/726996`
							: null,
		};
	}

	async preview(input: QuestionPreviewInput) {
		assertReadOnlyQuery(input.queryLanguage, input.queryText);
		const question = await this.db.question.findUnique({
			where: { number: input.number },
			select: {
				databaseExternalId: true,
				source: { select: { key: true } },
			},
		});
		if (!question) {
			throw new NotFoundException(`No Atlas question ${input.number}.`);
		}
		const startedAt = Date.now();
		const result =
			input.queryLanguage === "API"
				? question.source?.key === "hubspot:crm"
					? await this.sales.preview(input.queryText)
					: question.source?.key === "atlas:economics"
						? await this.economics.preview(input.queryText)
						: question.source?.key === "atlas:billing-experiment"
							? await this.billingExperiment.preview(input.queryText)
							: await this.marketing.preview(input.queryText)
				: await this.metabasePreview(
						input.queryLanguage,
						input.queryText,
						question.databaseExternalId,
					);
		const limit = 500;

		return {
			columns: result.columns,
			rows: result.rows.slice(0, limit),
			rowCount: result.rows.length,
			truncated: result.rows.length > limit,
			durationMs: Date.now() - startedAt,
		};
	}

	async proposal(id: string) {
		const proposal = await this.db.questionChangeProposal.findUnique({
			where: { id },
			select: {
				id: true,
				summary: true,
				name: true,
				description: true,
				queryLanguage: true,
				queryText: true,
				display: true,
				visualization: true,
				status: true,
				createdAt: true,
				question: { select: { number: true } },
			},
		});
		if (!proposal) {
			throw new NotFoundException("That Rudy proposal does not exist.");
		}
		return {
			...proposal,
			questionNumber: proposal.question.number,
			question: undefined,
			createdAt: proposal.createdAt.toISOString(),
		};
	}

	private async metabasePreview(
		language: "SQL" | "MBQL",
		queryText: string,
		databaseExternalId: string | null,
	) {
		const config = metabaseConfig();
		if (!config) throw new Error("Metabase is not configured.");
		return new MetabaseClient(config).preview({
			language,
			queryText,
			databaseExternalId,
		});
	}

	async saveVersion(input: QuestionSaveVersionInput, createdBy: string) {
		assertReadOnlyQuery(input.queryLanguage, input.queryText);
		return this.db.$transaction(async (tx) => {
			const question = await tx.question.findUnique({
				where: { number: input.number },
				select: { id: true },
			});
			if (!question) {
				throw new NotFoundException(`No Atlas question ${input.number}.`);
			}
			const latest = await tx.questionVersion.findFirst({
				where: { questionId: question.id },
				orderBy: { version: "desc" },
				select: { version: true },
			});
			const version = await tx.questionVersion.create({
				data: {
					questionId: question.id,
					version: (latest?.version ?? 0) + 1,
					queryLanguage: input.queryLanguage,
					queryText: input.queryText,
					display: input.display,
					visualization: json(input.visualization),
					createdBy,
				},
			});
			await tx.question.update({
				where: { id: question.id },
				data: { name: input.name, description: input.description },
			});
			if (input.proposalId) {
				await tx.questionChangeProposal.updateMany({
					where: {
						id: input.proposalId,
						questionId: question.id,
						status: "PENDING",
					},
					data: { status: "APPLIED", reviewedAt: new Date() },
				});
			}
			return { ...version, createdAt: version.createdAt.toISOString() };
		});
	}
}
