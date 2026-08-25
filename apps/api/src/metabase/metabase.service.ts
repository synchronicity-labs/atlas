import { createHash, randomUUID } from "node:crypto";
import {
	DataSourceKind,
	type Db,
	Prisma,
	QueryLanguage,
	SourceStatus,
	SyncMode,
	SyncRunStatus,
	VerificationStatus,
	VisualizationType,
} from "@crm/db";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { InjectDatabase } from "../database/database.constants";
import { assertReadOnlyQuery } from "../questions/read-only-query";
import { atlasQuestionName } from "./atlas-question-name";
import {
	type MetabaseCardResponse,
	MetabaseClient,
	type MetabaseDashboardResponse,
	type MetabaseResult,
} from "./metabase.client";
import { type MetabaseConfig, metabaseConfig } from "./metabase.config";
import {
	ProductMetricPublisher,
	type PublishVerificationCheck,
	preferredAtlasQuestionNumber,
} from "./product-metric.publisher";
import {
	RevenueDoorPolicyService,
	usesRevenueDoorPolicy,
	usesSubscribedRevenueEligibility,
} from "./revenue-door-policy.service";
import { comparePaidCustomerRevenue } from "./saved-question-equivalence";
import {
	StripeBillingCountryClient,
	type StripeBillingCountryPage,
	type StripeBillingCountryPageInput,
} from "./stripe-charge-country.client";
import {
	dedupeStripeCustomerBillingCountryRows,
	parseStripeCustomerBillingCountryResult,
	STRIPE_CUSTOMER_BILLING_COUNTRY_BATCH_SIZE,
	STRIPE_CUSTOMER_BILLING_COUNTRY_CHARGE_SCOPE,
	STRIPE_CUSTOMER_BILLING_COUNTRY_DATASET_KEY,
	STRIPE_CUSTOMER_BILLING_COUNTRY_INVOICE_SCOPE,
	STRIPE_CUSTOMER_BILLING_COUNTRY_SCOPE,
	STRIPE_CUSTOMER_BILLING_COUNTRY_SOURCE_KEY,
	type StripeCustomerBillingCountryRow,
	stripeCustomerBillingCountryQuery,
} from "./stripe-customer-billing-country";
import { TinybirdEligibilityService } from "./tinybird-eligibility.service";

const SOURCE_KEY = "metabase:sync";
const DASHBOARD_SCOPE = "product-scoreboard";
const USERS_SCOPE = "product-users";
const FRESHNESS_MS = 8 * 60 * 60 * 1000;
const ATLAS_DASHBOARD_CONCURRENCY = 4;
const ATLAS_DASHBOARD_QUESTION_BATCH_SIZE = 6;
const USER_PERSIST_CHUNK_SIZE = 100;
const STRIPE_COUNTRY_PERSIST_CHUNK_SIZE = 500;

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

type StripeCustomerBillingCountrySyncInput = { maxBatches: number };

type StripeBillingCountryCheckpoint = {
	windowStart?: string;
	windowEnd?: string;
	completed?: boolean;
	backfillComplete?: boolean;
};

type StripeBillingCountryResource = {
	label: "charge" | "invoice";
	scope: string;
	page: (
		input: StripeBillingCountryPageInput,
	) => Promise<StripeBillingCountryPage>;
};

