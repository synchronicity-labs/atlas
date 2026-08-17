import { DataSourceKind, type Db, Prisma, SourceStatus } from "@crm/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { z } from "zod";
import { BillingExperimentService } from "../billing-experiment/billing-experiment.service";
import { InjectDatabase } from "../database/database.constants";
import { EconomicsService } from "../economics/economics.service";
import { MarketingService } from "../marketing/marketing.service";
import { MetabaseService } from "../metabase/metabase.service";
import { ProductEligibilityService } from "../metabase/product-eligibility.service";
import {
	summarizeDashboardVerification,
	summarizeMetricVerification,
	summarizePendingMetricVerification,
} from "../metric-verification";
import { SalesService } from "../sales/sales.service";
import type { dashboardLayoutInput } from "./atlas-dashboards.contracts";

@Injectable()
export class AtlasDashboardsService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly billingExperiment: BillingExperimentService,
		private readonly metabase: MetabaseService,
		private readonly productEligibility: ProductEligibilityService,
		private readonly marketing: MarketingService,
		private readonly sales: SalesService,
		private readonly economics: EconomicsService,
	) {}

	async refresh(number: number) {
		const dashboard = await this.db.dashboard.findUnique({
			where: { number },
			select: {
				cards: {
					select: {
						question: {
							select: {
								connector: true,
								source: { select: { key: true } },
							},
						},
					},
				},
			},
		});
		if (!dashboard)
			throw new NotFoundException(`No Atlas dashboard ${number}.`);
		const connectors = new Set(
			dashboard.cards.map((card) => card.question.connector),
		);
		const sourceKeys = new Set(
			dashboard.cards.flatMap((card) =>
				card.question.source?.key ? [card.question.source.key] : [],
			),
		);
		const results: Array<{
			cardsProcessed: number;
			snapshotsCreated?: number;
			snapshots?: number;
			completed?: boolean;
			remainingQuestions?: number;
			errors?: Array<{ number: number; message: string }>;
		}> = [];
		if (connectors.has(DataSourceKind.METABASE)) {
			const metabase = await this.metabase.syncAtlasDashboard(number);
			results.push(metabase);
			if (!metabase.completed) {
				return {
					cardsProcessed: metabase.cardsProcessed,
					snapshotsCreated: metabase.snapshotsCreated,
					completed: false,
					remainingQuestions: metabase.remainingQuestions,
					errors: [],
				};
			}
		}
		if (sourceKeys.has("hubspot:crm")) {
			results.push(await this.sales.syncDashboard(number));
		}
		if (sourceKeys.has("atlas:economics")) {
			results.push(await this.economics.syncDashboard(number));
		}
		if (sourceKeys.has("atlas:billing-experiment")) {
			results.push(await this.billingExperiment.syncDashboard(number));
		}
		if (sourceKeys.has("atlas:marketing") || sourceKeys.has("atlas:abuse")) {
			results.push(await this.marketing.syncDashboard(number));
		}
		if (sourceKeys.has("atlas:product-eligibility")) {
			results.push(await this.productEligibility.syncDashboard(number));
		}
		if (results.length === 0) {
			throw new Error("This dashboard has no executable question source.");
		}
		return {
			cardsProcessed: results.reduce(
				(total, result) => total + result.cardsProcessed,
				0,
			),
			snapshotsCreated: results.reduce(
				(total, result) =>
					total + (result.snapshotsCreated ?? result.snapshots ?? 0),
				0,
			),
			errors: results.flatMap((result) => result.errors ?? []),
			completed: true,
			remainingQuestions: 0,
		};
	}

	async list() {
		const dashboards = await this.db.dashboard.findMany({
			orderBy: { number: "asc" },
			select: {
				id: true,
				number: true,
				name: true,
				description: true,
				updatedAt: true,
				_count: { select: { tabs: true, cards: true } },
			},
		});
		return dashboards.map((dashboard) => ({
			...dashboard,
			tabCount: dashboard._count.tabs,
			questionCount: dashboard._count.cards,
			_count: undefined,
			updatedAt: dashboard.updatedAt.toISOString(),
		}));
	}

	async byNumber(number: number) {
		const dashboard = await this.db.dashboard.findUnique({
			where: { number },
			select: {
				id: true,
				number: true,
				name: true,
				description: true,
				layoutVersion: true,
				updatedAt: true,
				tabs: {
					orderBy: { position: "asc" },
					select: {
						id: true,
						number: true,
						name: true,
						position: true,
						sourceExternalId: true,
					},
				},
				cards: {
					orderBy: [{ tab: { position: "asc" } }, { position: "asc" }],
					select: {
						id: true,
						tabId: true,
						position: true,
						x: true,
						y: true,
						width: true,
						height: true,
						visualization: true,
						displaySettings: true,
						question: {
							select: {
								number: true,
								name: true,
								description: true,
								lastCheckedAt: true,
								connector: true,
								sourceId: true,
								sourceExternalId: true,
								metricVersionId: true,
								versions: {
									orderBy: { version: "desc" },
									take: 1,
									select: {
										version: true,
										display: true,
									},
								},
							},
						},
					},
				},
			},
		});

		if (!dashboard)
			throw new NotFoundException(`No Atlas dashboard ${number}.`);

		const externalIds = dashboard.cards.flatMap((card) =>
			card.question.sourceExternalId ? [card.question.sourceExternalId] : [],
		);
		const resultSnapshots = externalIds.length
			? await this.db.$queryRaw<
					Array<{
						id: string;
						questionExternalId: string;
						reportingPeriod: string;
						capturedAt: Date;
						columns: Prisma.JsonValue;
						rows: Prisma.JsonValue;
						rowCount: number;
					}>
				>(Prisma.sql`
				SELECT DISTINCT ON ("questionExternalId")
				  "id", "questionExternalId", "reportingPeriod", "capturedAt",
				  "columns", "rows", "rowCount"
				FROM "resultSnapshot"
				WHERE "questionExternalId" IN (${Prisma.join(externalIds)})
				ORDER BY "questionExternalId", "capturedAt" DESC
			`)
			: [];
		const latestResult = new Map<string, (typeof resultSnapshots)[number]>();
		for (const snapshot of resultSnapshots) {
			if (!latestResult.has(snapshot.questionExternalId)) {
				latestResult.set(snapshot.questionExternalId, snapshot);
			}
		}
		const metricVersionIds = dashboard.cards.flatMap((card) =>
			card.question.metricVersionId ? [card.question.metricVersionId] : [],
		);
		const metricSnapshots = metricVersionIds.length
			? await this.db.metricSnapshot.findMany({
					where: { metricVersionId: { in: metricVersionIds } },
					orderBy: { computedAt: "desc" },
					select: {
						id: true,
						metricVersionId: true,
						reportingPeriod: true,
						computedAt: true,
						dataThrough: true,
						trustStatus: true,
						columns: true,
						rows: true,
						rowCount: true,
						metricRun: {
							select: {
								verifications: {
									orderBy: { name: "asc" },
									select: {
										name: true,
										status: true,
										evidence: true,
										verifiedAt: true,
									},
								},
							},
						},
					},
				})
			: [];
		const latestMetric = new Map<string, (typeof metricSnapshots)[number]>();
		for (const snapshot of metricSnapshots) {
			if (!latestMetric.has(snapshot.metricVersionId)) {
				latestMetric.set(snapshot.metricVersionId, snapshot);
			}
		}
		const sourceIds = [
			...new Set(
				dashboard.cards.flatMap((card) =>
					card.question.sourceId ? [card.question.sourceId] : [],
				),
			),
		];
		const sources = await this.db.dataSource.findMany({
			where: { id: { in: sourceIds } },
			select: {
				id: true,
				key: true,
				kind: true,
				label: true,
				state: true,
				lastSyncAt: true,
				freshnessDeadlineAt: true,
				lastError: true,
			},
		});
		const source = aggregateSources(sources);
		const hubspotPortalId = process.env.HUBSPOT_PORTAL_ID?.trim();
		const sourceUrl =
			dashboard.number === 4 && hubspotPortalId
				? `https://app-na2.hubspot.com/reports-dashboard/${hubspotPortalId}/view/15158250`
				: null;

		const cards = dashboard.cards.map((card) => {
			const metricSnapshot = card.question.metricVersionId
				? latestMetric.get(card.question.metricVersionId)
				: undefined;
			const resultSnapshot = card.question.sourceExternalId
				? latestResult.get(card.question.sourceExternalId)
				: undefined;
			const verification = metricSnapshot
				? summarizeMetricVerification(metricSnapshot)
				: card.question.metricVersionId
					? summarizePendingMetricVerification()
					: null;
			return {
				...card,
				question: {
					...card.question,
					lastCheckedAt: card.question.lastCheckedAt?.toISOString() ?? null,
					metricVersionId: undefined,
					latestVersion: card.question.versions[0] ?? null,
					versions: undefined,
				},
				snapshot: metricSnapshot
					? {
							id: metricSnapshot.id,
							reportingPeriod: metricSnapshot.reportingPeriod,
							capturedAt: metricSnapshot.computedAt.toISOString(),
							dataThrough: metricSnapshot.dataThrough.toISOString(),
							trustStatus: metricSnapshot.trustStatus,
							columns: metricSnapshot.columns,
							rows: metricSnapshot.rows,
							rowCount: metricSnapshot.rowCount,
						}
					: resultSnapshot
						? {
								...resultSnapshot,
								capturedAt: resultSnapshot.capturedAt.toISOString(),
								dataThrough: null,
								trustStatus: null,
							}
						: null,
				verification,
			};
		});

		return {
			...dashboard,
			updatedAt: dashboard.updatedAt.toISOString(),
			sourceUrl,
			sources: sources.map(serializeSource),
			cards,
			verification: summarizeDashboardVerification(
				cards.map((card) => card.verification),
			),
			source: source ? serializeSource(source) : null,
		};
	}

	async updateLayout(input: z.infer<typeof dashboardLayoutInput>) {
		return this.db.$transaction(async (tx) => {
			const dashboard = await tx.dashboard.findUnique({
				where: { number: input.number },
				select: { id: true, layoutVersion: true },
			});
			if (!dashboard) {
				throw new NotFoundException(`No Atlas dashboard ${input.number}.`);
			}
			const tab = await tx.dashboardTab.findUnique({
				where: {
					dashboardId_number: {
						dashboardId: dashboard.id,
						number: input.tabNumber,
					},
				},
				select: { id: true },
			});
			if (!tab) {
				throw new NotFoundException(
					`No tab ${input.tabNumber} on this dashboard.`,
				);
			}
			const cards = await tx.dashboardCard.findMany({
				where: {
					dashboardId: dashboard.id,
					tabId: tab.id,
					id: { in: input.items.map((item) => item.id) },
				},
				select: { id: true },
			});
			if (cards.length !== input.items.length) {
				throw new Error(
					"The layout contains a card outside this dashboard tab.",
				);
			}
			await Promise.all(
				input.items.map((item, position) =>
					tx.dashboardCard.update({
						where: { id: item.id },
						data: {
							position,
							x: item.x,
							y: item.y,
							width: item.width,
							height: item.height,
							visualization: item.visualization,
						},
					}),
				),
			);
			return tx.dashboard.update({
				where: { id: dashboard.id },
				data: { layoutVersion: { increment: 1 } },
				select: { layoutVersion: true, updatedAt: true },
			});
		});
	}
}

