import {
	type Db,
	MetricTrustStatus,
	QuestionStatus,
	SourceStatus,
} from "@crm/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { questionExplanation } from "../questions/question-explanation";
import type { AtlasQuestionQuery } from "./atlas-query.contracts";

@Injectable()
export class AtlasQueryService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async catalog() {
		const [dashboards, questions, metrics] = await Promise.all([
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
					purpose: true,
					metricVersionId: true,
					sourceExternalId: true,
					updatedAt: true,
					metricVersion: {
						select: {
							version: true,
							approvedAt: true,
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
			this.db.metricDefinition.findMany({
				orderBy: { key: "asc" },
				select: {
					key: true,
					name: true,
					description: true,
					ownerTeam: true,
					status: true,
					updatedAt: true,
					versions: {
						orderBy: { version: "desc" },
						take: 1,
						select: {
							version: true,
							approvedAt: true,
							contentHash: true,
							inputs: {
								orderBy: { alias: "asc" },
								select: {
									alias: true,
									required: true,
									expectedGrain: true,
									maxLagSeconds: true,
									dataset: {
										select: {
											key: true,
											label: true,
											source: {
												select: { key: true, kind: true },
											},
										},
									},
								},
							},
						},
					},
				},
			}),
		]);
		const externalIds = questions.flatMap((question) =>
			question.sourceExternalId ? [question.sourceExternalId] : [],
		);
		const metricVersionIds = questions.flatMap((question) =>
			question.metricVersionId ? [question.metricVersionId] : [],
		);
		const [snapshots, metricSnapshots] = await Promise.all([
			this.db.resultSnapshot.findMany({
				where: { questionExternalId: { in: externalIds } },
				orderBy: { capturedAt: "desc" },
				select: {
					questionExternalId: true,
					reportingPeriod: true,
					capturedAt: true,
					rowCount: true,
				},
			}),
			this.db.metricSnapshot.findMany({
				where: { metricVersionId: { in: metricVersionIds } },
				orderBy: { computedAt: "desc" },
				select: {
					metricVersionId: true,
					reportingPeriod: true,
					computedAt: true,
					dataThrough: true,
					trustStatus: true,
					rowCount: true,
				},
			}),
		]);
		const latest = new Map<
			string,
			{ reportingPeriod: string; capturedAt: Date; rowCount: number }
		>();
		for (const snapshot of snapshots) {
			if (!latest.has(snapshot.questionExternalId)) {
				latest.set(snapshot.questionExternalId, snapshot);
			}
		}
		const latestMetric = new Map<
			string,
			{
				reportingPeriod: string;
				computedAt: Date;
				dataThrough: Date;
				trustStatus: MetricTrustStatus;
				rowCount: number;
			}
		>();
		for (const snapshot of metricSnapshots) {
			if (!latestMetric.has(snapshot.metricVersionId)) {
				latestMetric.set(snapshot.metricVersionId, snapshot);
			}
		}

		return {
			schemaVersion: "atlas.catalog.v1",
			generatedAt: new Date().toISOString(),
			metrics: metrics.map((metric) => ({
				...metric,
				updatedAt: metric.updatedAt.toISOString(),
				latestVersion: metric.versions[0]
					? {
							...metric.versions[0],
							approvedAt: metric.versions[0].approvedAt?.toISOString() ?? null,
						}
					: null,
			})),
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
				const metricSnapshot = question.metricVersionId
					? latestMetric.get(question.metricVersionId)
					: undefined;
				const snapshot = question.sourceExternalId
					? latest.get(question.sourceExternalId)
					: undefined;
				const version = question.versions[0];
				return {
					number: question.number,
					name: question.name,
					description: question.description,
					explanation: questionExplanation({
						name: question.name,
						description: question.description,
						metricDescription: question.metricVersion?.metric.description,
					}),
					connector: question.connector,
					purpose: question.purpose,
					metric: question.metricVersion
						? {
								...question.metricVersion.metric,
								version: question.metricVersion.version,
								approvedAt:
									question.metricVersion.approvedAt?.toISOString() ?? null,
							}
						: null,
					source: question.source,
					sourceExternalId: question.sourceExternalId,
					updatedAt: question.updatedAt.toISOString(),
					latestVersion: version
						? {
								...version,
								createdAt: version.createdAt.toISOString(),
							}
						: null,
					latestResult: question.metricVersionId
						? metricSnapshot
							? {
									reportingPeriod: metricSnapshot.reportingPeriod,
									capturedAt: metricSnapshot.computedAt.toISOString(),
									dataThrough: metricSnapshot.dataThrough.toISOString(),
									trustStatus: metricSnapshot.trustStatus,
									rowCount: metricSnapshot.rowCount,
								}
							: null
						: snapshot
							? {
									reportingPeriod: snapshot.reportingPeriod,
									capturedAt: snapshot.capturedAt.toISOString(),
									dataThrough: null,
									trustStatus: null,
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
				purpose: true,
				metricVersionId: true,
				sourceExternalId: true,
				sourceDashboardExternalId: true,
				databaseExternalId: true,
				status: true,
				updatedAt: true,
				metricVersion: {
					select: {
						version: true,
						businessDefinition: true,
						normalizationPolicy: true,
						computation: true,
						verificationPolicy: true,
						cadence: true,
						contentHash: true,
						approvedBy: true,
						approvedAt: true,
						metric: {
							select: {
								key: true,
								name: true,
								description: true,
								ownerTeam: true,
								status: true,
							},
						},
						inputs: {
							orderBy: { alias: "asc" },
							select: {
								alias: true,
								required: true,
								queryLanguage: true,
								queryText: true,
								queryHash: true,
								expectedGrain: true,
								maxLagSeconds: true,
								dataset: {
									select: {
										key: true,
										label: true,
										eventTimeField: true,
										watermarkField: true,
										cadenceMinutes: true,
										freshnessSlaMinutes: true,
										source: {
											select: {
												key: true,
												kind: true,
												label: true,
											},
										},
									},
								},
							},
						},
					},
				},
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
		const [snapshot, metricSnapshot] = await Promise.all([
			this.db.resultSnapshot.findFirst({
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
			}),
			question.metricVersionId
				? this.db.metricSnapshot.findFirst({
						where: {
							metricVersionId: question.metricVersionId,
							reportingPeriod: input.reportingPeriod,
							computedAt: input.asOf
								? { lte: new Date(input.asOf) }
								: undefined,
						},
						orderBy: { computedAt: "desc" },
						select: {
							id: true,
							idempotencyKey: true,
							reportingPeriod: true,
							periodStart: true,
							periodEnd: true,
							dataThrough: true,
							computedAt: true,
							trustStatus: true,
							contentHash: true,
							columns: true,
							rows: true,
							rowCount: true,
							metricRun: {
								select: {
									runKey: true,
									status: true,
									sourceWatermarks: true,
									inputHash: true,
									outputHash: true,
									validation: true,
									verifications: {
										orderBy: { name: "asc" },
										select: {
											name: true,
											status: true,
											referenceType: true,
											tolerance: true,
											evidence: true,
											verifiedBy: true,
											verifiedAt: true,
										},
									},
								},
							},
						},
					})
				: null,
		]);
		const version = question.versions[0] ?? null;
		const historical = Boolean(input.asOf || input.reportingPeriod);
		const freshness = question.metricVersionId
			? resolveMetricFreshness({
					hasResult: metricSnapshot != null,
					historical,
					trustStatus: metricSnapshot?.trustStatus,
				})
			: resolveFreshness({
					hasResult: snapshot != null,
					historical,
					state: question.source?.state,
					deadline: question.source?.freshnessDeadlineAt,
				});

		return {
			schemaVersion: "atlas.query.v1",
			question: {
				number: question.number,
				name: question.name,
				description: question.description,
				explanation: questionExplanation({
					name: question.name,
					description: question.description,
					metricDescription: question.metricVersion?.metric.description,
				}),
				status: question.status,
				connector: question.connector,
				purpose: question.purpose,
				updatedAt: question.updatedAt.toISOString(),
			},
			definition: version
				? {
						...version,
						createdAt: version.createdAt.toISOString(),
					}
				: null,
			result: question.metricVersionId
				? metricSnapshot
					? {
							id: metricSnapshot.id,
							reportingPeriod: metricSnapshot.reportingPeriod,
							periodStart: metricSnapshot.periodStart.toISOString(),
							periodEnd: metricSnapshot.periodEnd.toISOString(),
							dataThrough: metricSnapshot.dataThrough.toISOString(),
							capturedAt: metricSnapshot.computedAt.toISOString(),
							trustStatus: metricSnapshot.trustStatus,
							columns: metricSnapshot.columns,
							rows: metricSnapshot.rows,
							rowCount: metricSnapshot.rowCount,
							immutable: true,
						}
					: null
				: snapshot
					? {
							id: snapshot.id,
							reportingPeriod: snapshot.reportingPeriod,
							capturedAt: snapshot.capturedAt.toISOString(),
							periodStart: null,
							periodEnd: null,
							dataThrough: null,
							trustStatus: null,
							columns: snapshot.columns,
							rows: snapshot.rows,
							rowCount: snapshot.rowCount,
							immutable: true,
						}
					: null,
			freshness,
			provenance: {
				metric: question.metricVersion
					? {
							...question.metricVersion.metric,
							version: question.metricVersion.version,
							approvedBy: question.metricVersion.approvedBy,
							approvedAt:
								question.metricVersion.approvedAt?.toISOString() ?? null,
							contentHash: question.metricVersion.contentHash,
							contract: {
								businessDefinition: question.metricVersion.businessDefinition,
								normalizationPolicy: question.metricVersion.normalizationPolicy,
								computation: question.metricVersion.computation,
								verificationPolicy: question.metricVersion.verificationPolicy,
								cadence: question.metricVersion.cadence,
							},
							inputs: question.metricVersion.inputs,
						}
					: null,
				metricRun: metricSnapshot
					? {
							...metricSnapshot.metricRun,
							verifications: metricSnapshot.metricRun.verifications.map(
								(verification) => ({
									...verification,
									verifiedAt: verification.verifiedAt?.toISOString() ?? null,
								}),
							),
						}
					: null,
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
				resultContentHash: question.metricVersionId
					? (metricSnapshot?.contentHash ?? null)
					: (snapshot?.contentHash ?? null),
				resultIdempotencyKey: question.metricVersionId
					? (metricSnapshot?.idempotencyKey ?? null)
					: (snapshot?.idempotencyKey ?? null),
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

export function resolveMetricFreshness(input: {
	hasResult: boolean;
	historical: boolean;
	trustStatus?: MetricTrustStatus;
}) {
	if (!input.hasResult) {
		return {
			status: "unavailable" as const,
			reason: "No governed metric snapshot exists.",
		};
	}
	if (input.historical) {
		return { status: "historical" as const, reason: null };
	}
	if (input.trustStatus === MetricTrustStatus.FAILED) {
		return {
			status: "error" as const,
			reason: "Metric verification failed.",
		};
	}
	if (input.trustStatus === MetricTrustStatus.STALE) {
		return {
			status: "stale" as const,
			reason: "One or more source freshness deadlines passed.",
		};
	}
	if (input.trustStatus !== MetricTrustStatus.VERIFIED) {
		return {
			status: "pending" as const,
			reason: "Metric verification is not complete.",
		};
	}
	return { status: "fresh" as const, reason: null };
}
