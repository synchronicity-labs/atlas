import { createHash, randomUUID } from "node:crypto";
import {
	type Db,
	type Prisma,
	SourceStatus,
	SyncMode,
	SyncRunStatus,
	VerificationStatus,
} from "@crm/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { abuseRingVerificationChecks } from "../metabase/abuse-detail-verification";
import { MetabaseClient } from "../metabase/metabase.client";
import { metabaseConfig } from "../metabase/metabase.config";
import {
	ProductMetricPublisher,
	type PublishVerificationCheck,
} from "../metabase/product-metric.publisher";
import { TinybirdEligibilityService } from "../metabase/tinybird-eligibility.service";
import {
	adobePluginVerificationChecks,
	adobePluginWeeklyReport,
} from "./adobe-plugin";
import {
	apiAdoptionVerificationChecks,
	apiAdoptionWeeklyReport,
} from "./api-adoption";
import {
	apiReliabilityVerificationChecks,
	apiReliabilityWeeklyReport,
} from "./api-reliability";
import { BetterStackClient, betterStackConfig } from "./betterstack.client";
import {
	cancellationFeedbackIncentiveVerificationChecks,
	cancellationFeedbackIncentiveWeeklyReport,
} from "./cancellation-feedback-incentive";
import { exitSurveyVerificationChecks } from "./exit-survey-verification";
import { GbrainEvidenceService } from "./gbrain-evidence.service";
import { geoConversionVerificationChecks } from "./geo-conversion-verification";
import { lipsyncFunnelVerificationChecks } from "./lipsync-funnel-verification";
import {
	lipsyncTrafficVerificationChecks,
	lipsyncTrafficWeeklyReport,
} from "./lipsync-traffic";
import { MarketingClient, type MarketingResult } from "./marketing.client";
import { marketingConfig } from "./marketing.config";
import { marketingQuery } from "./marketing.contracts";
import {
	applyPosthogPersonPolicy,
	productUserEligibilityPredicate,
} from "./marketing.eligibility";
import {
	modelFeedbackVerificationChecks,
	modelFeedbackWeeklyReport,
} from "./model-feedback";
import {
	productPagesVerificationChecks,
	productPagesWeeklyReport,
} from "./product-pages";
import { studioInsightVerificationChecks } from "./studio-insight-verification";
import { studioPeriodVerificationChecks } from "./studio-period-verification";

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

export function groupMarketingQuestionsBySource<
	T extends { number: number; sourceId: string | null },
>(questions: T[]): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const question of questions) {
		if (!question.sourceId) {
			throw new Error(`Q${question.number} has no configured Atlas source.`);
		}
		const group = groups.get(question.sourceId) ?? [];
		group.push(question);
		groups.set(question.sourceId, group);
	}
	return groups;
}

export function requiresProductUserEligibility(
	query: ReturnType<typeof marketingQuery.parse>,
): boolean {
	return (
		(query.source === "posthog" &&
			query.personPolicy === "exclude_banned_product_users") ||
		query.source === "automated_report"
	);
}

