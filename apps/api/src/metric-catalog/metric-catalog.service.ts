import { createHash, randomUUID } from "node:crypto";
import {
	DataSourceKind,
	type Db,
	MetricCatalogAttemptOutcome,
	MetricCatalogKind,
	MetricLifecycleStatus,
	MetricReadinessStatus,
	MetricTrustStatus,
	type Prisma,
	QueryLanguage,
	QuestionPurpose,
	QuestionStatus,
	SourceStatus,
	SyncMode,
	SyncRunStatus,
	VisualizationType,
} from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { QuestionsService } from "../questions/questions.service";
import {
	classifyMetricAudit,
	type MetricAuditObservation,
} from "./metric-catalog.audit";
import { MetricCatalogClient } from "./metric-catalog.client";
import {
	catalogCanonicalQuestionNumber,
	catalogEvidenceFor,
} from "./metric-catalog.evidence";
import {
	type CatalogCandidate,
	catalogCandidates,
	normalizedMetricName,
} from "./metric-catalog.parser";
import { catalogQuestionSpec } from "./metric-catalog.questions";
import { resolveCatalogSources } from "./metric-catalog.sources";

const DEFAULT_SPREADSHEET_ID = "17oWmJqYGxWwHEbdVhvo1OCHLAUEv03bljDuPHaqGHwU";
const SOURCE_KEY = "google-sheets:q3-metrics-planning";
const DRAFT_SOURCE_KEY = "atlas:metric-catalog";
const FRESHNESS_MS = 24 * 60 * 60 * 1000;

const METRIC_ALIASES: Record<string, string> = {
	"website visitors": "marketing.website_visitors",
	"active professional org": "product.monthly_professional_organizations",
	"active professional orgs": "product.monthly_professional_organizations",
	"activated org": "product.monthly_activated_organizations",
	"activated orgs": "product.monthly_activated_organizations",
	"first gen orgs returning on a 2nd day in 14d":
		"product.first_generation_14d_activation",
	"first gen orgs activated in 14d": "product.first_generation_14d_activation",
	"activated org months reaching professional":
		"product.activated_to_professional_rate",
	"30d product led subscription conversion":
		"product.product_led_subscription_conversion_30d",
	"m3 professional org requalification":
		"product.m3_professional_requalification",
	"accrued value from professional orgs":
		"product.professional_organization_accrued_value",
	"m3 accrued ndr": "product.m3_accrued_ndr",
	"generation completion rate": "product.generation_completion_rate",
	"accrued professional org months paid qualified":
		"product.accrued_professional_paid_qualified",
	"generation upvote rate the percentage of rated generations that users mark positively":
		"product.generation_upvote_rate",
	"feedback coverage rate": "product.feedback_coverage_rate",
};

type MetricMatch = {
	id: string;
	key: string;
	name: string;
	status: MetricLifecycleStatus;
	versions: Array<{
		id: string;
		snapshots: Array<{ trustStatus: MetricTrustStatus }>;
		questions: Array<{ id: string; number: number; status: QuestionStatus }>;
	}>;
};

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function month(): string {
	return new Date().toISOString().slice(0, 7);
}

function errorMessage(error: unknown): string {
	return error instanceof Error
		? error.message
		: "Unknown KPI catalog sync error.";
}

function enumKind(kind: CatalogCandidate["kind"]): MetricCatalogKind {
	return MetricCatalogKind[kind];
}

function readinessFor(
	candidate: CatalogCandidate,
	metric: MetricMatch | undefined,
): MetricReadinessStatus {
	if (!metric) {
		return MetricReadinessStatus[candidate.readinessHint];
	}
	const latest = metric.versions[0];
	const snapshot = latest?.snapshots[0];
	if (
		metric.status === MetricLifecycleStatus.CERTIFIED &&
		snapshot?.trustStatus === MetricTrustStatus.VERIFIED
	) {
		return MetricReadinessStatus.VERIFIED;
	}
	if (snapshot) return MetricReadinessStatus.RECONCILING;
	if (latest) return MetricReadinessStatus.IMPLEMENTING;
	return MetricReadinessStatus.READY_TO_IMPLEMENT;
}

const READINESS_PROGRESS: Partial<Record<MetricReadinessStatus, number>> = {
	[MetricReadinessStatus.CATALOGED]: 0,
	[MetricReadinessStatus.NEEDS_DEFINITION]: 1,
	[MetricReadinessStatus.NEEDS_SOURCE]: 1,
	[MetricReadinessStatus.NEEDS_EVIDENCE]: 1,
	[MetricReadinessStatus.READY_TO_IMPLEMENT]: 2,
	[MetricReadinessStatus.IMPLEMENTING]: 3,
	[MetricReadinessStatus.RECONCILING]: 4,
	[MetricReadinessStatus.VERIFIED]: 5,
};

