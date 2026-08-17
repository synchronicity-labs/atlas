import { createHash, randomUUID } from "node:crypto";
import {
	DataSourceKind,
	type Db,
	type Prisma,
	QueryLanguage,
	SourceStatus,
	SyncMode,
	SyncRunStatus,
	VisualizationType,
} from "@crm/db";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { assertReadOnlyQuery } from "../questions/read-only-query";
import {
	type MetabaseCardResponse,
	MetabaseClient,
	type MetabaseDashboardResponse,
	type MetabaseResult,
} from "./metabase.client";
import { type MetabaseConfig, metabaseConfig } from "./metabase.config";
import { ProductEligibilityService } from "./product-eligibility.service";
import {
	ProductMetricPublisher,
	preferredAtlasQuestionNumber,
} from "./product-metric.publisher";
import { TinybirdEligibilityService } from "./tinybird-eligibility.service";

const SOURCE_KEY = "metabase:sync";
const DASHBOARD_SCOPE = "product-scoreboard";
const USERS_SCOPE = "product-users";
const FRESHNESS_MS = 8 * 60 * 60 * 1000;
const ATLAS_DASHBOARD_CONCURRENCY = 4;
const ATLAS_DASHBOARD_QUESTION_BATCH_SIZE = 12;

const USER_COLUMNS = new Set([
	"id",
	"email",
	"display_name",
	"role",
	"disabled",
	"banned",
	"is_anonymous",
	"organization_id",
	"plan",
	"payment_status",
	"stripe_subscription_id",
	"stripe_customer_id",
	"name",
]);

type DashboardSyncInput = {
	mode: "incremental" | "backfill";
	period?: string;
	maxBatches: number;
};

type UserSyncInput = { maxBatches: number };

type SafeUserRow = Record<string, unknown> & { id: string };

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function stableHash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function currentMonth(): string {
	return new Date().toISOString().slice(0, 7);
}