type SafeUserRow = Record<string, unknown> & { id: string };

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function stableHash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function checkpointObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function checkpointDate(value: unknown): Date | null {
	if (typeof value !== "string") return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
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
	private readonly stripeSecretKey: string | null;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly productMetrics: ProductMetricPublisher,
		private readonly revenueDoorPolicy: RevenueDoorPolicyService,
		private readonly tinybirdEligibility: TinybirdEligibilityService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.stripeSecretKey =
			config.get("STRIPE_SECRET_KEY", { infer: true }) ?? null;
	}

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

	async syncStripeCustomerBillingCountries(
		input: StripeCustomerBillingCountrySyncInput,
	) {
		const source = await this.beginStripeSource();
		const dataset = await this.ensureStripeCustomerBillingCountryDataset(
			source.id,
		);

		if (this.stripeSecretKey) {
			const client = new StripeBillingCountryClient(this.stripeSecretKey);
			const charges = await this.syncStripeCustomerBillingCountryResource(
				source.id,
				dataset.id,
				input,
				{
					label: "charge",
					scope: STRIPE_CUSTOMER_BILLING_COUNTRY_CHARGE_SCOPE,
					page: (pageInput) => client.chargePage(pageInput),
				},
			);
			const invoices = await this.syncStripeCustomerBillingCountryResource(
				source.id,
				dataset.id,
				input,
				{
					label: "invoice",
					scope: STRIPE_CUSTOMER_BILLING_COUNTRY_INVOICE_SCOPE,
					page: (pageInput) => client.invoicePage(pageInput),
				},
			);

			return {
				invoiceFallback: null,
				charges: { configured: true, ...charges },
				invoices: { configured: true, ...invoices },
			};
		}

		const config = metabaseConfig();
		if (!config) {
			await this.db.dataSource.update({
				where: { id: source.id },
				data: {
					state: SourceStatus.UNCONFIGURED,
					lastError: "Stripe billing country sync is not configured.",
				},
			});
			return {
				invoiceFallback: null,
				charges: { configured: false },
				invoices: { configured: false },
			};
		}

		const invoiceFallback =
			await this.syncStripeCustomerBillingCountryFallbacks(
				config,
				source.id,
				dataset.id,
				input,
			);

		return {
			invoiceFallback,
			charges: { configured: false },
			invoices: { configured: false },
		};
	}

	private async syncStripeCustomerBillingCountryFallbacks(
		config: MetabaseConfig,
		sourceId: string,
		datasetId: string,
		input: StripeCustomerBillingCountrySyncInput,
	) {
		const period = currentMonth();
		const cursor = await this.db.syncCursor.upsert({
			where: {
				sourceId_mode_scope: {
					sourceId,
					mode: SyncMode.INCREMENTAL,
					scope: STRIPE_CUSTOMER_BILLING_COUNTRY_SCOPE,
				},
			},
			create: {
				sourceId,
				mode: SyncMode.INCREMENTAL,
				scope: STRIPE_CUSTOMER_BILLING_COUNTRY_SCOPE,
				period,
			},
			update: {},
		});
		const run = await this.db.syncRun.create({
			data: {
				runKey: `stripe:${STRIPE_CUSTOMER_BILLING_COUNTRY_SCOPE}:${period}:${randomUUID()}`,
				sourceId,
				mode: SyncMode.INCREMENTAL,
				status: SyncRunStatus.RUNNING,
				scope: STRIPE_CUSTOMER_BILLING_COUNTRY_SCOPE,
				period,
			},
		});

		try {
			const client = new MetabaseClient(config);
			let pageCursor = cursor.cursor;
			let processed = 0;
			let snapshots = 0;
			let completed = false;
			let dataThrough = cursor.dataThrough;

			for (let batch = 0; batch < input.maxBatches; batch += 1) {
				const result = await client.preview({
					language: "SQL",
					queryText: stripeCustomerBillingCountryQuery(
						pageCursor,
						STRIPE_CUSTOMER_BILLING_COUNTRY_BATCH_SIZE,
					),
					databaseExternalId: "166",
				});
				const rows = parseStripeCustomerBillingCountryResult(result);

				if (rows.length === 0) {
					completed = true;
					break;
				}

				const persisted = await this.persistStripeCustomerBillingCountries(
					sourceId,
					rows,
				);
				processed += rows.length;
				snapshots += persisted.snapshots;
				pageCursor = rows.at(-1)?.stripeCustomerId ?? pageCursor;
				dataThrough = rows.reduce(
					(latest, row) =>
						!latest || row.dataThrough > latest ? row.dataThrough : latest,
					dataThrough,
				);

				await this.db.$transaction([
					this.db.syncCursor.update({
						where: { id: cursor.id },
						data: {
							cursor: pageCursor,
							offset: cursor.offset + processed,
							period,
							dataThrough,
							checkpoint: json({ pageCursor, processed }),
						},
					}),
					this.db.syncRun.update({
						where: { id: run.id },
						data: {
							recordsProcessed: processed,
							snapshotsCreated: snapshots,
							dataThrough,
							checkpoint: json({ pageCursor, processed }),
						},
					}),
				]);

				if (rows.length < STRIPE_CUSTOMER_BILLING_COUNTRY_BATCH_SIZE) {
					completed = true;
					break;
				}
			}

			const finishedAt = new Date();
			const effectiveDataThrough = dataThrough ?? finishedAt;
			const contentHash = stableHash({
				completed,
				pageCursor,
				processed,
				snapshots,
			});
			await this.db.$transaction([
				this.db.syncCursor.update({
					where: { id: cursor.id },
					data: {
						cursor: completed ? null : pageCursor,
						offset: completed ? 0 : cursor.offset + processed,
						period,
						dataThrough: effectiveDataThrough,
						lastSuccessAt: finishedAt,
						checkpoint: json({ completed, pageCursor, processed }),
					},
				}),
				this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: SyncRunStatus.COMPLETED,
						finishedAt,
						recordsProcessed: processed,
						snapshotsCreated: snapshots,
						dataThrough: effectiveDataThrough,
						checkpoint: json({ completed, pageCursor, processed }),
					},
				}),
				this.db.sourceWatermark.create({
					data: {
						idempotencyKey: `stripe:customer-billing-country:${run.id}`,
						datasetId,
						sourceId,
						syncRunId: run.id,
						dataThrough: effectiveDataThrough,
						complete: completed,
						rowCount: processed,
						contentHash,
						checkpoint: json({ pageCursor, processed }),
						observedAt: finishedAt,
					},
				}),
				this.db.dataSource.update({
					where: { id: sourceId },
					data: {
						state: completed ? SourceStatus.HEALTHY : SourceStatus.SYNCING,
						lastSyncAt: completed ? finishedAt : undefined,
						lastError: null,
						freshnessDeadlineAt: completed
							? new Date(finishedAt.getTime() + FRESHNESS_MS)
							: undefined,
					},
				}),
			]);

			this.logger.log({
				message: "Stripe customer billing countries synchronized",
				processed,
				snapshots,
				completed,
			});

			return {
				runId: run.id,
				processed,
				snapshots,
				completed,
				cursor: completed ? null : pageCursor,
				dataThrough: effectiveDataThrough,
			};
		} catch (error) {
			await this.fail(run.id, sourceId, error);
			throw error;
		}
	}

	private async syncStripeCustomerBillingCountryResource(
		sourceId: string,
		datasetId: string,
		input: StripeCustomerBillingCountrySyncInput,
		resource: StripeBillingCountryResource,
	) {
		const period = currentMonth();
		const [incremental, backfill] = await Promise.all([
			this.db.syncCursor.upsert({
				where: {
					sourceId_mode_scope: {
						sourceId,
						mode: SyncMode.INCREMENTAL,
						scope: resource.scope,
					},
				},
				create: {
					sourceId,
					mode: SyncMode.INCREMENTAL,
					scope: resource.scope,
					period,
				},
				update: { period },
			}),
			this.db.syncCursor.upsert({
				where: {
					sourceId_mode_scope: {
						sourceId,
						mode: SyncMode.BACKFILL,
						scope: resource.scope,
					},
				},
				create: {
					sourceId,
					mode: SyncMode.BACKFILL,
					scope: resource.scope,
					period,
				},
				update: { period },
			}),
		]);
		const run = await this.db.syncRun.create({
			data: {
				runKey: `stripe:${resource.scope}:${period}:${randomUUID()}`,
				sourceId,
				mode: SyncMode.INCREMENTAL,
				status: SyncRunStatus.RUNNING,
				scope: resource.scope,
				period,
			},
		});

		try {
			const scanStartedAt = new Date();
			const recentCheckpoint = checkpointObject(
				incremental.checkpoint,
			) as StripeBillingCountryCheckpoint;
			const resumingRecent = Boolean(
				incremental.cursor &&
					recentCheckpoint.windowStart &&
					recentCheckpoint.windowEnd,
			);
			const windowStart = resumingRecent
				? (checkpointDate(recentCheckpoint.windowStart) ??
					new Date(scanStartedAt.getTime() - 24 * 60 * 60 * 1000))
				: new Date(
						(incremental.dataThrough?.getTime() ??
							scanStartedAt.getTime() - 23 * 60 * 60 * 1000) -
							60 * 60 * 1000,
					);
			const windowEnd = resumingRecent
				? (checkpointDate(recentCheckpoint.windowEnd) ?? scanStartedAt)
				: scanStartedAt;
			let recentCursor = incremental.cursor;
			let historicalCursor = backfill.cursor;
			let remainingPages = input.maxBatches;
			let processed = 0;
			let snapshots = 0;
			let recentProcessed = 0;
			let historicalProcessed = 0;
			let recentComplete = false;
			let backfillComplete =
				checkpointObject(backfill.checkpoint).backfillComplete === true;

			while (remainingPages > 0 && !recentComplete) {
				const page = await resource.page({
					startingAfter: recentCursor,
					createdGte: windowStart,
					createdLte: windowEnd,
					dataThrough: windowEnd,
				});
				const persisted = await this.persistStripeCustomerBillingCountries(
					sourceId,
					page.rows,
				);
				processed += page.processed;
				recentProcessed += page.processed;
				snapshots += persisted.snapshots;
				remainingPages -= 1;
				recentComplete = !page.hasMore || !page.nextCursor;
				recentCursor = recentComplete ? null : page.nextCursor;
				await this.db.syncCursor.update({
					where: { id: incremental.id },
					data: {
						cursor: recentCursor,
						offset: recentComplete ? 0 : incremental.offset + recentProcessed,
						dataThrough: recentComplete ? windowEnd : incremental.dataThrough,
						lastSuccessAt: recentComplete
							? new Date()
							: incremental.lastSuccessAt,
						checkpoint: json({
							windowStart: windowStart.toISOString(),
							windowEnd: windowEnd.toISOString(),
							completed: recentComplete,
							processed: recentProcessed,
						}),
					},
				});
			}

			while (remainingPages > 0 && recentComplete && !backfillComplete) {
				const page = await resource.page({
					startingAfter: historicalCursor,
					dataThrough: scanStartedAt,
				});
				const persisted = await this.persistStripeCustomerBillingCountries(
					sourceId,
					page.rows,
				);
				processed += page.processed;
				historicalProcessed += page.processed;
				snapshots += persisted.snapshots;
				remainingPages -= 1;
				backfillComplete = !page.hasMore || !page.nextCursor;
				historicalCursor = backfillComplete ? null : page.nextCursor;
				await this.db.syncCursor.update({
					where: { id: backfill.id },
					data: {
						cursor: historicalCursor,
						offset: backfillComplete
							? 0
							: backfill.offset + historicalProcessed,
						dataThrough: scanStartedAt,
						lastSuccessAt: new Date(),
						checkpoint: json({
							backfillComplete,
							processed: historicalProcessed,
						}),
					},
				});
			}

			const finishedAt = new Date();
			const dataThrough = recentComplete
				? windowEnd
				: (incremental.dataThrough ?? windowStart);
			const checkpoint = {
				recentComplete,
				backfillComplete,
				recentCursor,
				historicalCursor,
				processed,
			};
			await this.db.$transaction([
				this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: SyncRunStatus.COMPLETED,
						finishedAt,
						recordsProcessed: processed,
						snapshotsCreated: snapshots,
						dataThrough,
						checkpoint: json(checkpoint),
					},
				}),
				this.db.sourceWatermark.create({
					data: {
						idempotencyKey: `stripe:customer-billing-country:${resource.label}s:${run.id}`,
						datasetId,
						sourceId,
						syncRunId: run.id,
						dataThrough,
						complete: recentComplete,
						rowCount: processed,
						contentHash: stableHash(checkpoint),
						checkpoint: json(checkpoint),
						observedAt: finishedAt,
					},
				}),
				this.db.dataSource.update({
					where: { id: sourceId },
					data: {
						state: recentComplete ? SourceStatus.HEALTHY : SourceStatus.SYNCING,
						lastSyncAt: recentComplete ? finishedAt : undefined,
						lastError: null,
						freshnessDeadlineAt: recentComplete
							? new Date(finishedAt.getTime() + FRESHNESS_MS)
							: undefined,
					},
				}),
			]);

			this.logger.log({
				message: `Stripe ${resource.label} billing countries synchronized`,
				processed,
				snapshots,
				recentComplete,
				backfillComplete,
			});

			return {
				runId: run.id,
				processed,
				snapshots,
				recentComplete,
				backfillComplete,
				dataThrough,
			};
		} catch (error) {
			await this.fail(run.id, sourceId, error);
			throw error;
		}
	}

	private ensureStripeCustomerBillingCountryDataset(sourceId: string) {
		const data = {
			label: "Stripe customer billing country",
			description:
				"Latest billing country from a successful Stripe charge, with invoice billing or shipping country as fallback.",
			adapter: "stripe-api+metabase-fallback",
			eventTimeField: "observedAt",
			watermarkField: "dataThrough",
			cadenceMinutes: 480,
			freshnessSlaMinutes: 480,
			config: json({
				primaryEvidence: "successful Stripe charge billing country",
				fallbackEvidence: "invoice billing then shipping country",
			}),
		};
		return this.db.ingestionDataset.upsert({
			where: {
				sourceId_key: {
					sourceId,
					key: STRIPE_CUSTOMER_BILLING_COUNTRY_DATASET_KEY,
				},
			},
			create: {
				sourceId,
				key: STRIPE_CUSTOMER_BILLING_COUNTRY_DATASET_KEY,
				...data,
			},
			update: { ...data, enabled: true },
		});
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
					syncRunId: run.id,
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

	async syncAtlasDashboard(number: number, sourceIdFilter?: string) {
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
								metricVersionId: true,
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
										sourceCardExternalId: true,
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
					(!sourceIdFilter || question.sourceId === sourceIdFilter) &&
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
		const errors: Array<{ number: number; message: string }> = [];
		try {
			const client = new MetabaseClient(config);
			const generalEligibility = questions.some(
				(question) =>
					["34", "166"].includes(question.databaseExternalId ?? "") &&
					question.versions[0]?.queryLanguage === QueryLanguage.SQL &&
					!usesSubscribedRevenueEligibility(
						question.number,
						question.name,
						question.versions[0]?.queryText,
					),
			)
				? await this.tinybirdEligibility.current()
				: null;
			const revenueEligibility = questions.some(
				(question) =>
					["34", "166"].includes(question.databaseExternalId ?? "") &&
					question.versions[0]?.queryLanguage === QueryLanguage.SQL &&
					usesSubscribedRevenueEligibility(
						question.number,
						question.name,
						question.versions[0]?.queryText,
					),
			)
				? await this.tinybirdEligibility.currentForRevenue()
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
						try {
							const version = question.versions[0];
							if (!version) {
								throw new Error(
									`Question ${question.number} has no saved version.`,
								);
							}
							const language =
								version.queryLanguage === QueryLanguage.SQL ? "SQL" : "MBQL";
							assertReadOnlyQuery(language, version.queryText);
							const revenueDoor =
								language === "SQL" && usesRevenueDoorPolicy(question.number)
									? await this.revenueDoorPolicy.compileForQuestion(
											question.number,
											version.queryText,
										)
									: null;
							const classifiedQueryText =
								revenueDoor?.queryText ?? version.queryText;
							assertReadOnlyQuery(language, classifiedQueryText);
							const eligibility = usesSubscribedRevenueEligibility(
								question.number,
								question.name,
								classifiedQueryText,
							)
								? revenueEligibility
								: generalEligibility;
							const governed = eligibility
								? this.tinybirdEligibility.govern(
										classifiedQueryText,
										question.databaseExternalId,
										eligibility,
									)
								: null;
							const executedQueryText =
								language === "SQL" && governed
									? governed.queryText
									: classifiedQueryText;
							const result = await client.preview({
								language,
								queryText: executedQueryText,
								databaseExternalId: question.databaseExternalId,
							});
							const verificationChecks: PublishVerificationCheck[] = [];
							if (question.number === 1004 && version.sourceCardExternalId) {
								const sourceQuestionNumber = Number(
									version.sourceCardExternalId,
								);
								try {
									const [savedQuestion, rawReplacement] = await Promise.all([
										client.cardResult(sourceQuestionNumber),
										client.preview({
											language,
											queryText: version.queryText,
											databaseExternalId: question.databaseExternalId,
										}),
									]);
									verificationChecks.push(
										comparePaidCustomerRevenue(
											savedQuestion,
											rawReplacement,
											sourceQuestionNumber,
										),
									);
								} catch (error) {
									verificationChecks.push({
										name: "saved_question_equivalence",
										status: VerificationStatus.PENDING,
										reason: `Atlas could not compare Metabase question ${sourceQuestionNumber}: ${error instanceof Error ? error.message : String(error)}`,
										referenceValue: { sourceQuestionNumber },
									});
								}
							}
							const publishEligibility = governed
								? { applied: governed.applied, ...governed.eligibility }
								: undefined;
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
								version: { ...version, queryText: executedQueryText },
								result,
								syncRunId: run.id,
								capturedAt,
								eligibility: publishEligibility,
								revenueDoorPolicy: revenueDoor?.evidence,
								verificationChecks,
							});
							await this.db.question.update({
								where: { id: question.id },
								data: { lastCheckedAt: capturedAt },
							});
							return created.count;
						} catch (error) {
							errors.push({
								number: question.number,
								message: error instanceof Error ? error.message : String(error),
							});
							return 0;
						}
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
							errors,
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
							errors,
							eligibilityCapturedAt:
								generalEligibility?.capturedAt.toISOString() ?? null,
							eligibilityHash: generalEligibility?.contentHash ?? null,
							revenueEligibilityCapturedAt:
								revenueEligibility?.capturedAt.toISOString() ?? null,
							revenueEligibilityHash: revenueEligibility?.contentHash ?? null,
						}),
					},
				}),
				this.db.dataSource.update({
					where: { id: sourceId },
					data: {
						state:
							errors.length === questionsToProcess.length && errors.length > 0
								? SourceStatus.ERROR
								: completed
									? SourceStatus.HEALTHY
									: SourceStatus.SYNCING,
						lastSyncAt: completed ? finishedAt : undefined,
						lastError:
							errors.length > 0
								? `${errors.length} question(s) failed in the latest batch.`
								: null,
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
				errors,
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
		syncRunId: string;
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

		const version = await this.db.questionVersion.findFirstOrThrow({
			where: { questionId: question.id },
			orderBy: { version: "desc" },
			select: {
				id: true,
				version: true,
				queryLanguage: true,
				queryText: true,
			},
		});
		const capturedAt = new Date();
		const payload = { columns: result.columns, rows: result.rows };
		const contentHash = stableHash(payload);
		const idempotencyKey = `metabase:${input.dashboard.id}:${placement.card.id}:${input.period}:${contentHash}`;
		await this.db.question.update({
			where: { id: question.id },
			data: { lastCheckedAt: capturedAt },
		});
		const existing = await this.db.resultSnapshot.findUnique({
			where: { idempotencyKey },
			select: { id: true },
		});

		if (!existing) {
			await this.db.resultSnapshot.create({
				data: {
					idempotencyKey,
					sourceId: input.sourceId,
					dashboardExternalId: String(input.dashboard.id),
					questionExternalId: String(placement.card.id),
					reportingPeriod: input.period,
					capturedAt,
					contentHash,
					columns: json(result.columns),
					rows: json(result.rows),
					rowCount: result.rows.length,
				},
			});
		}

		await this.productMetrics.publish({
			question,
			version,
			result,
			syncRunId: input.syncRunId,
			capturedAt,
		});

		return !existing;
	}

	private async ensureQuestion(sourceId: string, card: MetabaseCardResponse) {
		const definition = this.cardDefinition(card);
		const name = atlasQuestionName(card.name);
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
					name,
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
			where: { number: { lt: 1000 } },
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
				name,
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

		for (
			let offset = 0;
			offset < rows.length;
			offset += USER_PERSIST_CHUNK_SIZE
		) {
			const chunk = rows.slice(offset, offset + USER_PERSIST_CHUNK_SIZE);
			await this.db.$transaction(
				async (tx) => {
					for (const row of chunk) {
						const email =
							identifierString(row.email, 320)?.toLowerCase() ?? null;
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
									stripeCustomerId: identifierString(
										row.stripe_customer_id,
										255,
									),
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
									stripeCustomerId: identifierString(
										row.stripe_customer_id,
										255,
									),
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
		}

		return { snapshots };
	}

	private async persistStripeCustomerBillingCountries(
		sourceId: string,
		rows: StripeCustomerBillingCountryRow[],
	) {
		let snapshots = 0;
		const capturedAt = new Date();
		const canonicalRows = dedupeStripeCustomerBillingCountryRows(rows);

		for (
			let offset = 0;
			offset < canonicalRows.length;
			offset += STRIPE_COUNTRY_PERSIST_CHUNK_SIZE
		) {
			const chunk = canonicalRows.slice(
				offset,
				offset + STRIPE_COUNTRY_PERSIST_CHUNK_SIZE,
			);
			const prepared = chunk.map((row) => {
				const payload = {
					stripeCustomerId: row.stripeCustomerId,
					countryCode: row.countryCode,
					evidenceKind: row.evidenceKind,
					sourceExternalId: row.sourceExternalId,
					observedAt: row.observedAt.toISOString(),
				};
				return {
					id: randomUUID(),
					row,
					payload,
					contentHash: stableHash(payload),
				};
			});
			await this.db.$transaction(
				async (tx) => {
					const values = Prisma.join(
						prepared.map(
							({ id, row, contentHash }) =>
								Prisma.sql`(${id}, ${sourceId}, ${row.stripeCustomerId}, ${row.countryCode}, ${row.evidenceKind}, ${row.sourceExternalId}, ${row.observedAt}, ${row.dataThrough}, ${contentHash}, ${capturedAt}, ${capturedAt}, ${capturedAt})`,
						),
					);
					await tx.$executeRaw(Prisma.sql`
						INSERT INTO "stripeCustomerBillingCountry" (
							"id", "sourceId", "stripeCustomerId", "countryCode",
							"evidenceKind", "sourceExternalId", "observedAt", "dataThrough",
							"contentHash", "syncedAt", "createdAt", "updatedAt"
						)
						VALUES ${values}
						ON CONFLICT ("sourceId", "stripeCustomerId") DO UPDATE SET
							"countryCode" = CASE WHEN
								(CASE WHEN EXCLUDED."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END) >
								(CASE WHEN "stripeCustomerBillingCountry"."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END)
								OR (
									(CASE WHEN EXCLUDED."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END) =
									(CASE WHEN "stripeCustomerBillingCountry"."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END)
									AND (EXCLUDED."observedAt", EXCLUDED."sourceExternalId") >=
										("stripeCustomerBillingCountry"."observedAt", "stripeCustomerBillingCountry"."sourceExternalId")
								)
							THEN EXCLUDED."countryCode" ELSE "stripeCustomerBillingCountry"."countryCode" END,
							"evidenceKind" = CASE WHEN
								(CASE WHEN EXCLUDED."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END) >
								(CASE WHEN "stripeCustomerBillingCountry"."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END)
								OR (
									(CASE WHEN EXCLUDED."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END) =
									(CASE WHEN "stripeCustomerBillingCountry"."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END)
									AND (EXCLUDED."observedAt", EXCLUDED."sourceExternalId") >=
										("stripeCustomerBillingCountry"."observedAt", "stripeCustomerBillingCountry"."sourceExternalId")
								)
							THEN EXCLUDED."evidenceKind" ELSE "stripeCustomerBillingCountry"."evidenceKind" END,
							"sourceExternalId" = CASE WHEN
								(CASE WHEN EXCLUDED."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END) >
								(CASE WHEN "stripeCustomerBillingCountry"."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END)
								OR (
									(CASE WHEN EXCLUDED."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END) =
									(CASE WHEN "stripeCustomerBillingCountry"."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END)
									AND (EXCLUDED."observedAt", EXCLUDED."sourceExternalId") >=
										("stripeCustomerBillingCountry"."observedAt", "stripeCustomerBillingCountry"."sourceExternalId")
								)
							THEN EXCLUDED."sourceExternalId" ELSE "stripeCustomerBillingCountry"."sourceExternalId" END,
							"observedAt" = CASE WHEN
								(CASE WHEN EXCLUDED."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END) >
								(CASE WHEN "stripeCustomerBillingCountry"."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END)
								OR (
									(CASE WHEN EXCLUDED."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END) =
									(CASE WHEN "stripeCustomerBillingCountry"."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END)
									AND (EXCLUDED."observedAt", EXCLUDED."sourceExternalId") >=
										("stripeCustomerBillingCountry"."observedAt", "stripeCustomerBillingCountry"."sourceExternalId")
								)
							THEN EXCLUDED."observedAt" ELSE "stripeCustomerBillingCountry"."observedAt" END,
							"dataThrough" = GREATEST("stripeCustomerBillingCountry"."dataThrough", EXCLUDED."dataThrough"),
							"contentHash" = CASE WHEN
								(CASE WHEN EXCLUDED."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END) >
								(CASE WHEN "stripeCustomerBillingCountry"."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END)
								OR (
									(CASE WHEN EXCLUDED."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END) =
									(CASE WHEN "stripeCustomerBillingCountry"."evidenceKind" = 'SUCCESSFUL_CHARGE_BILLING' THEN 2 ELSE 1 END)
									AND (EXCLUDED."observedAt", EXCLUDED."sourceExternalId") >=
										("stripeCustomerBillingCountry"."observedAt", "stripeCustomerBillingCountry"."sourceExternalId")
								)
							THEN EXCLUDED."contentHash" ELSE "stripeCustomerBillingCountry"."contentHash" END,
							"syncedAt" = GREATEST("stripeCustomerBillingCountry"."syncedAt", EXCLUDED."syncedAt"),
							"updatedAt" = EXCLUDED."updatedAt"
					`);

					const current = await tx.stripeCustomerBillingCountry.findMany({
						where: {
							sourceId,
							stripeCustomerId: {
								in: prepared.map(({ row }) => row.stripeCustomerId),
							},
						},
						select: {
							id: true,
							stripeCustomerId: true,
							contentHash: true,
						},
					});
					const currentRecord = new Map(
						current.map((record) => [record.stripeCustomerId, record]),
					);
					const accepted = prepared.filter(({ row, contentHash }) => {
						return (
							currentRecord.get(row.stripeCustomerId)?.contentHash ===
							contentHash
						);
					});
					const created =
						await tx.stripeCustomerBillingCountrySnapshot.createMany({
							data: accepted.map(({ row, payload, contentHash }) => {
								const billingCountryId = currentRecord.get(
									row.stripeCustomerId,
								)?.id;
								if (!billingCountryId) {
									throw new Error(
										"Stripe customer billing country upsert did not return a current record.",
									);
								}
								return {
									idempotencyKey: `stripe:customer-billing-country:${row.stripeCustomerId}:${contentHash}`,
									sourceId,
									billingCountryId,
									stripeCustomerId: row.stripeCustomerId,
									countryCode: row.countryCode,
									evidenceKind: row.evidenceKind,
									sourceExternalId: row.sourceExternalId,
									observedAt: row.observedAt,
									dataThrough: row.dataThrough,
									capturedAt,
									contentHash,
									payload: json(payload),
								};
							}),
							skipDuplicates: true,
						});
					snapshots += created.count;
				},
				{ maxWait: 15_000, timeout: 120_000 },
			);
		}

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
		return this.beginDataSource(
			SOURCE_KEY,
			DataSourceKind.METABASE,
			"Sync Metabase",
		);
	}

	private async beginStripeSource() {
		return this.beginDataSource(
			STRIPE_CUSTOMER_BILLING_COUNTRY_SOURCE_KEY,
			DataSourceKind.STRIPE,
			"Stripe billing country",
		);
	}

	private async beginDataSource(
		key: string,
		kind: DataSourceKind,
		label: string,
	) {
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
			where: { key },
			create: {
				key,
				kind,
				label,
				state: SourceStatus.SYNCING,
			},
			update: { kind, label, state: SourceStatus.SYNCING, lastError: null },
		});
	}

	private async fail(runId: string, sourceId: string, error: unknown) {
		const message =
			error instanceof Error ? error.message : "Unknown source sync failure.";
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
			{ message: "Source sync failed" },
			error instanceof Error ? error.stack : String(error),
		);
	}
}