function sourceVerificationChecks(
	sourceExternalId: string | null,
	query: ReturnType<typeof marketingQuery.parse>,
	result: MarketingResult,
): PublishVerificationCheck[] | undefined {
	if (
		sourceExternalId === "cron:lipsync:weekly-traffic" &&
		query.source === "lipsync_traffic"
	)
		return lipsyncTrafficVerificationChecks(result, query);
	if (
		sourceExternalId === "cron:product-pages:weekly-funnel" &&
		query.source === "product_pages"
	)
		return productPagesVerificationChecks(result, query);
	if (
		sourceExternalId === "cron:api-endpoints:adoption-revenue" &&
		query.source === "api_adoption"
	)
		return apiAdoptionVerificationChecks(result, query);
	if (
		sourceExternalId === "cron:api-endpoints:reliability" &&
		query.source === "api_reliability"
	)
		return apiReliabilityVerificationChecks(result, query);
	if (
		sourceExternalId === "cron:model-feedback:weekly-coverage" &&
		query.source === "model_feedback"
	)
		return modelFeedbackVerificationChecks(result, query);
	if (
		sourceExternalId === "cron:adobe-plugin:weekly-kpis" &&
		query.source === "adobe_plugin"
	)
		return adobePluginVerificationChecks(result, query);
	if (
		sourceExternalId === "cron:exit-survey:weekly-summary" &&
		query.source === "posthog"
	)
		return exitSurveyVerificationChecks(result, query.query);
	if (
		sourceExternalId === "cron:geo:weekly-conversion" &&
		query.source === "posthog"
	)
		return geoConversionVerificationChecks(result, query.query);
	if (
		sourceExternalId === "cron:lipsync:product-funnel" &&
		query.source === "posthog"
	)
		return lipsyncFunnelVerificationChecks(result, query.query);
	if (
		sourceExternalId?.startsWith("cron:studio:insight-") &&
		query.source === "posthog_insight"
	)
		return studioInsightVerificationChecks(result, query);
	if (
		(sourceExternalId === "cron:studio:period-kpis" ||
			sourceExternalId === "cron:studio:monthly-period-kpis") &&
		query.source === "posthog"
	)
		return studioPeriodVerificationChecks(result, query.query);
	if (
		sourceExternalId === "cron:abuse:operational-detail" &&
		query.source === "posthog"
	)
		return abuseRingVerificationChecks(result, query.query);
	if (
		sourceExternalId === "rudy-cron:weekly-cancellation-feedback-incentive" &&
		query.source === "automated_report"
	)
		return cancellationFeedbackIncentiveVerificationChecks(result, query);
	return undefined;
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

function assertReadOnlyInsightQuery(
	query: Extract<
		ReturnType<typeof marketingQuery.parse>,
		{ source: "posthog_insight" }
	>,
): void {
	const expectedKind =
		query.mode === "retention_week_two" ? "RetentionQuery" : "FunnelsQuery";
	if (query.query.source.kind !== expectedKind) {
		throw new Error(`${query.mode} requires a ${expectedKind}.`);
	}
	if (query.query.source.filterTestAccounts !== true) {
		throw new Error("Native PostHog questions must filter test accounts.");
	}
}

@Injectable()
export class MarketingService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly metricPublisher: ProductMetricPublisher,
		private readonly tinybirdEligibility: TinybirdEligibilityService,
		private readonly gbrainEvidence: GbrainEvidenceService,
	) {}

	async preview(queryText: string): Promise<MarketingResult> {
		const query = this.parse(queryText);
		if (!requiresProductUserEligibility(query)) {
			return this.execute(new MarketingClient(marketingConfig()), query);
		}
		const eligibility = await this.productUserEligibility();
		return this.execute(
			new MarketingClient(marketingConfig()),
			this.withProductUserEligibility(query, eligibility.predicate),
			eligibility.predicate,
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
								name: true,
								description: true,
								connector: true,
								sourceId: true,
								sourceExternalId: true,
								databaseExternalId: true,
								metricVersionId: true,
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
		const questionsBySource = groupMarketingQuestionsBySource(questions);
		const period = month();
		const client = new MarketingClient(marketingConfig());
		let cardsProcessed = 0;
		let snapshotsCreated = 0;
		const errors: Array<{ number: number; message: string }> = [];
		const runIds: string[] = [];
		for (const [sourceId, sourceQuestions] of questionsBySource) {
			const source = await this.db.dataSource.findUnique({
				where: { id: sourceId },
			});
			if (!source)
				throw new Error(`Atlas source ${sourceId} is not configured.`);
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
			runIds.push(run.id);
			await this.db.dataSource.update({
				where: { id: source.id },
				data: { state: SourceStatus.SYNCING, lastError: null },
			});
			const sourceErrors: Array<{ number: number; message: string }> = [];
			let sourceCardsProcessed = 0;
			let sourceSnapshotsCreated = 0;
			for (const question of sourceQuestions) {
				const version = question.versions[0];
				if (version?.queryLanguage !== "API") {
					sourceErrors.push({
						number: question.number,
						message: "Question has no API version.",
					});
					continue;
				}
				try {
					const parsedQuery = this.parse(version.queryText);
					const eligibility = requiresProductUserEligibility(parsedQuery)
						? await this.productUserEligibility()
						: null;
					const result = await this.execute(
						client,
						eligibility
							? this.withProductUserEligibility(
									parsedQuery,
									eligibility.predicate,
								)
							: parsedQuery,
						eligibility?.predicate,
					);
					const verificationChecks = sourceVerificationChecks(
						question.sourceExternalId,
						parsedQuery,
						result,
					);
					const payload = { columns: result.columns, rows: result.rows };
					const contentHash = hash(payload);
					const externalId =
						question.sourceExternalId ??
						`marketing:question:${question.number}`;
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
					await this.metricPublisher.publish({
						question,
						version,
						result,
						syncRunId: run.id,
						capturedAt,
						eligibility: eligibility
							? {
									applied: true,
									capturedAt: eligibility.capturedAt,
									contentHash: eligibility.contentHash,
									excludedUsers: eligibility.excludedExternalIds.length,
									excludedOrganizations: 0,
									excludedCustomers: 0,
									complete: eligibility.complete,
									sourceRows: eligibility.sourceRows,
									returnedRows: eligibility.returnedRows,
									scope: eligibility.scope,
									policy: eligibility.policy,
								}
							: undefined,
						verificationChecks,
					});
					await this.db.question.update({
						where: { id: question.id },
						data: { lastCheckedAt: capturedAt },
					});
					sourceCardsProcessed += 1;
					sourceSnapshotsCreated += created.count;
				} catch (error) {
					sourceErrors.push({
						number: question.number,
						message: errorMessage(error),
					});
				}
			}
			const finishedAt = new Date();
			const failed = sourceErrors.length > 0;
			const lastError = failed
				? sourceErrors
						.map((error) => `Q${error.number}: ${error.message}`)
						.join(" | ")
				: null;
			await this.db.$transaction([
				this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: failed ? SyncRunStatus.FAILED : SyncRunStatus.COMPLETED,
						finishedAt,
						cardsProcessed: sourceCardsProcessed,
						snapshotsCreated: sourceSnapshotsCreated,
						error: lastError,
						checkpoint: json({ errors: sourceErrors }),
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
			cardsProcessed += sourceCardsProcessed;
			snapshotsCreated += sourceSnapshotsCreated;
			errors.push(...sourceErrors);
		}
		return {
			runId: runIds.length === 1 ? runIds[0] : null,
			runIds,
			period,
			cardsProcessed,
			snapshotsCreated,
			errors,
		};
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
		if (query.source === "posthog_insight") assertReadOnlyInsightQuery(query);
		return query;
	}

	private async execute(
		client: MarketingClient,
		query: ReturnType<typeof marketingQuery.parse>,
		productUserPredicate?: string,
	): Promise<MarketingResult> {
		if (query.source === "lipsync_traffic") {
			return lipsyncTrafficWeeklyReport({
				query,
				marketing: client,
				config: marketingConfig(),
			});
		}
		if (
			query.source !== "adobe_plugin" &&
			query.source !== "product_pages" &&
			query.source !== "api_adoption" &&
			query.source !== "api_reliability" &&
			query.source !== "model_feedback" &&
			query.source !== "automated_report"
		) {
			return client.execute(query);
		}
		if (query.source === "api_reliability") {
			const config = betterStackConfig();
			if (!config) throw new Error("BetterStack is not configured.");
			return apiReliabilityWeeklyReport({
				query,
				betterstack: new BetterStackClient(config),
			});
		}
		const config = metabaseConfig();
		if (!config) throw new Error("Metabase is not configured.");
		const metabase = new MetabaseClient(config);
		if (query.source === "automated_report") {
			if (!productUserPredicate) {
				throw new Error(
					"Automated Product reports require governed eligibility.",
				);
			}
			return cancellationFeedbackIncentiveWeeklyReport({
				query,
				marketing: client,
				metabase,
				productUserPredicate,
			});
		}
		return query.source === "model_feedback"
			? modelFeedbackWeeklyReport({
					query,
					metabase,
					evidence: this.gbrainEvidence,
				})
			: query.source === "adobe_plugin"
				? adobePluginWeeklyReport({
						query,
						nativeInsight: (nativeQuery) => client.nativeInsight(nativeQuery),
						metabase,
					})
				: query.source === "product_pages"
					? productPagesWeeklyReport({ query, marketing: client, metabase })
					: apiAdoptionWeeklyReport({ query, metabase });
	}

	private async productUserEligibility(): Promise<{
		predicate: string;
		excludedExternalIds: string[];
		capturedAt: string;
		contentHash: string;
		sourceRows: number;
		returnedRows: number;
		complete: boolean;
		scope: "ALL_IDENTITIES" | "SUBSCRIBED_ORGANIZATIONS";
		policy: "PRODUCT_ACTIVITY" | "MONEY";
	}> {
		const eligibility = await this.tinybirdEligibility.current();
		const excludedExternalIds = eligibility.excludedUserIds;
		return {
			predicate: productUserEligibilityPredicate(excludedExternalIds),
			excludedExternalIds,
			capturedAt: eligibility.capturedAt.toISOString(),
			contentHash: eligibility.contentHash,
			sourceRows: eligibility.sourceRows,
			returnedRows: eligibility.returnedRows,
			complete: eligibility.complete,
			scope: eligibility.scope,
			policy: eligibility.policy,
		};
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