function previousMonth(period: string): string {
	const [year, month] = period.split("-").map(Number);
	if (!year || !month) {
		throw new Error(`Invalid reporting period: ${period}`);
	}
	return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

function stringValue(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const result = String(value).trim();
	return result.length > 0 ? result : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
	const result = stringValue(value);
	return result ? result.slice(0, maxLength) : null;
}

function identifierString(value: unknown, maxLength: number): string | null {
	const result = stringValue(value);
	return result && result.length <= maxLength ? result : null;
}

function booleanValue(value: unknown): boolean | null {
	if (value === true || value === 1 || value === "1" || value === "true") {
		return true;
	}
	if (value === false || value === 0 || value === "0" || value === "false") {
		return false;
	}
	return null;
}

function visualization(display: string | undefined): VisualizationType {
	switch (display) {
		case "scalar":
		case "smartscalar":
			return VisualizationType.NUMBER;
		case "line":
			return VisualizationType.LINE;
		case "area":
			return VisualizationType.AREA;
		case "bar":
			return VisualizationType.BAR;
		case "pie":
			return VisualizationType.PIE;
		case "funnel":
			return VisualizationType.FUNNEL;
		default:
			return VisualizationType.TABLE;
	}
}

@Injectable()
export class MetabaseService {
	private readonly logger = new Logger(MetabaseService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly productMetrics: ProductMetricPublisher,
		private readonly productEligibility: ProductEligibilityService,
		private readonly tinybirdEligibility: TinybirdEligibilityService,
	) {}

	async status() {
		const [source, latestRuns, users, organizations, questions, dashboards] =
			await Promise.all([
				this.db.dataSource.findUnique({ where: { key: SOURCE_KEY } }),
				this.db.syncRun.findMany({
					where: { source: { key: SOURCE_KEY } },
					orderBy: { startedAt: "desc" },
					take: 8,
				}),
				this.db.productUser.count(),
				this.db.productOrganization.count(),
				this.db.question.count(),
				this.db.dashboard.count(),
			]);

		return {
			configured: metabaseConfig() !== null,
			source,
			latestRuns,
			counts: { users, organizations, questions, dashboards },
		};
	}

	async syncUsersMatchingEmail(term: string) {
		const config = await this.requireConfig();
		const source = await this.beginSource();
		const client = new MetabaseClient(config);
		const card = await client.card(config.userQuestionId);
		const result = await client.usersByEmail(card, term);
		const rows = this.safeUserRows(result);
		const persisted = await this.persistUsers(source.id, rows);
		return { processed: rows.length, snapshots: persisted.snapshots };
	}

	async syncUsers(input: UserSyncInput) {
		const config = await this.requireConfig();
		const source = await this.beginSource();
		const run = await this.db.syncRun.create({
			data: {
				runKey: `metabase:${USERS_SCOPE}:${new Date().toISOString()}:${randomUUID()}`,
				sourceId: source.id,
				mode: SyncMode.INCREMENTAL,
				status: SyncRunStatus.RUNNING,
				scope: USERS_SCOPE,
				period: currentMonth(),
			},
		});

		try {
			const client = new MetabaseClient(config);
			const card = await client.card(config.userQuestionId);
			this.validateUserCard(card);
			const checkpoint = await this.db.syncCursor.upsert({
				where: {
					sourceId_mode_scope: {
						sourceId: source.id,
						mode: SyncMode.INCREMENTAL,
						scope: USERS_SCOPE,
					},
				},
				create: {
					sourceId: source.id,
					mode: SyncMode.INCREMENTAL,
					scope: USERS_SCOPE,
					period: currentMonth(),
				},
				update: {},
			});

			let cursor = checkpoint.cursor;
			let processed = 0;
			let snapshots = 0;
			let completed = false;

			for (let batch = 0; batch < input.maxBatches; batch += 1) {
				const page = await client.userPage(card, cursor, config.userBatchSize);
				const rows = this.safeUserRows(page);
				const ready = this.completeUserGroups(rows, page.full);

				if (ready.length === 0) {
					completed = true;
					break;
				}

				const persisted = await this.persistUsers(source.id, ready);
				processed += ready.length;
				snapshots += persisted.snapshots;
				cursor = ready.at(-1)?.id ?? cursor;

				await this.db.$transaction([
					this.db.syncCursor.update({
						where: { id: checkpoint.id },
						data: {
							cursor,
							offset: checkpoint.offset + processed,
							period: currentMonth(),
						},
					}),
					this.db.syncRun.update({
						where: { id: run.id },
						data: {
							recordsProcessed: processed,
							snapshotsCreated: snapshots,
							checkpoint: json({ cursor }),
						},
					}),
				]);

				if (!page.full) {
					completed = true;
					break;
				}
			}

			if (completed) {
				await this.db.$transaction([
					this.db.syncCursor.update({
						where: { id: checkpoint.id },
						data: { cursor: null, offset: 0, period: currentMonth() },
					}),
					this.db.syncRun.update({
						where: { id: run.id },
						data: {
							status: SyncRunStatus.COMPLETED,
							finishedAt: new Date(),
							recordsProcessed: processed,
							snapshotsCreated: snapshots,
						},
					}),
					this.db.dataSource.update({
						where: { id: source.id },
						data: {
							state: SourceStatus.HEALTHY,
							lastSyncAt: new Date(),
							lastError: null,
							freshnessDeadlineAt: new Date(Date.now() + FRESHNESS_MS),
						},
					}),
				]);
			} else {
				await this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: SyncRunStatus.COMPLETED,
						finishedAt: new Date(),
						recordsProcessed: processed,
						snapshotsCreated: snapshots,
					},
				});
			}

			this.logger.log({
				message: "Metabase users synchronized",
				processed,
				snapshots,
				completed,
			});

			return { runId: run.id, processed, snapshots, completed, cursor };
		} catch (error) {
			await this.fail(run.id, source.id, error);
			throw error;
		}
	}

	async syncDashboard(input: DashboardSyncInput) {
		const config = await this.requireConfig();
		const source = await this.beginSource();
		const mode =
			input.mode === "backfill" ? SyncMode.BACKFILL : SyncMode.INCREMENTAL;
		const cursor = await this.db.syncCursor.upsert({
			where: {
				sourceId_mode_scope: {
					sourceId: source.id,
					mode,
					scope: DASHBOARD_SCOPE,
				},
			},
			create: {
				sourceId: source.id,
				mode,
				scope: DASHBOARD_SCOPE,
				period: input.period ?? currentMonth(),
			},
			update: input.period ? { period: input.period } : {},
		});
		const period = input.period ?? cursor.period;
		const run = await this.db.syncRun.create({
			data: {
				runKey: `metabase:${DASHBOARD_SCOPE}:${mode}:${period}:${randomUUID()}`,
				sourceId: source.id,
				mode,
				status: SyncRunStatus.RUNNING,
				scope: DASHBOARD_SCOPE,
				period,
			},
		});

		try {
			const client = new MetabaseClient(config);
			const dashboard = await client.dashboard();
			const storedDashboard = await this.persistDashboardShell(
				source.id,
				dashboard,
			);
			const cards = (dashboard.dashcards ?? []).filter(
				(
					item,
				): item is NonNullable<typeof item> & { card: MetabaseCardResponse } =>
					Boolean(item.card && typeof item.card.id === "number"),
			);
			const take = config.cardBatchSize * input.maxBatches;
			const batch = cards.slice(cursor.offset, cursor.offset + take);
			let snapshots = 0;

			for (const placement of batch) {
				const fullCard = await client.card(placement.card.id);
				const fullPlacement = { ...placement, card: fullCard };
				const result = await client.dashboardCardResult(
					placement.id,
					placement.card.id,
					period,
				);
				const created = await this.persistDashboardCard({
					sourceId: source.id,
					dashboardId: storedDashboard.id,
					dashboard,
					placement: fullPlacement,
					period,
					result,
				});
				snapshots += created ? 1 : 0;
			}

			const nextOffset = cursor.offset + batch.length;
			const completed = nextOffset >= cards.length;
			const nextPeriod =
				completed && mode === SyncMode.BACKFILL
					? previousMonth(period)
					: period;
			const completedPeriods =
				completed && mode === SyncMode.BACKFILL
					? cursor.completedPeriods + 1
					: cursor.completedPeriods;
			const backfillFinished =
				mode === SyncMode.BACKFILL &&
				completedPeriods >= config.maxBackfillMonths;

			await this.db.$transaction([
				this.db.syncCursor.update({
					where: { id: cursor.id },
					data: {
						offset: completed ? 0 : nextOffset,
						period: nextPeriod,
						completedPeriods,
					},
				}),
				this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: SyncRunStatus.COMPLETED,
						finishedAt: new Date(),
						cardsProcessed: batch.length,
						snapshotsCreated: snapshots,
						checkpoint: json({ nextOffset, nextPeriod, completedPeriods }),
					},
				}),
				this.db.dataSource.update({
					where: { id: source.id },
					data: {
						state:
							completed && (mode === SyncMode.INCREMENTAL || backfillFinished)
								? SourceStatus.HEALTHY
								: SourceStatus.SYNCING,
						lastSyncAt: completed ? new Date() : undefined,
						lastError: null,
						freshnessDeadlineAt: completed
							? new Date(Date.now() + FRESHNESS_MS)
							: undefined,
					},
				}),
			]);

			return {
				runId: run.id,
				period,
				cardsProcessed: batch.length,
				snapshots,
				completed,
				nextPeriod,
				backfillFinished,
			};
		} catch (error) {
			await this.fail(run.id, source.id, error);
			throw error;
		}
	}

	async syncAtlasDashboard(number: number) {
		const config = await this.requireConfig();
		const dashboard = await this.db.dashboard.findUnique({
			where: { number },
			select: {
				id: true,
				number: true,
				cards: {
					orderBy: { position: "asc" },
					select: {
						question: {
							select: {
								id: true,
								number: true,
								name: true,
								description: true,
								connector: true,
								sourceId: true,
								sourceExternalId: true,
								databaseExternalId: true,
								versions: {
									orderBy: { version: "desc" },
									take: 1,
									select: {
										id: true,
										version: true,
										queryLanguage: true,
										queryText: true,
									},
								},
							},
						},
					},
				},
			},
		});
		if (!dashboard) {
			throw new NotFoundException(`No Atlas dashboard ${number}.`);
		}

		const questions = [
			...new Map(
				dashboard.cards.map((card) => [card.question.id, card.question]),
			).values(),
		]
			.filter(
				(question) =>
					question.connector === DataSourceKind.METABASE &&
					Boolean(question.versions[0]?.queryText.trim()),
			)
			.sort((left, right) => left.number - right.number);
		const sourceIds = new Set(
			questions.flatMap((question) =>
				question.sourceId ? [question.sourceId] : [],
			),
		);
		if (questions.length === 0 || sourceIds.size !== 1) {
			throw new Error(
				"This dashboard must contain questions from one configured source.",
			);
		}
		const sourceId = [...sourceIds][0];
		if (!sourceId) throw new Error("This dashboard has no configured source.");

		const period = currentMonth();
		const runScope = `dashboard:${number}`;
		const cursor = await this.db.syncCursor.upsert({
			where: {
				sourceId_mode_scope: {
					sourceId,
					mode: SyncMode.INCREMENTAL,
					scope: runScope,
				},
			},
			create: {
				sourceId,
				mode: SyncMode.INCREMENTAL,
				scope: runScope,
				period,
			},
			update: {},
		});
		const batchOffset = cursor.period === period ? cursor.offset : 0;
		const questionsToProcess = questions.slice(
			batchOffset,
			batchOffset + ATLAS_DASHBOARD_QUESTION_BATCH_SIZE,
		);
		const run = await this.db.syncRun.create({
			data: {
				runKey: `atlas:dashboard:${number}:${period}:${randomUUID()}`,
				sourceId,
				mode: SyncMode.INCREMENTAL,
				status: SyncRunStatus.RUNNING,
				scope: runScope,
				period,
			},
		});
		await this.db.dataSource.update({
			where: { id: sourceId },
			data: { state: SourceStatus.SYNCING, lastError: null },
		});

		let cardsProcessed = 0;
		let snapshotsCreated = 0;
		try {
			const client = new MetabaseClient(config);
			const eligibility = questions.some(
				(question) =>
					question.databaseExternalId === "166" &&
					question.versions[0]?.queryLanguage === QueryLanguage.SQL,
			)
				? await this.tinybirdEligibility.current()
				: null;
			for (
				let offset = 0;
				offset < questionsToProcess.length;
				offset += ATLAS_DASHBOARD_CONCURRENCY
			) {
				const batch = questionsToProcess.slice(
					offset,
					offset + ATLAS_DASHBOARD_CONCURRENCY,
				);
				const createdCounts = await Promise.all(
					batch.map(async (question) => {
						const version = question.versions[0];
						if (!version) {
							throw new Error(
								`Question ${question.number} has no saved version.`,
							);
						}
						const language =
							version.queryLanguage === QueryLanguage.SQL ? "SQL" : "MBQL";
						assertReadOnlyQuery(language, version.queryText);
						const governed = eligibility
							? this.tinybirdEligibility.govern(
									version.queryText,
									question.databaseExternalId,
									eligibility,
								)
							: null;
						let result = await client.preview({
							language,
							queryText:
								language === "SQL" && governed && question.number !== 15
									? governed.queryText
									: version.queryText,
							databaseExternalId: question.databaseExternalId,
						});
						let publishEligibility = governed
							? { applied: governed.applied, ...governed.eligibility }
							: undefined;
						if (question.number === 15) {
							try {
								const joined =
									await this.productEligibility.governProfessionalResult(
										result,
									);
								result = joined.result;
								publishEligibility = joined.eligibility;
							} catch (error) {
								publishEligibility = publishEligibility
									? {
											...publishEligibility,
											applied: false,
											complete: false,
										}
									: undefined;
								this.logger.warn({
									message: "Product eligibility join did not complete",
									questionNumber: question.number,
									error: error instanceof Error ? error.message : String(error),
								});
							}
						}
						const payload = { columns: result.columns, rows: result.rows };
						const contentHash = stableHash(payload);
						const externalId =
							question.sourceExternalId ?? `question:${question.number}`;
						const capturedAt = new Date();
						const created = await this.db.resultSnapshot.createMany({
							data: [
								{
									idempotencyKey: `atlas:dashboard:${number}:${externalId}:v${version.version}:${period}:${contentHash}`,
									sourceId,
									dashboardExternalId: `atlas:${number}`,
									questionExternalId: externalId,
									reportingPeriod: period,
									capturedAt,
									contentHash,
									columns: json(result.columns),
									rows: json(result.rows),
									rowCount: result.rows.length,
								},
							],
							skipDuplicates: true,
						});
						await this.productMetrics.publish({
							question,
							version,
							result,
							syncRunId: run.id,
							capturedAt,
							eligibility: publishEligibility,
						});
						await this.db.question.update({
							where: { id: question.id },
							data: { lastCheckedAt: capturedAt },
						});
						return created.count;
					}),
				);
				cardsProcessed += batch.length;
				snapshotsCreated += createdCounts.reduce(
					(total, count) => total + count,
					0,
				);
			}

			const finishedAt = new Date();
			const processedThrough = batchOffset + questionsToProcess.length;
			const completed = processedThrough >= questions.length;
			const nextOffset = completed ? 0 : processedThrough;
			const remainingQuestions = completed
				? 0
				: questions.length - processedThrough;
			await this.db.$transaction([
				this.db.syncCursor.update({
					where: { id: cursor.id },
					data: {
						period,
						offset: nextOffset,
						completedPeriods: completed
							? cursor.completedPeriods + 1
							: cursor.completedPeriods,
						lastSuccessAt: finishedAt,
						checkpoint: json({
							completed,
							nextOffset,
							questionCount: questions.length,
							remainingQuestions,
						}),
					},
				}),
				this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: SyncRunStatus.COMPLETED,
						finishedAt,
						cardsProcessed,
						snapshotsCreated,
						checkpoint: json({
							batchOffset,
							completed,
							nextOffset,
							questionCount: questions.length,
							remainingQuestions,
							eligibilityCapturedAt:
								eligibility?.capturedAt.toISOString() ?? null,
							eligibilityHash: eligibility?.contentHash ?? null,
						}),
					},
				}),
				this.db.dataSource.update({
					where: { id: sourceId },
					data: {
						state: completed ? SourceStatus.HEALTHY : SourceStatus.SYNCING,
						lastSyncAt: completed ? finishedAt : undefined,
						lastError: null,
						freshnessDeadlineAt: completed
							? new Date(Date.now() + FRESHNESS_MS)
							: undefined,
					},
				}),
			]);

			return {
				runId: run.id,
				period,
				cardsProcessed,
				snapshotsCreated,
				completed,
				nextOffset,
				remainingQuestions,
			};
		} catch (error) {
			await this.fail(run.id, sourceId, error);
			throw error;
		}
	}

	private async persistDashboardShell(
		sourceId: string,
		dashboard: MetabaseDashboardResponse,
	) {
		const tabs = (dashboard.tabs ?? []).map((tab, index) => ({
			externalId: String(tab.id),
			name: tab.name,
			position: tab.position ?? index,
		}));
		const stored = await this.db.sourceDashboard.upsert({
			where: {
				sourceId_externalId: { sourceId, externalId: String(dashboard.id) },
			},
			create: {
				sourceId,
				externalId: String(dashboard.id),
				name: dashboard.name,
				description: dashboard.description,
				tabs: json(tabs),
				metadataHash: stableHash(dashboard),
				metadata: json({ source: "metabase" }),
				syncedAt: new Date(),
			},
			update: {
				name: dashboard.name,
				description: dashboard.description,
				tabs: json(tabs),
				metadataHash: stableHash(dashboard),
				syncedAt: new Date(),
			},
		});
		const atlasDashboard = await this.db.dashboard.upsert({
			where: { number: 1 },
			create: {
				number: 1,
				name: dashboard.name,
				description: dashboard.description,
				createdBy: "metabase",
			},
			update: { name: dashboard.name, description: dashboard.description },
		});

		for (const tab of tabs) {
			await this.db.dashboardTab.upsert({
				where: {
					dashboardId_number: {
						dashboardId: atlasDashboard.id,
						number: tab.position + 1,
					},
				},
				create: {
					dashboardId: atlasDashboard.id,
					number: tab.position + 1,
					name: tab.name,
					position: tab.position,
					sourceExternalId: tab.externalId,
				},
				update: {
					name: tab.name,
					position: tab.position,
					sourceExternalId: tab.externalId,
				},
			});
		}

		return stored;
	}

	private async persistDashboardCard(input: {
		sourceId: string;
		dashboardId: string;
		dashboard: MetabaseDashboardResponse;
		placement: NonNullable<MetabaseDashboardResponse["dashcards"]>[number] & {
			card: MetabaseCardResponse;
		};
		period: string;
		result: MetabaseResult;
	}): Promise<boolean> {
		const { placement, result } = input;
		await this.db.sourceCard.upsert({
			where: {
				sourceId_dashcardExternalId: {
					sourceId: input.sourceId,
					dashcardExternalId: String(placement.id),
				},
			},
			create: {
				sourceId: input.sourceId,
				dashboardId: input.dashboardId,
				externalId: String(placement.card.id),
				dashcardExternalId: String(placement.id),
				tabExternalId: placement.dashboard_tab_id
					? String(placement.dashboard_tab_id)
					: null,
				name: placement.card.name,
				description: placement.card.description,
				display: placement.card.display ?? "table",
				queryType: placement.card.query_type,
				databaseExternalId: placement.card.database_id
					? String(placement.card.database_id)
					: null,
				metadata: json({
					datasetQuery: placement.card.dataset_query,
					resultMetadata: placement.card.result_metadata,
					visualizationSettings:
						placement.visualization_settings ??
						placement.card.visualization_settings,
					layout: {
						row: placement.row ?? 0,
						col: placement.col ?? 0,
						width: placement.size_x ?? 4,
						height: placement.size_y ?? 4,
					},
				}),
				syncedAt: new Date(),
			},
			update: {
				dashboardId: input.dashboardId,
				externalId: String(placement.card.id),
				tabExternalId: placement.dashboard_tab_id
					? String(placement.dashboard_tab_id)
					: null,
				name: placement.card.name,
				description: placement.card.description,
				display: placement.card.display ?? "table",
				queryType: placement.card.query_type,
				databaseExternalId: placement.card.database_id
					? String(placement.card.database_id)
					: null,
				metadata: json({
					datasetQuery: placement.card.dataset_query,
					resultMetadata: placement.card.result_metadata,
					visualizationSettings:
						placement.visualization_settings ??
						placement.card.visualization_settings,
					layout: {
						row: placement.row ?? 0,
						col: placement.col ?? 0,
						width: placement.size_x ?? 4,
						height: placement.size_y ?? 4,
					},
				}),
				syncedAt: new Date(),
			},
		});

		const question = await this.ensureQuestion(input.sourceId, placement.card);
		await this.ensureDashboardPlacement(
			input.dashboard,
			placement,
			question.id,
		);

		const payload = { columns: result.columns, rows: result.rows };
		const contentHash = stableHash(payload);
		const idempotencyKey = `metabase:${input.dashboard.id}:${placement.card.id}:${input.period}:${contentHash}`;
		const existing = await this.db.resultSnapshot.findUnique({
			where: { idempotencyKey },
			select: { id: true },
		});

		if (existing) return false;

		await this.db.resultSnapshot.create({
			data: {
				idempotencyKey,
				sourceId: input.sourceId,
				dashboardExternalId: String(input.dashboard.id),
				questionExternalId: String(placement.card.id),
				reportingPeriod: input.period,
				capturedAt: new Date(),
				contentHash,
				columns: json(result.columns),
				rows: json(result.rows),
				rowCount: result.rows.length,
			},
		});

		return true;
	}

	private async ensureQuestion(sourceId: string, card: MetabaseCardResponse) {
		const definition = this.cardDefinition(card);
		const existing = await this.db.question.findUnique({
			where: {
				connector_sourceExternalId: {
					connector: DataSourceKind.METABASE,
					sourceExternalId: String(card.id),
				},
			},
		});

		if (existing) {
			await this.db.question.update({
				where: { id: existing.id },
				data: {
					name: card.name,
					description: card.description,
					sourceId,
					databaseExternalId: card.database_id
						? String(card.database_id)
						: null,
				},
			});
			const latest = await this.db.questionVersion.findFirst({
				where: { questionId: existing.id },
				orderBy: { version: "desc" },
			});
			if (
				latest?.createdBy === "metabase" &&
				definition.queryText.trim() &&
				latest.queryText.trim() !== definition.queryText.trim()
			) {
				await this.db.questionVersion.create({
					data: {
						questionId: existing.id,
						version: latest.version + 1,
						...definition,
						sourceCardExternalId: String(card.id),
						createdBy: "metabase",
					},
				});
			}
			return existing;
		}

		const latest = await this.db.question.findFirst({
			orderBy: { number: "desc" },
			select: { number: true },
		});
		const preferredNumber = preferredAtlasQuestionNumber(String(card.id));
		const preferredAvailable = preferredNumber
			? !(await this.db.question.findUnique({
					where: { number: preferredNumber },
					select: { id: true },
				}))
			: false;
		const question = await this.db.question.create({
			data: {
				number:
					preferredNumber && preferredAvailable
						? preferredNumber
						: (latest?.number ?? 0) + 1,
				name: card.name,
				description: card.description,
				connector: DataSourceKind.METABASE,
				sourceId,
				sourceExternalId: String(card.id),
				databaseExternalId: card.database_id ? String(card.database_id) : null,
			},
		});

		await this.db.questionVersion.create({
			data: {
				questionId: question.id,
				version: 1,
				...definition,
				sourceCardExternalId: String(card.id),
				createdBy: "metabase",
			},
		});

		return question;
	}

	private async ensureDashboardPlacement(
		dashboard: MetabaseDashboardResponse,
		placement: NonNullable<MetabaseDashboardResponse["dashcards"]>[number] & {
			card: MetabaseCardResponse;
		},
		questionId: string,
	): Promise<void> {
		const atlasDashboard = await this.db.dashboard.findUniqueOrThrow({
			where: { number: 1 },
		});
		const tabPosition = (dashboard.tabs ?? []).find(
			(tab) => tab.id === placement.dashboard_tab_id,
		)?.position;
		const tab = await this.db.dashboardTab.findUnique({
			where: {
				dashboardId_number: {
					dashboardId: atlasDashboard.id,
					number: (tabPosition ?? 0) + 1,
				},
			},
		});
		const existing = await this.db.dashboardCard.findFirst({
			where: { dashboardId: atlasDashboard.id, tabId: tab?.id, questionId },
		});
		const data = {
			position: placement.row ?? 0,
			x: placement.col ?? 0,
			y: placement.row ?? 0,
			width: placement.size_x ?? 4,
			height: placement.size_y ?? 4,
			visualization: visualization(placement.card.display),
			displaySettings: json(
				placement.visualization_settings ??
					placement.card.visualization_settings ??
					{},
			),
		};

		if (existing) {
			await this.db.dashboardCard.update({ where: { id: existing.id }, data });
			return;
		}

		await this.db.dashboardCard.create({
			data: {
				...data,
				dashboardId: atlasDashboard.id,
				tabId: tab?.id,
				questionId,
			},
		});
	}

	private nativeQuery(datasetQuery: unknown): string {
		if (!datasetQuery || typeof datasetQuery !== "object") return "";
		const query = datasetQuery as {
			native?: { query?: unknown };
			stages?: Array<{ native?: unknown }>;
		};
		if (typeof query.native?.query === "string") return query.native.query;
		return typeof query.stages?.[0]?.native === "string"
			? query.stages[0].native
			: "";
	}

	private cardDefinition(card: MetabaseCardResponse) {
		return {
			queryLanguage:
				card.query_type === "native" ? QueryLanguage.SQL : QueryLanguage.MBQL,
			queryText:
				card.query_type === "native"
					? this.nativeQuery(card.dataset_query)
					: JSON.stringify(card.dataset_query, null, 2),
			display: card.display ?? "table",
			visualization: json(card.visualization_settings ?? {}),
		};
	}

	private validateUserCard(card: MetabaseCardResponse): void {
		const columns = (card.result_metadata ?? []).map((column) =>
			String(column.name ?? ""),
		);

		if (!columns.includes("id") || !columns.includes("email")) {
			throw new Error(
				"The configured Metabase user question is missing id or email.",
			);
		}

		const unsafe = columns.filter((column) => !USER_COLUMNS.has(column));
		if (unsafe.length > 0) {
			throw new Error(
				"The configured Metabase user question contains fields Atlas will not ingest.",
			);
		}
	}

	private safeUserRows(result: MetabaseResult): SafeUserRow[] {
		const columns = result.columns.map((column) => column.name);
		const unsafe = columns.filter((column) => !USER_COLUMNS.has(column));

		if (unsafe.length > 0) {
			throw new Error("Metabase returned a user field Atlas will not ingest.");
		}

		return result.rows.flatMap((values) => {
			const record = Object.fromEntries(
				columns.map((column, index) => [column, values[index] ?? null]),
			);
			const id = identifierString(record.id, 255);
			return id ? [{ ...record, id }] : [];
		});
	}

	private completeUserGroups(
		rows: SafeUserRow[],
		full: boolean,
	): SafeUserRow[] {
		if (!full || rows.length === 0) return rows;
		const trailingId = rows.at(-1)?.id;
		const split = rows.findIndex((row) => row.id === trailingId);

		if (split <= 0) {
			throw new Error(
				"A single product user exceeds the configured Metabase batch size.",
			);
		}

		return rows.slice(0, split);
	}

	private async persistUsers(sourceId: string, rows: SafeUserRow[]) {
		let snapshots = 0;

		await this.db.$transaction(
			async (tx) => {
				for (const row of rows) {
					const email = identifierString(row.email, 320)?.toLowerCase() ?? null;
					const user = await tx.productUser.upsert({
						where: { sourceId_externalId: { sourceId, externalId: row.id } },
						create: {
							sourceId,
							externalId: row.id,
							email,
							displayName: boundedString(row.display_name, 500),
							role: boundedString(row.role, 128),
							disabled: booleanValue(row.disabled),
							banned: booleanValue(row.banned),
							isAnonymous: booleanValue(row.is_anonymous),
							traits: json(row),
							syncedAt: new Date(),
						},
						update: {
							email,
							displayName: boundedString(row.display_name, 500),
							role: boundedString(row.role, 128),
							disabled: booleanValue(row.disabled),
							banned: booleanValue(row.banned),
							isAnonymous: booleanValue(row.is_anonymous),
							traits: json(row),
							syncedAt: new Date(),
						},
					});

					await tx.productUserIdentity.upsert({
						where: {
							productUserId_kind_normalizedValue: {
								productUserId: user.id,
								kind: "user_id",
								normalizedValue: row.id.toLowerCase(),
							},
						},
						create: {
							productUserId: user.id,
							kind: "user_id",
							value: row.id,
							normalizedValue: row.id.toLowerCase(),
							source: "metabase",
						},
						update: { value: row.id },
					});

					if (email) {
						await tx.productUserIdentity.upsert({
							where: {
								productUserId_kind_normalizedValue: {
									productUserId: user.id,
									kind: "email",
									normalizedValue: email,
								},
							},
							create: {
								productUserId: user.id,
								kind: "email",
								value: email,
								normalizedValue: email,
								source: "metabase",
							},
							update: { value: email },
						});
					}

					const organizationId = identifierString(row.organization_id, 255);
					if (organizationId) {
						const organization = await tx.productOrganization.upsert({
							where: {
								sourceId_externalId: { sourceId, externalId: organizationId },
							},
							create: {
								sourceId,
								externalId: organizationId,
								name: boundedString(row.name, 500),
								plan: boundedString(row.plan, 128),
								paymentStatus: json(row.payment_status),
								stripeSubscriptionId: identifierString(
									row.stripe_subscription_id,
									255,
								),
								stripeCustomerId: identifierString(row.stripe_customer_id, 255),
								traits: json({
									name: row.name,
									plan: row.plan,
									payment_status: row.payment_status,
								}),
								syncedAt: new Date(),
							},
							update: {
								name: boundedString(row.name, 500),
								plan: boundedString(row.plan, 128),
								paymentStatus: json(row.payment_status),
								stripeSubscriptionId: identifierString(
									row.stripe_subscription_id,
									255,
								),
								stripeCustomerId: identifierString(row.stripe_customer_id, 255),
								traits: json({
									name: row.name,
									plan: row.plan,
									payment_status: row.payment_status,
								}),
								syncedAt: new Date(),
							},
						});

						await tx.productOrganizationMembership.upsert({
							where: {
								productUserId_productOrganizationId: {
									productUserId: user.id,
									productOrganizationId: organization.id,
								},
							},
							create: {
								productUserId: user.id,
								productOrganizationId: organization.id,
								role: boundedString(row.role, 128),
								syncedAt: new Date(),
							},
							update: {
								role: boundedString(row.role, 128),
								syncedAt: new Date(),
							},
						});
					}

					const contentHash = stableHash(row);
					const idempotencyKey = `metabase:user:${row.id}:${organizationId ?? "none"}:${contentHash}`;
					const result = await tx.productUserSnapshot.createMany({
						data: [
							{
								idempotencyKey,
								sourceId,
								productUserId: user.id,
								capturedAt: new Date(),
								contentHash,
								payload: json(row),
							},
						],
						skipDuplicates: true,
					});
					snapshots += result.count;
				}
			},
			{ maxWait: 15_000, timeout: 120_000 },
		);

		return { snapshots };
	}

	private async requireConfig(): Promise<MetabaseConfig> {
		const config = metabaseConfig();

		if (config) return config;

		await this.db.dataSource.upsert({
			where: { key: SOURCE_KEY },
			create: {
				key: SOURCE_KEY,
				kind: DataSourceKind.METABASE,
				label: "Sync Metabase",
				state: SourceStatus.UNCONFIGURED,
			},
			update: { state: SourceStatus.UNCONFIGURED },
		});
		throw new Error("Metabase is not configured.");
	}

	private async beginSource() {
		await this.db.syncRun.updateMany({
			where: {
				status: SyncRunStatus.RUNNING,
				startedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) },
			},
			data: {
				status: SyncRunStatus.FAILED,
				finishedAt: new Date(),
				error: "Sync worker stopped before the batch completed.",
			},
		});

		return this.db.dataSource.upsert({
			where: { key: SOURCE_KEY },
			create: {
				key: SOURCE_KEY,
				kind: DataSourceKind.METABASE,
				label: "Sync Metabase",
				state: SourceStatus.SYNCING,
			},
			update: { state: SourceStatus.SYNCING, lastError: null },
		});
	}

	private async fail(runId: string, sourceId: string, error: unknown) {
		const message =
			error instanceof Error ? error.message : "Unknown Metabase sync failure.";
		await this.db.$transaction([
			this.db.syncRun.update({
				where: { id: runId },
				data: {
					status: SyncRunStatus.FAILED,
					finishedAt: new Date(),
					error: message,
				},
			}),
			this.db.dataSource.update({
				where: { id: sourceId },
				data: { state: SourceStatus.ERROR, lastError: message },
			}),
		]);
		this.logger.error(
			{ message: "Metabase sync failed" },
			error instanceof Error ? error.stack : String(error),
		);
	}
}