export function preserveMetricReadiness(
	current: MetricReadinessStatus | undefined,
	imported: MetricReadinessStatus,
): MetricReadinessStatus {
	if (!current) return imported;
	if (current === MetricReadinessStatus.BLOCKED) return current;
	const currentProgress = READINESS_PROGRESS[current] ?? 0;
	const importedProgress = READINESS_PROGRESS[imported] ?? 0;
	return importedProgress >= currentProgress ? imported : current;
}

export function resolveMetricCatalogReadiness(
	current: MetricReadinessStatus | undefined,
	imported: MetricReadinessStatus,
	hasGovernedMetric: boolean,
): MetricReadinessStatus {
	if (current === MetricReadinessStatus.BLOCKED) return current;
	return hasGovernedMetric
		? imported
		: preserveMetricReadiness(current, imported);
}

function normalizeOwnerTeam(value: string | null): string {
	switch (value?.trim().toLowerCase()) {
		case "cs":
			return "Customer Success";
		case "sales":
			return "Sales";
		case "marketing":
			return "Marketing";
		case "productions":
			return "Productions";
		case "engineering":
			return "Engineering";
		case "product":
			return "Product";
		case "sync.":
		case "sync":
			return "Company";
		default:
			return value?.trim() || "Company";
	}
}

function visualizationForDisplay(
	display: string | undefined,
): VisualizationType {
	switch (display?.toLowerCase()) {
		case "number":
		case "scalar":
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
export class MetricCatalogService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly questions: QuestionsService,
	) {}

	async sync() {
		const startedAt = new Date();
		const spreadsheetId =
			process.env.KPI_CATALOG_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
		const source = await this.db.dataSource.upsert({
			where: { key: SOURCE_KEY },
			create: {
				key: SOURCE_KEY,
				kind: DataSourceKind.GOOGLE_SHEETS,
				label: "Q3 metrics and planning",
				state: SourceStatus.SYNCING,
			},
			update: { state: SourceStatus.SYNCING, lastError: null },
		});
		const run = await this.db.syncRun.create({
			data: {
				runKey: `${SOURCE_KEY}:${startedAt.toISOString()}:${randomUUID()}`,
				sourceId: source.id,
				mode: SyncMode.INCREMENTAL,
				status: SyncRunStatus.RUNNING,
				scope: "metric-catalog",
				period: month(),
			},
		});

		try {
			const workbook = await new MetricCatalogClient().workbook(spreadsheetId);
			const candidates = catalogCandidates(workbook.sheets);
			const evidenceQuestionNumbers = [
				...new Set(
					candidates.flatMap((candidate) =>
						catalogEvidenceFor(candidate).map(
							(evidence) => evidence.questionNumber,
						),
					),
				),
			];
			const [metrics, existing, evidenceQuestions, draftSource, maxQuestion] =
				await Promise.all([
					this.metrics(),
					this.db.metricCatalogEntry.findMany({
						where: { sourceDocumentId: workbook.id },
						select: {
							externalKey: true,
							kind: true,
							readiness: true,
							metricId: true,
							canonicalQuestionId: true,
							canonicalQuestion: {
								select: { id: true, number: true, status: true },
							},
						},
					}),
					this.db.question.findMany({
						where: { number: { in: evidenceQuestionNumbers } },
						select: { id: true, number: true, status: true },
					}),
					this.db.dataSource.upsert({
						where: { key: DRAFT_SOURCE_KEY },
						create: {
							key: DRAFT_SOURCE_KEY,
							kind: DataSourceKind.ATLAS,
							label: "Atlas metric catalog",
							state: SourceStatus.HEALTHY,
						},
						update: { state: SourceStatus.HEALTHY, lastError: null },
					}),
					this.db.question.aggregate({ _max: { number: true } }),
				]);
			const existingByKey = new Map(
				existing.map((entry) => [entry.externalKey, entry]),
			);
			const evidenceQuestionByNumber = new Map(
				evidenceQuestions.map((question) => [question.number, question]),
			);
			let nextQuestionNumber = (maxQuestion._max.number ?? 0) + 1;
			const now = new Date();
			for (const candidate of candidates) {
				const current = existingByKey.get(candidate.externalKey);
				const kind =
					current?.kind && current.kind !== MetricCatalogKind.UNCLASSIFIED
						? current.kind
						: enumKind(candidate.kind);
				const metric = this.matchMetric(candidate, metrics, current?.metricId);
				const importedReadiness = readinessFor(candidate, metric);
				const readiness = resolveMetricCatalogReadiness(
					current?.readiness,
					importedReadiness,
					Boolean(metric),
				);
				const explicitQuestionNumber =
					catalogCanonicalQuestionNumber(candidate);
				const explicitQuestion = explicitQuestionNumber
					? evidenceQuestionByNumber.get(explicitQuestionNumber)
					: null;
				const metricQuestion = metric?.versions[0]?.questions[0] ?? null;
				const selectedQuestion =
					kind === MetricCatalogKind.KPI
						? (metricQuestion ??
							explicitQuestion ??
							current?.canonicalQuestion ??
							(await this.ensureDraftQuestion({
								candidate,
								sourceId: draftSource.id,
								number: nextQuestionNumber,
							})))
						: null;
				const canonicalQuestion = selectedQuestion
					? await this.materializeCatalogQuestion(candidate, selectedQuestion)
					: null;
				if (
					selectedQuestion &&
					selectedQuestion.number === nextQuestionNumber &&
					selectedQuestion.status === QuestionStatus.DRAFT
				) {
					nextQuestionNumber += 1;
				}
				const contentHash = hash({
					title: candidate.title,
					description: candidate.description,
					ownerTeam: candidate.ownerTeam,
					sourceHint: candidate.sourceHint,
					trackability: candidate.trackability,
					kind,
					rawRow: candidate.rawRow,
				});
				const entry = await this.db.metricCatalogEntry.upsert({
					where: {
						sourceDocumentId_externalKey: {
							sourceDocumentId: workbook.id,
							externalKey: candidate.externalKey,
						},
					},
					create: {
						sourceId: source.id,
						sourceDocumentId: workbook.id,
						sourceTabId: candidate.sourceTabId,
						sourceTabName: candidate.sourceTabName,
						sourceTabIndex: candidate.sourceTabIndex,
						sourceRange: candidate.sourceRange,
						sourceRow: candidate.sourceRow,
						externalKey: candidate.externalKey,
						title: candidate.title,
						description: candidate.description,
						ownerTeam: candidate.ownerTeam,
						sourceHint: candidate.sourceHint,
						trackability: candidate.trackability,
						kind,
						readiness,
						metricId: metric?.id,
						canonicalQuestionId: canonicalQuestion?.id,
						rawRow: json(candidate.rawRow),
						ambiguities: json(candidate.ambiguities),
						contentHash,
						lastSeenAt: now,
					},
					update: {
						sourceId: source.id,
						sourceTabName: candidate.sourceTabName,
						sourceTabIndex: candidate.sourceTabIndex,
						sourceRange: candidate.sourceRange,
						sourceRow: candidate.sourceRow,
						title: candidate.title,
						description: candidate.description,
						ownerTeam: candidate.ownerTeam,
						sourceHint: candidate.sourceHint,
						trackability: candidate.trackability,
						kind,
						readiness,
						metricId: current?.metricId ?? metric?.id,
						canonicalQuestionId: canonicalQuestion?.id ?? null,
						rawRow: json(candidate.rawRow),
						ambiguities: json(candidate.ambiguities),
						contentHash,
						lastSeenAt: now,
						missingAt: null,
					},
				});
				const evidence = catalogEvidenceFor(candidate).flatMap((item) => {
					const question = evidenceQuestionByNumber.get(item.questionNumber);
					return question ? [{ ...item, questionId: question.id }] : [];
				});
				await this.db.metricCatalogEvidence.deleteMany({
					where: {
						catalogEntryId: entry.id,
						kind: "CANDIDATE_RESULT",
						questionId: { notIn: evidence.map((item) => item.questionId) },
					},
				});
				for (const item of evidence) {
					await this.db.metricCatalogEvidence.upsert({
						where: {
							catalogEntryId_questionId_kind: {
								catalogEntryId: entry.id,
								questionId: item.questionId,
								kind: "CANDIDATE_RESULT",
							},
						},
						create: {
							catalogEntryId: entry.id,
							questionId: item.questionId,
							kind: "CANDIDATE_RESULT",
							rationale: item.rationale,
						},
						update: { rationale: item.rationale },
					});
				}
			}
			await this.db.question.updateMany({
				where: {
					sourceId: draftSource.id,
					status: QuestionStatus.DRAFT,
					canonicalCatalogEntries: {
						none: { kind: MetricCatalogKind.KPI, missingAt: null },
					},
				},
				data: { status: QuestionStatus.ARCHIVED },
			});

			const keys = candidates.map((candidate) => candidate.externalKey);
			await this.db.metricCatalogEntry.updateMany({
				where: {
					sourceDocumentId: workbook.id,
					externalKey: { notIn: keys },
					missingAt: null,
				},
				data: { missingAt: now },
			});
			await this.syncTeamDashboards();
			const workbookHash = hash(
				candidates.map((candidate) => [
					candidate.externalKey,
					candidate.rawRow,
				]),
			);
			await this.db.$transaction([
				this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: SyncRunStatus.COMPLETED,
						recordsProcessed: candidates.length,
						checkpoint: json({
							spreadsheetId: workbook.id,
							tabs: workbook.sheets.length,
							contentHash: workbookHash,
						}),
						dataThrough: now,
						finishedAt: now,
					},
				}),
				this.db.dataSource.update({
					where: { id: source.id },
					data: {
						state: SourceStatus.HEALTHY,
						lastSyncAt: now,
						lastError: null,
						freshnessDeadlineAt: new Date(now.getTime() + FRESHNESS_MS),
					},
				}),
			]);
			return {
				workbook: workbook.title,
				tabs: workbook.sheets.length,
				entries: candidates.length,
				contentHash: workbookHash,
				syncedAt: now.toISOString(),
			};
		} catch (error) {
			const message = errorMessage(error);
			const failedAt = new Date();
			await this.db.$transaction([
				this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: SyncRunStatus.FAILED,
						error: message,
						finishedAt: failedAt,
					},
				}),
				this.db.dataSource.update({
					where: { id: source.id },
					data: { state: SourceStatus.ERROR, lastError: message },
				}),
			]);
			throw error;
		}
	}

	async list() {
		const [entries, sourceStates] = await Promise.all([
			this.db.metricCatalogEntry.findMany({
				where: { missingAt: null },
				orderBy: [{ sourceTabIndex: "asc" }, { sourceRow: "asc" }],
				select: {
					id: true,
					sourceTabId: true,
					sourceTabName: true,
					sourceRange: true,
					sourceRow: true,
					title: true,
					description: true,
					ownerTeam: true,
					sourceHint: true,
					trackability: true,
					kind: true,
					readiness: true,
					ambiguities: true,
					lastSeenAt: true,
					canonicalQuestion: {
						select: {
							number: true,
							name: true,
							status: true,
						},
					},
					attempts: {
						orderBy: { attemptedAt: "desc" },
						take: 1,
						select: {
							outcome: true,
							trustStatus: true,
							detail: true,
							observations: true,
							attemptedAt: true,
						},
					},
					evidence: {
						orderBy: { question: { number: "asc" } },
						select: {
							id: true,
							rationale: true,
							question: {
								select: {
									number: true,
									name: true,
									sourceExternalId: true,
									metricVersion: {
										select: {
											snapshots: {
												orderBy: { computedAt: "desc" },
												take: 1,
												select: {
													trustStatus: true,
													dataThrough: true,
													computedAt: true,
													rowCount: true,
												},
											},
										},
									},
								},
							},
						},
					},
					metric: {
						select: {
							key: true,
							name: true,
							status: true,
							versions: {
								orderBy: { version: "desc" },
								take: 1,
								select: {
									questions: {
										orderBy: { number: "asc" },
										take: 1,
										select: { number: true },
									},
								},
							},
						},
					},
				},
			}),
			this.db.dataSource.findMany({ select: { key: true, state: true } }),
		]);
		const externalIds = [
			...new Set(
				entries.flatMap((entry) =>
					entry.evidence.flatMap((evidence) =>
						evidence.question.sourceExternalId
							? [evidence.question.sourceExternalId]
							: [],
					),
				),
			),
		];
		const resultSnapshots = await this.db.resultSnapshot.findMany({
			where: { questionExternalId: { in: externalIds } },
			orderBy: { capturedAt: "desc" },
			select: {
				questionExternalId: true,
				capturedAt: true,
				rowCount: true,
			},
		});
		const latestResultByExternalId = new Map<
			string,
			(typeof resultSnapshots)[number]
		>();
		for (const snapshot of resultSnapshots) {
			if (!latestResultByExternalId.has(snapshot.questionExternalId)) {
				latestResultByExternalId.set(snapshot.questionExternalId, snapshot);
			}
		}
		return entries.map((entry) => ({
			...entry,
			latestAttempt: entry.attempts[0]
				? {
						...entry.attempts[0],
						attemptedAt: entry.attempts[0].attemptedAt.toISOString(),
					}
				: null,
			attempts: undefined,
			evidence: entry.evidence.map((evidence) => {
				const metricSnapshot = evidence.question.metricVersion?.snapshots[0];
				const resultSnapshot = evidence.question.sourceExternalId
					? latestResultByExternalId.get(evidence.question.sourceExternalId)
					: null;
				return {
					id: evidence.id,
					rationale: evidence.rationale,
					questionNumber: evidence.question.number,
					questionName: evidence.question.name,
					state: metricSnapshot?.trustStatus ?? "AVAILABLE",
					dataThrough:
						metricSnapshot?.dataThrough.toISOString() ??
						resultSnapshot?.capturedAt.toISOString() ??
						null,
					computedAt:
						metricSnapshot?.computedAt.toISOString() ??
						resultSnapshot?.capturedAt.toISOString() ??
						null,
					rowCount:
						metricSnapshot?.rowCount ?? resultSnapshot?.rowCount ?? null,
				};
			}),
			sourceCandidates: resolveCatalogSources(entry, sourceStates),
			metric: entry.metric
				? {
						key: entry.metric.key,
						name: entry.metric.name,
						status: entry.metric.status,
						questionNumber:
							entry.metric.versions[0]?.questions[0]?.number ?? null,
					}
				: null,
			lastSeenAt: entry.lastSeenAt.toISOString(),
		}));
	}

	async summary() {
		const [entries, source, sourceStates] = await Promise.all([
			this.db.metricCatalogEntry.findMany({
				where: { missingAt: null },
				select: {
					title: true,
					description: true,
					ownerTeam: true,
					sourceHint: true,
					kind: true,
					readiness: true,
					metricId: true,
					canonicalQuestionId: true,
					ambiguities: true,
					sourceTabName: true,
					evidence: { select: { id: true } },
					attempts: {
						orderBy: { attemptedAt: "desc" },
						take: 1,
						select: {
							outcome: true,
							trustStatus: true,
							attemptedAt: true,
						},
					},
				},
			}),
			this.db.dataSource.findUnique({
				where: { key: SOURCE_KEY },
				select: {
					state: true,
					lastSyncAt: true,
					lastError: true,
					freshnessDeadlineAt: true,
				},
			}),
			this.db.dataSource.findMany({ select: { key: true, state: true } }),
		]);
		const byKind = countBy(entries.map((entry) => entry.kind));
		const byReadiness = countBy(entries.map((entry) => entry.readiness));
		const kpis = entries.filter(
			(entry) => entry.kind === MetricCatalogKind.KPI,
		);
		const projectOutcomes = entries.filter(
			(entry) => entry.kind === MetricCatalogKind.ROADMAP_MEASURE,
		);
		const tabs = new Set(entries.map((entry) => entry.sourceTabName));
		const ambiguous = entries.filter(
			(entry) =>
				Array.isArray(entry.ambiguities) && entry.ambiguities.length > 0,
		).length;
		const kpiWithEvidence = kpis.filter(
			(entry) => entry.metricId || entry.evidence.length > 0,
		).length;
		const kpiAttempts = kpis.flatMap((entry) => entry.attempts.slice(0, 1));
		const outcomeAttempts = projectOutcomes.flatMap((entry) =>
			entry.attempts.slice(0, 1),
		);
		const lastAuditAt = kpiAttempts.reduce<Date | null>(
			(latest, attempt) =>
				!latest || attempt.attemptedAt > latest ? attempt.attemptedAt : latest,
			null,
		);
		const lastOutcomeAuditAt = outcomeAttempts.reduce<Date | null>(
			(latest, attempt) =>
				!latest || attempt.attemptedAt > latest ? attempt.attemptedAt : latest,
			null,
		);
		const sourceCandidates = entries.map((entry) =>
			resolveCatalogSources(entry, sourceStates),
		);
		const sourceConnected = sourceCandidates.filter((candidates) =>
			candidates.some((candidate) => candidate.state === "CONNECTED"),
		).length;
		const sourceAttention = sourceCandidates.filter(
			(candidates) =>
				!candidates.some((candidate) => candidate.state === "CONNECTED") &&
				candidates.some((candidate) => candidate.state === "ATTENTION"),
		).length;
		const sourceMissing = sourceCandidates.filter(
			(candidates) =>
				candidates.length > 0 &&
				candidates.every((candidate) => candidate.state === "MISSING"),
		).length;
		return {
			total: entries.length,
			tabs: tabs.size,
			mapped: entries.filter((entry) => entry.metricId).length,
			kpiTotal: kpis.length,
			kpiMapped: kpis.filter((entry) => entry.metricId).length,
			kpiQuestions: kpis.filter((entry) => entry.canonicalQuestionId).length,
			kpiWithEvidence,
			kpiAttempted: kpiAttempts.length,
			kpiDataFound: kpiAttempts.filter(
				(attempt) => attempt.outcome === MetricCatalogAttemptOutcome.DATA_FOUND,
			).length,
			kpiQueryFailed: kpiAttempts.filter(
				(attempt) =>
					attempt.outcome === MetricCatalogAttemptOutcome.QUERY_FAILED,
			).length,
			kpiQueryNotBuilt: kpiAttempts.filter(
				(attempt) =>
					attempt.outcome === MetricCatalogAttemptOutcome.QUERY_NOT_BUILT,
			).length,
			kpiSourceBlocked: kpiAttempts.filter(
				(attempt) =>
					attempt.outcome === MetricCatalogAttemptOutcome.SOURCE_MISSING ||
					attempt.outcome === MetricCatalogAttemptOutcome.SOURCE_ERROR ||
					attempt.outcome === MetricCatalogAttemptOutcome.SOURCE_UNKNOWN,
			).length,
			lastAuditAt: lastAuditAt?.toISOString() ?? null,
			projectOutcomeTotal: projectOutcomes.length,
			projectOutcomeAttempted: outcomeAttempts.length,
			projectOutcomeEvidenceFound: outcomeAttempts.filter(
				(attempt) => attempt.outcome === MetricCatalogAttemptOutcome.DATA_FOUND,
			).length,
			projectOutcomeVerified: projectOutcomes.filter(
				(entry) => entry.readiness === MetricReadinessStatus.VERIFIED,
			).length,
			projectOutcomeCheckNotBuilt: outcomeAttempts.filter(
				(attempt) =>
					attempt.outcome === MetricCatalogAttemptOutcome.QUERY_NOT_BUILT ||
					attempt.outcome === MetricCatalogAttemptOutcome.QUERY_FAILED,
			).length,
			projectOutcomeSourceBlocked: outcomeAttempts.filter(
				(attempt) =>
					attempt.outcome === MetricCatalogAttemptOutcome.SOURCE_MISSING ||
					attempt.outcome === MetricCatalogAttemptOutcome.SOURCE_ERROR ||
					attempt.outcome === MetricCatalogAttemptOutcome.SOURCE_UNKNOWN,
			).length,
			lastOutcomeAuditAt: lastOutcomeAuditAt?.toISOString() ?? null,
			kpiVerified: kpis.filter(
				(entry) => entry.readiness === MetricReadinessStatus.VERIFIED,
			).length,
			ambiguous,
			kpiNeedsSource: kpis.filter(
				(entry) => entry.readiness === MetricReadinessStatus.NEEDS_SOURCE,
			).length,
			roadmapNeedsEvidence: entries.filter(
				(entry) =>
					entry.kind === MetricCatalogKind.ROADMAP_MEASURE &&
					entry.readiness === MetricReadinessStatus.NEEDS_EVIDENCE,
			).length,
			sourceConnected,
			sourceAttention,
			sourceMissing,
			sourceUnclassified: sourceCandidates.filter(
				(candidates) => candidates.length === 0,
			).length,
			byKind,
			byReadiness,
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

	async auditKpis() {
		return this.auditCatalog(MetricCatalogKind.KPI, "KPI");
	}

	async auditProjectOutcomes() {
		return this.auditCatalog(
			MetricCatalogKind.ROADMAP_MEASURE,
			"PROJECT_OUTCOME",
		);
	}

	private async auditCatalog(
		kind: MetricCatalogKind,
		subject: "KPI" | "PROJECT_OUTCOME",
	) {
		const attemptedAt = new Date();
		const runKey = `metric-catalog-audit:${kind.toLowerCase()}:${attemptedAt.toISOString()}:${randomUUID()}`;
		const [entries, sourceStates] = await Promise.all([
			this.db.metricCatalogEntry.findMany({
				where: { kind, missingAt: null },
				orderBy: [{ sourceTabIndex: "asc" }, { sourceRow: "asc" }],
				select: {
					id: true,
					title: true,
					description: true,
					ownerTeam: true,
					sourceTabName: true,
					sourceHint: true,
					trackability: true,
					kind: true,
					readiness: true,
					ambiguities: true,
					canonicalQuestion: {
						select: {
							number: true,
							name: true,
							status: true,
							metricVersion: {
								select: {
									snapshots: {
										orderBy: { computedAt: "desc" },
										take: 1,
										select: {
											trustStatus: true,
											dataThrough: true,
										},
									},
								},
							},
							versions: {
								orderBy: { version: "desc" },
								take: 1,
								select: { queryLanguage: true, queryText: true },
							},
						},
					},
				},
			}),
			this.db.dataSource.findMany({ select: { key: true, state: true } }),
		]);

		const questionResults = new Map<number, MetricAuditObservation>();
		for (const entry of entries) {
			const question = entry.canonicalQuestion;
			if (!question || question.status !== QuestionStatus.ACTIVE) continue;
			if (questionResults.has(question.number)) continue;
			const version = question.versions[0];
			const snapshot = question.metricVersion?.snapshots[0];
			if (!version) {
				questionResults.set(question.number, {
					questionNumber: question.number,
					questionName: question.name,
					outcome: "QUERY_FAILED",
					rowCount: null,
					durationMs: null,
					error: "The canonical question has no saved query version.",
					dataThrough: snapshot?.dataThrough.toISOString() ?? null,
					questionTrust: snapshot?.trustStatus ?? null,
				});
				continue;
			}
			try {
				const result = await this.questions.preview({
					number: question.number,
					queryLanguage: version.queryLanguage,
					queryText: version.queryText,
				});
				questionResults.set(question.number, {
					questionNumber: question.number,
					questionName: question.name,
					outcome: result.rowCount > 0 ? "DATA_FOUND" : "NO_ROWS",
					rowCount: result.rowCount,
					durationMs: result.durationMs,
					error: null,
					dataThrough: snapshot?.dataThrough.toISOString() ?? null,
					questionTrust: snapshot?.trustStatus ?? null,
				});
			} catch (error) {
				questionResults.set(question.number, {
					questionNumber: question.number,
					questionName: question.name,
					outcome: "QUERY_FAILED",
					rowCount: null,
					durationMs: null,
					error: errorMessage(error).slice(0, 500),
					dataThrough: snapshot?.dataThrough.toISOString() ?? null,
					questionTrust: snapshot?.trustStatus ?? null,
				});
			}
		}

		const attempts = entries.map((entry) => {
			const observation = entry.canonicalQuestion
				? questionResults.get(entry.canonicalQuestion.number)
				: null;
			const observations = observation ? [observation] : [];
			const sources = resolveCatalogSources(entry, sourceStates);
			const decisionCount = Array.isArray(entry.ambiguities)
				? entry.ambiguities.length
				: 0;
			const result = classifyMetricAudit({
				subject,
				readiness: entry.readiness,
				decisionCount,
				observations,
				sources,
			});
			return {
				entry,
				observations,
				result,
			};
		});

		await this.db.$transaction(
			attempts.map(({ entry, observations, result }) =>
				this.db.metricCatalogAttempt.create({
					data: {
						catalogEntryId: entry.id,
						runKey,
						outcome: result.outcome,
						trustStatus: result.trustStatus,
						detail: result.detail,
						observations: json(observations),
						attemptedAt,
					},
				}),
			),
		);

		return {
			runKey,
			attemptedAt: attemptedAt.toISOString(),
			total: attempts.length,
			byOutcome: countBy(attempts.map(({ result }) => result.outcome)),
			byTrust: countBy(attempts.map(({ result }) => result.trustStatus)),
		};
	}

	private async ensureDraftQuestion(input: {
		candidate: CatalogCandidate;
		sourceId: string;
		number: number;
	}) {
		const sourceExternalId = `catalog:kpi:${input.candidate.externalKey}`;
		const existing = await this.db.question.findUnique({
			where: {
				connector_sourceExternalId: {
					connector: DataSourceKind.ATLAS,
					sourceExternalId,
				},
			},
			select: { id: true, number: true, status: true },
		});
		if (existing) return existing;

		const decisions = input.candidate.ambiguities.map(
			(ambiguity) => ambiguity.label,
		);
		const description = [
			input.candidate.description,
			decisions.length > 0
				? `Open decisions: ${decisions.join(" ")}`
				: "Atlas still needs a runnable source query for this KPI.",
		]
			.filter(Boolean)
			.join(" ");

		return this.db.question.create({
			data: {
				number: input.number,
				name: input.candidate.title,
				description,
				connector: DataSourceKind.ATLAS,
				sourceId: input.sourceId,
				sourceExternalId,
				status: QuestionStatus.DRAFT,
				purpose: QuestionPurpose.RECONCILIATION,
				versions: {
					create: {
						version: 1,
						queryLanguage: QueryLanguage.API,
						queryText: `catalog:draft:${input.candidate.externalKey}`,
						display: "table",
						visualization: json({}),
						createdBy: "atlas",
					},
				},
			},
			select: { id: true, number: true, status: true },
		});
	}

	private async materializeCatalogQuestion(
		candidate: CatalogCandidate,
		question: { id: string; number: number; status: QuestionStatus },
	) {
		const spec = catalogQuestionSpec(candidate);
		if (!spec) return question;
		const [source, current] = await Promise.all([
			this.db.dataSource.findUnique({
				where: { key: spec.sourceKey },
				select: { id: true },
			}),
			this.db.question.findUnique({
				where: { id: question.id },
				select: {
					id: true,
					number: true,
					status: true,
					connector: true,
					sourceId: true,
					databaseExternalId: true,
					versions: {
						orderBy: { version: "desc" },
						take: 1,
						select: {
							version: true,
							queryLanguage: true,
							queryText: true,
							display: true,
							visualization: true,
						},
					},
				},
			}),
		]);
		if (!source || !current) return question;
		const decisions = candidate.ambiguities.map((item) => item.label);
		const description = [
			candidate.description,
			spec.provisionalDefinition,
			decisions.length > 0 ? `Decision needed: ${decisions.join(" ")}` : null,
		]
			.filter(Boolean)
			.join(" ");
		const latest = current.versions[0];
		const queryChanged =
			!latest ||
			latest.queryLanguage !== spec.queryLanguage ||
			latest.queryText !== spec.queryText ||
			latest.display !== spec.display ||
			JSON.stringify(latest.visualization) !==
				JSON.stringify(spec.visualization);
		await this.db.$transaction(async (tx) => {
			await tx.question.update({
				where: { id: question.id },
				data: {
					name: candidate.title,
					description,
					connector: spec.connector,
					sourceId: source.id,
					databaseExternalId: spec.databaseExternalId,
					status: QuestionStatus.ACTIVE,
					purpose: QuestionPurpose.RECONCILIATION,
				},
			});
			if (queryChanged) {
				await tx.questionVersion.create({
					data: {
						questionId: question.id,
						version: (latest?.version ?? 0) + 1,
						queryLanguage: spec.queryLanguage,
						queryText: spec.queryText,
						display: spec.display,
						visualization: json(spec.visualization),
						createdBy: "atlas",
					},
				});
			}
		});
		return {
			id: current.id,
			number: current.number,
			status: QuestionStatus.ACTIVE,
		};
	}

	private async syncTeamDashboards() {
		const entries = await this.db.metricCatalogEntry.findMany({
			where: {
				missingAt: null,
				kind: MetricCatalogKind.KPI,
				canonicalQuestionId: { not: null },
			},
			select: {
				ownerTeam: true,
				canonicalQuestionId: true,
				canonicalQuestion: {
					select: {
						versions: {
							orderBy: { version: "desc" },
							take: 1,
							select: { display: true },
						},
					},
				},
			},
			orderBy: [{ ownerTeam: "asc" }, { sourceRow: "asc" }],
		});
		const configurations = [
			{
				team: "Product",
				dashboardNumber: 1,
				dashboardName: "Product 2026 Scoreboard",
				tabNumber: 7,
			},
			{
				team: "Marketing",
				dashboardNumber: 3,
				dashboardName: "Marketing acquisition & conversion",
				tabNumber: 4,
			},
			{
				team: "Sales",
				dashboardNumber: 4,
				dashboardName: "Sales pipeline & bookings",
				tabNumber: 5,
			},
			{
				team: "Company",
				dashboardNumber: 8,
				dashboardName: "Company KPIs",
				tabNumber: 1,
			},
			{
				team: "Customer Success",
				dashboardNumber: 9,
				dashboardName: "Customer Success KPIs",
				tabNumber: 1,
			},
			{
				team: "Productions",
				dashboardNumber: 10,
				dashboardName: "Productions KPIs",
				tabNumber: 1,
			},
			{
				team: "Engineering",
				dashboardNumber: 11,
				dashboardName: "Engineering KPIs",
				tabNumber: 1,
			},
		] as const;
		for (const configuration of configurations) {
			const teamEntries = entries.filter(
				(entry) =>
					normalizeOwnerTeam(entry.ownerTeam) === configuration.team &&
					entry.canonicalQuestionId,
			);
			if (teamEntries.length === 0) continue;
			const dashboard = await this.db.dashboard.upsert({
				where: { number: configuration.dashboardNumber },
				create: {
					number: configuration.dashboardNumber,
					name: configuration.dashboardName,
					description: `${configuration.team} KPI catalog. Each card links to its governed Atlas question and current verification state.`,
					createdBy: "atlas",
				},
				update: {},
				select: { id: true },
			});
			const tab = await this.db.dashboardTab.upsert({
				where: {
					dashboardId_number: {
						dashboardId: dashboard.id,
						number: configuration.tabNumber,
					},
				},
				create: {
					dashboardId: dashboard.id,
					number: configuration.tabNumber,
					name: "KPI catalog",
					position: configuration.tabNumber - 1,
				},
				update: { name: "KPI catalog" },
				select: { id: true },
			});
			const existingCards = await this.db.dashboardCard.findMany({
				where: { tabId: tab.id },
				select: { id: true, questionId: true, position: true },
			});
			const expectedQuestionIds = teamEntries.flatMap((entry) =>
				entry.canonicalQuestionId ? [entry.canonicalQuestionId] : [],
			);
			await this.db.dashboardCard.deleteMany({
				where: {
					tabId: tab.id,
					questionId: { notIn: expectedQuestionIds },
				},
			});
			const existingQuestionIds = new Set(
				existingCards.map((card) => card.questionId),
			);
			let position =
				existingCards.reduce(
					(maximum, card) => Math.max(maximum, card.position),
					-1,
				) + 1;
			for (const entry of teamEntries) {
				if (
					!entry.canonicalQuestionId ||
					existingQuestionIds.has(entry.canonicalQuestionId)
				) {
					continue;
				}
				const display = entry.canonicalQuestion?.versions[0]?.display;
				await this.db.dashboardCard.create({
					data: {
						dashboardId: dashboard.id,
						tabId: tab.id,
						questionId: entry.canonicalQuestionId,
						position,
						x: (position % 2) * 12,
						y: Math.floor(position / 2) * 6,
						width: 12,
						height: 6,
						visualization: visualizationForDisplay(display),
					},
				});
				position += 1;
			}
		}
	}

	private async metrics(): Promise<MetricMatch[]> {
		return this.db.metricDefinition.findMany({
			select: {
				id: true,
				key: true,
				name: true,
				status: true,
				versions: {
					orderBy: { version: "desc" },
					take: 1,
					select: {
						id: true,
						questions: {
							where: { status: QuestionStatus.ACTIVE },
							orderBy: { number: "asc" },
							take: 1,
							select: { id: true, number: true, status: true },
						},
						snapshots: {
							orderBy: { computedAt: "desc" },
							take: 1,
							select: { trustStatus: true },
						},
					},
				},
			},
		});
	}

	private matchMetric(
		candidate: CatalogCandidate,
		metrics: MetricMatch[],
		currentMetricId?: string | null,
	): MetricMatch | undefined {
		if (currentMetricId) {
			const current = metrics.find((metric) => metric.id === currentMetricId);
			if (current) return current;
		}
		const normalized = normalizedMetricName(candidate.title);
		const alias = METRIC_ALIASES[normalized];
		if (alias) return metrics.find((metric) => metric.key === alias);
		return metrics.find(
			(metric) =>
				normalizedMetricName(metric.name) === normalized ||
				normalizedMetricName(metric.key) === normalized,
		);
	}
}

function countBy(values: string[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return counts;
}