type DashboardSource = {
	id?: string;
	key?: string;
	kind: DataSourceKind;
	label: string;
	state: SourceStatus;
	lastSyncAt: Date | null;
	freshnessDeadlineAt: Date | null;
	lastError: string | null;
};

function serializeSource(source: DashboardSource) {
	return {
		...source,
		lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
		freshnessDeadlineAt: source.freshnessDeadlineAt?.toISOString() ?? null,
	};
}

function aggregateSources(sources: DashboardSource[]): DashboardSource | null {
	if (sources.length === 0) return null;
	if (sources.length === 1) return sources[0] ?? null;
	const state = sources.some((source) => source.state === SourceStatus.ERROR)
		? SourceStatus.ERROR
		: sources.some((source) => source.state === SourceStatus.SYNCING)
			? SourceStatus.SYNCING
			: sources.some((source) => source.state === SourceStatus.UNCONFIGURED)
				? SourceStatus.UNCONFIGURED
				: sources.some((source) => source.state === SourceStatus.STALE)
					? SourceStatus.STALE
					: SourceStatus.HEALTHY;
	const timestamps = (key: "lastSyncAt" | "freshnessDeadlineAt") =>
		sources
			.flatMap((source) => (source[key] ? [source[key].getTime()] : []))
			.sort((a, b) => a - b);
	const lastSync = timestamps("lastSyncAt");
	const deadlines = timestamps("freshnessDeadlineAt");
	return {
		kind: DataSourceKind.ATLAS,
		label: `${sources.length} connected sources`,
		state,
		lastSyncAt: lastSync[0] ? new Date(lastSync[0]) : null,
		freshnessDeadlineAt: deadlines[0] ? new Date(deadlines[0]) : null,
		lastError:
			sources
				.flatMap((source) =>
					source.lastError ? [`${source.label}: ${source.lastError}`] : [],
				)
				.join(" | ") || null,
	};
}
