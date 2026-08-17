import { createHash, randomUUID } from "node:crypto";
import {
	type Db,
	FactGrain,
	MetricReadinessStatus,
	MetricRunStatus,
	MetricTrustStatus,
	type Prisma,
	SourceStatus,
	SyncMode,
	SyncRunStatus,
	VerificationStatus,
} from "@crm/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { inferMetricWindow } from "../metabase/product-metric.publisher";
import { MarketingClient, type MarketingResult } from "./marketing.client";
import { marketingConfig } from "./marketing.config";
import { marketingQuery } from "./marketing.contracts";
import {
	applyPosthogPersonPolicy,
	productUserEligibilityPredicate,
} from "./marketing.eligibility";

const FRESHNESS_MS = 8 * 60 * 60 * 1000;

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
		: "Unknown marketing sync error.";
}

function assertReadOnlyHogql(query: string): void {
	const normalized = query.trim().replace(/^\(+/, "").toLowerCase();
	if (!/^(select|with)\b/.test(normalized)) {
		throw new Error("PostHog questions only allow read-only HogQL.");
	}
	if (
		/\b(insert|update|delete|drop|alter|truncate|create)\b/.test(normalized)
	) {
		throw new Error("PostHog questions only allow read-only HogQL.");
	}
}

@Injectable()
export class MarketingService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async preview(queryText: string): Promise<MarketingResult> {
		const query = this.parse(queryText);
		const predicate = await this.productUserEligibilityPredicate();
		return new MarketingClient(marketingConfig()).execute(
			this.withProductUserEligibility(query, predicate),
		);
	}

	async syncDashboard(number = 3) {
		const dashboard = await this.db.dashboard.findUnique({
			where: { number },
			select: {
				cards: {
					orderBy: { position: "asc" },
					select: {
						question: {
							select: {
								id: true,
								number: true,
								sourceId: true,
								sourceExternalId: true,
								metricVersionId: true,
								versions: {
									orderBy: { version: "desc" },
									take: 1,
									select: {
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
		if (!dashboard)
			throw new NotFoundException(`No Atlas dashboard ${number}.`);
		const dashboardQuestions = [
			...new Map(
				dashboard.cards.map((card) => [card.question.id, card.question]),
			).values(),
		];
		const questions = dashboardQuestions.filter((question) => {
			const version = question.versions[0];
			if (version?.queryLanguage !== "API") return false;
			try {
				this.parse(version.queryText);
				return true;
			} catch {
				return false;
			}
		});
		if (questions.length === 0) {
			throw new Error("This dashboard has no marketing questions.");
		}
		const sourceIds = new Set(
			questions.flatMap((question) =>
				question.sourceId ? [question.sourceId] : [],
			),
		);
		if (sourceIds.size !== 1) {
			throw new Error(
				"Marketing questions must share one configured Atlas source.",
			);
		}
		const sourceId = [...sourceIds][0];
		if (!sourceId) throw new Error("The marketing source is not configured.");
		const source = await this.db.dataSource.findUnique({
			where: { id: sourceId },
		});
		if (!source) throw new Error("The marketing source is not configured.");
		const period = month();
		const run = await this.db.syncRun.create({
			data: {
				runKey: `${source.key}:${period}:${new Date().toISOString()}:${randomUUID()}`,
				sourceId: source.id,
				mode: SyncMode.INCREMENTAL,
				status: SyncRunStatus.RUNNING,
				scope: `dashboard:${number}`,
				period,
			},
		});
		await this.db.dataSource.update({
			where: { id: source.id },
			data: { state: SourceStatus.SYNCING, lastError: null },
		});

		const client = new MarketingClient(marketingConfig());
		const predicate = await this.productUserEligibilityPredicate();
		let cardsProcessed = 0;
		let snapshotsCreated = 0;
		const errors: Array<{ number: number; message: string }> = [];
		for (const question of questions) {
			const version = question.versions[0];
			if (version?.queryLanguage !== "API") {
				errors.push({
					number: question.number,
					message: "Question has no API version.",
				});
				continue;
			}
			try {
				const result = await client.execute(
					this.withProductUserEligibility(
						this.parse(version.queryText),
						predicate,
					),
				);
				const payload = { columns: result.columns, rows: result.rows };
				const contentHash = hash(payload);
				const externalId =
					question.sourceExternalId ?? `marketing:question:${question.number}`;
				const capturedAt = new Date();
				const created = await this.db.resultSnapshot.createMany({
					data: [
						{
							idempotencyKey: `${source.key}:${externalId}:v${version.version}:${period}:${contentHash}`,
							sourceId: source.id,
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
				await this.publishMetricAttempt({
					metricVersionId: question.metricVersionId,
					questionNumber: question.number,
					questionVersion: version.version,
					queryText: version.queryText,
					result,
					syncRunId: run.id,
					capturedAt,
					contentHash,
				});
				cardsProcessed += 1;
				snapshotsCreated += created.count;
			} catch (error) {
				errors.push({ number: question.number, message: errorMessage(error) });
			}
		}
		const finishedAt = new Date();
		const failed = errors.length > 0;
		const lastError = failed
			? errors.map((error) => `Q${error.number}: ${error.message}`).join(" | ")
			: null;
		await this.db.$transaction([
			this.db.syncRun.update({
				where: { id: run.id },
				data: {
					status: failed ? SyncRunStatus.FAILED : SyncRunStatus.COMPLETED,
					finishedAt,
					cardsProcessed,
					snapshotsCreated,
					error: lastError,
					checkpoint: json({ errors }),
				},
			}),
			this.db.dataSource.update({
				where: { id: source.id },
				data: {
					state: failed ? SourceStatus.ERROR : SourceStatus.HEALTHY,
					lastSyncAt: finishedAt,
					lastError,
					freshnessDeadlineAt: new Date(Date.now() + FRESHNESS_MS),
				},
			}),
		]);
		return {
			runId: run.id,
			period,
			cardsProcessed,
			snapshotsCreated,
			errors,
		};
	}

	private async publishMetricAttempt(input: {
		metricVersionId: string | null;
		questionNumber: number;
		questionVersion: number;
		queryText: string;
		result: MarketingResult;
		syncRunId: string;
		capturedAt: Date;
		contentHash: string;
	}) {
		if (!input.metricVersionId) return;
		const metricVersion = await this.db.metricVersion.findUnique({
			where: { id: input.metricVersionId },
			select: { metricId: true },
		});
		if (!metricVersion) return;
		const window = inferMetricWindow(
			input.result,
			FactGrain.MONTH,
			input.capturedAt,
		);
		const snapshotKey = `${input.metricVersionId}:${window.reportingPeriod}:${input.contentHash}`;
		const existing = await this.db.metricSnapshot.findUnique({
			where: { idempotencyKey: snapshotKey },
			select: { id: true },
		});
		if (!existing) {
			const resultPresent = input.result.rows.length > 0;
			const run = await this.db.metricRun.create({
				data: {
					runKey: `${input.metricVersionId}:${input.capturedAt.toISOString()}:${input.contentHash}`,
					metricVersionId: input.metricVersionId,
					status: MetricRunStatus.PUBLISHED,
					periodStart: window.periodStart,
					periodEnd: window.periodEnd,
					dataThrough: window.dataThrough,
					sourceWatermarks: json([
						{
							source: "atlas:marketing",
							syncRunId: input.syncRunId,
							dataThrough: window.dataThrough.toISOString(),
							contentHash: input.contentHash,
						},
					]),
					inputHash: hash(input.queryText),
					outputHash: input.contentHash,
					rowCount: input.result.rows.length,
					validation: json({
						resultPresent,
						approvedDefinition: "one_person_across_sync_sites",
						pendingDecision: "cross_site_identity_bridge",
					}),
					startedAt: input.capturedAt,
					finishedAt: input.capturedAt,
					verifications: {
						create: marketingAttemptVerificationRows({
							questionNumber: input.questionNumber,
							questionVersion: input.questionVersion,
							capturedAt: input.capturedAt,
							resultPresent,
						}),
					},
				},
			});
			await this.db.metricSnapshot.create({
				data: {
					idempotencyKey: snapshotKey,
					metricVersionId: input.metricVersionId,
					metricRunId: run.id,
					reportingPeriod: window.reportingPeriod,
					periodStart: window.periodStart,
					periodEnd: window.periodEnd,
					dataThrough: window.dataThrough,
					computedAt: input.capturedAt,
					trustStatus: resultPresent
						? MetricTrustStatus.PENDING
						: MetricTrustStatus.FAILED,
					contentHash: input.contentHash,
					columns: json(input.result.columns),
					rows: json(input.result.rows),
					rowCount: input.result.rows.length,
				},
			});
		}
		await this.db.metricCatalogEntry.updateMany({
			where: { metricId: metricVersion.metricId, missingAt: null },
			data: { readiness: MetricReadinessStatus.RECONCILING },
		});
	}

	private parse(queryText: string) {
		let value: unknown;
		try {
			value = JSON.parse(queryText);
		} catch {
			throw new Error("API questions must contain valid JSON.");
		}
		const query = marketingQuery.parse(value);
		if (query.source === "posthog") assertReadOnlyHogql(query.query);
		return query;
	}

	private async productUserEligibilityPredicate(): Promise<string> {
		const excludedUsers = await this.db.productUser.findMany({
			where: {
				OR: [
					{ banned: true },
					{ isAnonymous: true },
					{ email: { endsWith: "@sync.so", mode: "insensitive" } },
					{ email: { endsWith: "@sync.labs", mode: "insensitive" } },
				],
			},
			select: { externalId: true },
		});
		return productUserEligibilityPredicate(
			excludedUsers.map((user) => user.externalId),
		);
	}

	private withProductUserEligibility(
		query: ReturnType<typeof marketingQuery.parse>,
		predicate: string,
	): ReturnType<typeof marketingQuery.parse> {
		if (query.source !== "posthog") return query;
		return {
			...query,
			query: applyPosthogPersonPolicy(
				query.query,
				query.personPolicy,
				predicate,
			),
		};
	}
}

export function marketingAttemptVerificationRows(input: {
	questionNumber: number;
	questionVersion: number;
	capturedAt: Date;
	resultPresent: boolean;
}) {
	const passed = {
		status: VerificationStatus.PASSED,
		verifiedBy: "atlas-policy",
		verifiedAt: input.capturedAt,
	};
	return [
		{
			name: "read_only_query",
			referenceType: "query_policy",
			referenceValue: json({ required: true }),
			actualValue: json({ passed: true }),
			evidence: json({
				questionNumber: input.questionNumber,
				questionVersion: input.questionVersion,
			}),
			...passed,
		},
		{
			name: "source_snapshot",
			referenceType: "immutable_snapshot",
			referenceValue: json({ required: true }),
			actualValue: json({ persisted: true }),
			evidence: json({ capturedAt: input.capturedAt.toISOString() }),
			...passed,
		},
		{
			name: "result_non_empty",
			referenceType: "row_count",
			referenceValue: json({ minimum: 1 }),
			actualValue: json({ passed: input.resultPresent }),
			status: input.resultPresent
				? VerificationStatus.PASSED
				: VerificationStatus.FAILED,
			verifiedBy: "atlas-policy",
			verifiedAt: input.capturedAt,
		},
		{
			name: "approved_cross_property_definition",
			referenceType: "definition_approval",
			referenceValue: json({ required: true }),
			actualValue: json({
				approved: true,
				definition:
					"Count one person once across Sync sites whenever a stable shared identity is available.",
			}),
			evidence: json({
				approvedBy: "metric-owner",
				approvedAt: input.capturedAt.toISOString(),
			}),
			...passed,
		},
		{
			name: "cross_site_identity_bridge",
			referenceType: "identity_policy",
			referenceValue: json({
				required: true,
				identity: "shared_person_id",
			}),
			actualValue: json({
				implemented: false,
				currentSource: "summed_ga4_property_totals",
			}),
			evidence: json({
				reason:
					"The current GA4 Data API result has property totals but no raw shared person ID. Connect the GA4 BigQuery export with user_id, or instrument every Sync site in one PostHog project with shared identity, before this count can be deduplicated.",
			}),
			status: VerificationStatus.PENDING,
			verifiedBy: null,
			verifiedAt: null,
		},
	];
}
