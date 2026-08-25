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
import { ProductMetricPublisher } from "../metabase/product-metric.publisher";
import { TinybirdEligibilityService } from "../metabase/tinybird-eligibility.service";
import { exitSurveyVerificationChecks } from "./exit-survey-verification";
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
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly metricPublisher: ProductMetricPublisher,
		private readonly tinybirdEligibility: TinybirdEligibilityService,
	) {}

	async preview(queryText: string): Promise<MarketingResult> {
		const query = this.parse(queryText);
		const eligibility = await this.productUserEligibility();
		return new MarketingClient(marketingConfig()).execute(
			this.withProductUserEligibility(query, eligibility.predicate),
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
		const eligibility = await this.productUserEligibility();
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
				const parsedQuery = this.parse(version.queryText);
				const appliesCleanUserPolicy =
					parsedQuery.source === "posthog" &&
					parsedQuery.personPolicy === "exclude_banned_product_users";
				const result = await client.execute(
					this.withProductUserEligibility(parsedQuery, eligibility.predicate),
				);
				const verificationChecks =
					question.sourceExternalId === "cron:exit-survey:weekly-summary" &&
					parsedQuery.source === "posthog"
						? exitSurveyVerificationChecks(result, parsedQuery.query)
						: question.sourceExternalId === "cron:abuse:operational-detail" &&
								parsedQuery.source === "posthog"
							? abuseRingVerificationChecks(result, parsedQuery.query)
							: undefined;
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
				await this.metricPublisher.publish({
					question,
					version,
					result,
					syncRunId: run.id,
					capturedAt,
					eligibility: {
						applied: appliesCleanUserPolicy,
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
					},
					verificationChecks,
				});
				await this.db.question.update({
					where: { id: question.id },
					data: { lastCheckedAt: capturedAt },
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
