import { createHash, randomUUID } from "node:crypto";
import {
	DataSourceKind,
	type Db,
	MetricCatalogKind,
	MetricLifecycleStatus,
	MetricReadinessStatus,
	MetricTrustStatus,
	type Prisma,
	SourceStatus,
	SyncMode,
	SyncRunStatus,
} from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { MetricCatalogClient } from "./metric-catalog.client";
import {
	type CatalogCandidate,
	catalogCandidates,
	normalizedMetricName,
} from "./metric-catalog.parser";

const DEFAULT_SPREADSHEET_ID = "17oWmJqYGxWwHEbdVhvo1OCHLAUEv03bljDuPHaqGHwU";
const SOURCE_KEY = "google-sheets:q3-metrics-planning";
const FRESHNESS_MS = 24 * 60 * 60 * 1000;

const METRIC_ALIASES: Record<string, string> = {
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
};

type MetricMatch = {
	id: string;
	key: string;
	name: string;
	status: MetricLifecycleStatus;
	versions: Array<{
		id: string;
		snapshots: Array<{ trustStatus: MetricTrustStatus }>;
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

@Injectable()
export class MetricCatalogService {
	constructor(@InjectDatabase() private readonly db: Db) {}

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
			const [metrics, existing] = await Promise.all([
				this.metrics(),
				this.db.metricCatalogEntry.findMany({
					where: { sourceDocumentId: workbook.id },
					select: {
						externalKey: true,
						kind: true,
						readiness: true,
						metricId: true,
					},
				}),
			]);
			const existingByKey = new Map(
				existing.map((entry) => [entry.externalKey, entry]),
			);
			const now = new Date();
			for (const candidate of candidates) {
				const current = existingByKey.get(candidate.externalKey);
				const metric = this.matchMetric(candidate, metrics, current?.metricId);
				const importedReadiness = readinessFor(candidate, metric);
				const readiness = this.preserveReadiness(
					current?.readiness,
					importedReadiness,
				);
				const kind =
					current?.kind && current.kind !== MetricCatalogKind.UNCLASSIFIED
						? current.kind
						: enumKind(candidate.kind);
				const contentHash = hash({
					title: candidate.title,
					description: candidate.description,
					ownerTeam: candidate.ownerTeam,
					sourceHint: candidate.sourceHint,
					trackability: candidate.trackability,
					kind,
					rawRow: candidate.rawRow,
				});
				await this.db.metricCatalogEntry.upsert({
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
						rawRow: json(candidate.rawRow),
						ambiguities: json(candidate.ambiguities),
						contentHash,
						lastSeenAt: now,
						missingAt: null,
					},
				});
			}

			const keys = candidates.map((candidate) => candidate.externalKey);
			await this.db.metricCatalogEntry.updateMany({
				where: {
					sourceDocumentId: workbook.id,
					externalKey: { notIn: keys },
					missingAt: null,
				},
				data: { missingAt: now },
			});
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
		const entries = await this.db.metricCatalogEntry.findMany({
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
				metric: { select: { key: true, name: true, status: true } },
			},
		});
		return entries.map((entry) => ({
			...entry,
			lastSeenAt: entry.lastSeenAt.toISOString(),
		}));
	}

	async summary() {
		const [entries, source] = await Promise.all([
			this.db.metricCatalogEntry.findMany({
				where: { missingAt: null },
				select: {
					kind: true,
					readiness: true,
					metricId: true,
					ambiguities: true,
					sourceTabName: true,
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
		]);
		const byKind = countBy(entries.map((entry) => entry.kind));
		const byReadiness = countBy(entries.map((entry) => entry.readiness));
		const kpis = entries.filter(
			(entry) => entry.kind === MetricCatalogKind.KPI,
		);
		const tabs = new Set(entries.map((entry) => entry.sourceTabName));
		const ambiguous = entries.filter(
			(entry) =>
				Array.isArray(entry.ambiguities) && entry.ambiguities.length > 0,
		).length;
		return {
			total: entries.length,
			tabs: tabs.size,
			mapped: entries.filter((entry) => entry.metricId).length,
			kpiTotal: kpis.length,
			kpiMapped: kpis.filter((entry) => entry.metricId).length,
			kpiVerified: kpis.filter(
				(entry) => entry.readiness === MetricReadinessStatus.VERIFIED,
			).length,
			ambiguous,
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

	private preserveReadiness(
		current: MetricReadinessStatus | undefined,
		imported: MetricReadinessStatus,
	): MetricReadinessStatus {
		if (
			current &&
			current !== MetricReadinessStatus.CATALOGED &&
			current !== MetricReadinessStatus.NEEDS_DEFINITION
		) {
			return current;
		}
		return imported;
	}
}

function countBy(values: string[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return counts;
}
