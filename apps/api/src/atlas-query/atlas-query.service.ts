import { type Db, QuestionStatus, SourceStatus } from "@crm/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type { AtlasQuestionQuery } from "./atlas-query.contracts";

@Injectable()
export class AtlasQueryService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async catalog() {
		const [dashboards, questions] = await Promise.all([
			this.db.dashboard.findMany({
				orderBy: { number: "asc" },
				select: {
					number: true,
					name: true,
					description: true,
					updatedAt: true,
					tabs: {
						orderBy: { position: "asc" },
						select: { number: true, name: true },
					},
					cards: {
						orderBy: { position: "asc" },
						select: {
							question: { select: { number: true } },
							tab: { select: { number: true } },
						},
					},
				},
			}),
			this.db.question.findMany({
				where: { status: QuestionStatus.ACTIVE },
				orderBy: { number: "asc" },
				select: {
					number: true,
					name: true,
					description: true,
					connector: true,
					sourceExternalId: true,
					updatedAt: true,
					source: {
						select: {
							key: true,
							label: true,
							state: true,
							freshnessDeadlineAt: true,
						},
					},
					versions: {
						orderBy: { version: "desc" },
						take: 1,
						select: {
							version: true,
							queryLanguage: true,
							display: true,
							createdAt: true,
						},
					},
				},
			}),
		]);
		const externalIds = questions.flatMap((question) =>
			question.sourceExternalId ? [question.sourceExternalId] : [],
		);
		const snapshots = await this.db.resultSnapshot.findMany({
			where: { questionExternalId: { in: externalIds } },
			orderBy: { capturedAt: "desc" },
			select: {
				questionExternalId: true,
				reportingPeriod: true,
				capturedAt: true,
				rowCount: true,
			},
		});
		const latest = new Map<
			string,
			{ reportingPeriod: string; capturedAt: Date; rowCount: number }
		>();
		for (const snapshot of snapshots) {
			if (!latest.has(snapshot.questionExternalId)) {
				latest.set(snapshot.questionExternalId, snapshot);
			}
		}

		return {
			schemaVersion: "atlas.catalog.v1",
			generatedAt: new Date().toISOString(),
			dashboards: dashboards.map((dashboard) => ({
				number: dashboard.number,
				name: dashboard.name,
				description: dashboard.description,
				updatedAt: dashboard.updatedAt.toISOString(),
				tabs: dashboard.tabs,
				questions: dashboard.cards.map((card) => ({
					number: card.question.number,
					tab: card.tab?.number ?? null,
				})),
			})),
			questions: questions.map((question) => {
				const snapshot = question.sourceExternalId
					? latest.get(question.sourceExternalId)
					: undefined;
				const version = question.versions[0];
				return {
					number: question.number,
					name: question.name,
					description: question.description,
					connector: question.connector,
					source: question.source,
					sourceExternalId: question.sourceExternalId,
					updatedAt: question.updatedAt.toISOString(),
					latestVersion: version
						? {
								...version,
								createdAt: version.createdAt.toISOString(),
							}
						: null,
					latestResult: snapshot
						? {
								reportingPeriod: snapshot.reportingPeriod,
								capturedAt: snapshot.capturedAt.toISOString(),
								rowCount: snapshot.rowCount,
							}
						: null,
				};
			}),
		};
	}

	async question(number: number, input: AtlasQuestionQuery) {
		const question = await this.db.question.findUnique({
			where: { number },
			select: {
				number: true,
				name: true,
				description: true,
				connector: true,
				sourceExternalId: true,
				sourceDashboardExternalId: true,
				databaseExternalId: true,
				status: true,
				updatedAt: true,
				source: {
					select: {
						key: true,
						kind: true,
						label: true,
						state: true,
						lastSyncAt: true,
						freshnessDeadlineAt: true,
						lastError: true,
					},
				},
				versions: {
					orderBy: { version: "desc" },
					take: 1,
					select: {
						version: true,
						queryLanguage: true,
						queryText: true,
						display: true,
						visualization: true,
						createdBy: true,
						createdAt: true,
					},
				},
			},
		});
		if (!question) {
			throw new NotFoundException(`No Atlas question ${number}.`);
		}
		const externalId = question.sourceExternalId ?? `question:${number}`;
		const snapshot = await this.db.resultSnapshot.findFirst({
			where: {
				questionExternalId: externalId,
				reportingPeriod: input.reportingPeriod,
				capturedAt: input.asOf ? { lte: new Date(input.asOf) } : undefined,
			},
			orderBy: { capturedAt: "desc" },
			select: {
				id: true,
				idempotencyKey: true,
				reportingPeriod: true,
				capturedAt: true,
				contentHash: true,
				columns: true,
				rows: true,
				rowCount: true,
			},
		});
		const version = question.versions[0] ?? null;
		const freshness = resolveFreshness({
			hasResult: snapshot != null,
			historical: Boolean(input.asOf || input.reportingPeriod),
			state: question.source?.state,
			deadline: question.source?.freshnessDeadlineAt,
		});

		return {
			schemaVersion: "atlas.query.v1",
			question: {
				number: question.number,
				name: question.name,
				description: question.description,
				status: question.status,
				connector: question.connector,
				updatedAt: question.updatedAt.toISOString(),
			},
			definition: version
				? {
						...version,
						createdAt: version.createdAt.toISOString(),
					}
				: null,
			result: snapshot
				? {
						id: snapshot.id,
						reportingPeriod: snapshot.reportingPeriod,
						capturedAt: snapshot.capturedAt.toISOString(),
						columns: snapshot.columns,
						rows: snapshot.rows,
						rowCount: snapshot.rowCount,
						immutable: true,
					}
				: null,
			freshness,
			provenance: {
				source: question.source
					? {
							...question.source,
							lastSyncAt: question.source.lastSyncAt?.toISOString() ?? null,
							freshnessDeadlineAt:
								question.source.freshnessDeadlineAt?.toISOString() ?? null,
						}
					: null,
				sourceExternalId: question.sourceExternalId,
				sourceDashboardExternalId: question.sourceDashboardExternalId,
				databaseExternalId: question.databaseExternalId,
				questionVersion: version?.version ?? null,
				resultContentHash: snapshot?.contentHash ?? null,
				resultIdempotencyKey: snapshot?.idempotencyKey ?? null,
			},
		};
	}
}

export function resolveFreshness(input: {
	hasResult: boolean;
	historical: boolean;
	state?: SourceStatus;
	deadline?: Date | null;
}) {
	if (!input.hasResult) {
		return {
			status: "unavailable" as const,
			reason: "No result snapshot exists.",
		};
	}
	if (input.historical) {
		return { status: "historical" as const, reason: null };
	}
	if (input.state === SourceStatus.ERROR) {
		return { status: "error" as const, reason: "The source sync is failing." };
	}
	if (
		input.state === SourceStatus.STALE ||
		!input.deadline ||
		input.deadline.getTime() <= Date.now()
	) {
		return {
			status: "stale" as const,
			reason: "The freshness deadline passed.",
		};
	}
	return { status: "fresh" as const, reason: null };
}
