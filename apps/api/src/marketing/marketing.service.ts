import { createHash, randomUUID } from "node:crypto";
import {
	type Db,
	type Prisma,
	SourceStatus,
	SyncMode,
	SyncRunStatus,
} from "@crm/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
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

	private async productUserEligibilityPredicate(): Promise<string> {
		const bannedUsers = await this.db.productUser.findMany({
			where: { banned: true },
			select: { externalId: true },
		});
		return productUserEligibilityPredicate(
			bannedUsers.map((user) => user.externalId),
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
