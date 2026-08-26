import { createHash, randomUUID } from "node:crypto";
import { type Db, type Prisma, SyncMode, SyncRunStatus } from "@crm/db";
import {
	activePilotRegistry,
	executeHubspotSalesQuery,
	parseHubspotSalesQuery,
} from "@crm/db/hubspot-sales";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { MetabaseClient } from "../metabase/metabase.client";
import { metabaseConfig } from "../metabase/metabase.config";
import { ProductMetricPublisher } from "../metabase/product-metric.publisher";
import {
	enterpriseBookingsVerificationChecks,
	studioBookingsVerificationChecks,
} from "./bookings-verification";
import {
	buildPilotAdoptionQuery,
	emptyPilotAdoptionResult,
} from "./pilot-adoption";
import { pilotAdoptionVerificationChecks } from "./pilot-adoption-verification";
import { pilotSummaryVerificationChecks } from "./pilot-verification";

const SOURCE_KEY = "hubspot:crm";

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

@Injectable()
export class SalesService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly metricPublisher: ProductMetricPublisher,
	) {}

	async preview(queryText: string) {
		return (await this.execute(queryText)).result;
	}

	private async execute(queryText: string) {
		let query: unknown;
		try {
			query = JSON.parse(queryText);
		} catch {
			throw new Error("HubSpot sales questions must contain valid JSON.");
		}
		const parsedQuery = parseHubspotSalesQuery(query);
		if (parsedQuery.report === "active-pilot-adoption") {
			const registry = await activePilotRegistry(this.db);
			const adoptionQuery = buildPilotAdoptionQuery(registry);
			let result = emptyPilotAdoptionResult();
			let eligibility = {
				applied: false,
				capturedAt: new Date().toISOString(),
				contentHash: hash({ sourceRows: 0, returnedRows: 0 }),
				excludedUsers: 0,
				excludedOrganizations: 0,
				excludedCustomers: 0,
				complete: false,
				sourceRows: 0,
				returnedRows: 0,
				scope: "ALL_IDENTITIES" as const,
				policy: "PRODUCT_ACTIVITY" as const,
				enforcement: "POSTGRES_LIVE_JOIN" as const,
			};
			if (adoptionQuery) {
				const config = metabaseConfig();
				if (!config) throw new Error("Metabase is not configured.");
				const raw = await new MetabaseClient(config).preview({
					language: "SQL",
					queryText: adoptionQuery,
					databaseExternalId: "34",
				});
				const first = Object.fromEntries(
					raw.columns.map((column, index) => [
						column.name,
						raw.rows[0]?.[index] ?? null,
					]),
				);
				const sourceRows = Number(first._eligibility_source_users ?? 0);
				const returnedRows = Number(first._eligibility_returned_users ?? 0);
				const excludedUsers = Number(first._eligibility_excluded_users ?? 0);
				const excludedOrganizations = Number(
					first._eligibility_excluded_organizations ?? 0,
				);
				const evidence = {
					sourceRows,
					returnedRows,
					excludedUsers,
					excludedOrganizations,
				};
				eligibility = {
					...eligibility,
					applied: true,
					capturedAt: new Date().toISOString(),
					contentHash: hash(evidence),
					excludedUsers,
					excludedOrganizations,
					excludedCustomers: excludedOrganizations,
					complete:
						Object.values(evidence).every(
							(value) => Number.isFinite(value) && value >= 0,
						) && returnedRows <= sourceRows,
					sourceRows,
					returnedRows,
				};
				const publicIndexes = raw.columns.flatMap((column, index) =>
					column.name.startsWith("_eligibility_") ? [] : [index],
				);
				result = {
					columns: publicIndexes.map((index) => {
						const column = raw.columns[index];
						if (!column) throw new Error("Pilot adoption column is missing.");
						return {
							name: column.name,
							displayName: column.displayName ?? column.name,
							baseType: column.baseType ?? "type/Text",
						};
					}),
					rows: raw.rows.map((row) =>
						publicIndexes.map((index) => {
							const value = row[index] ?? null;
							return value === null ||
								typeof value === "string" ||
								typeof value === "number"
								? value
								: String(value);
						}),
					),
				};
			}
			return {
				result,
				parsedQuery,
				verificationChecks: pilotAdoptionVerificationChecks({
					result,
					query: parsedQuery,
					queryText: adoptionQuery,
					registryCount: registry.entries.length,
					dataThrough: registry.dataThrough,
				}),
				eligibility,
			};
		}
		const result = await executeHubspotSalesQuery(this.db, query);
		const verificationChecks =
			parsedQuery.report === "active-pilot-summary"
				? pilotSummaryVerificationChecks(result, parsedQuery)
				: parsedQuery.report === "studio-bookings"
					? studioBookingsVerificationChecks(result, parsedQuery)
					: parsedQuery.report === "enterprise-bookings"
						? enterpriseBookingsVerificationChecks(result, parsedQuery)
						: [];
		return { result, parsedQuery, verificationChecks, eligibility: undefined };
	}

	async syncDashboard(number = 4) {
		const dashboard = await this.db.dashboard.findUnique({
			where: { number },
			select: {
				cards: {
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
		const source = await this.db.dataSource.findUnique({
			where: { key: SOURCE_KEY },
		});
		if (!source) throw new Error("HubSpot CRM has not been ingested yet.");
		const questions = [
			...new Map(
				dashboard.cards.map((card) => [card.question.id, card.question]),
			).values(),
		].filter(
			(question) =>
				question.sourceId === source.id &&
				question.versions[0]?.queryLanguage === "API",
		);
		const period = new Date().toISOString().slice(0, 7);
		const run = await this.db.syncRun.create({
			data: {
				runKey: `atlas:sales:${period}:${new Date().toISOString()}:${randomUUID()}`,
				sourceId: source.id,
				mode: SyncMode.INCREMENTAL,
				status: SyncRunStatus.RUNNING,
				scope: `dashboard:${number}`,
				period,
			},
		});
		let cardsProcessed = 0;
		let snapshotsCreated = 0;
		const errors: Array<{ number: number; message: string }> = [];
		for (const question of questions) {
			const version = question.versions[0];
			if (version?.queryLanguage !== "API") {
				errors.push({
					number: question.number,
					message: "Question has no HubSpot API version.",
				});
				continue;
			}
			try {
				const execution = await this.execute(version.queryText);
				const { result, verificationChecks, eligibility } = execution;
				const payload = { columns: result.columns, rows: result.rows };
				const contentHash = hash(payload);
				const externalId =
					question.sourceExternalId ?? `sales:question:${question.number}`;
				const capturedAt = new Date();
				const created = await this.db.resultSnapshot.createMany({
					data: [
						{
							idempotencyKey: `atlas:sales:${externalId}:v${version.version}:${period}:${contentHash}`,
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
					verificationChecks,
					eligibility,
				});
				await this.db.question.update({
					where: { id: question.id },
					data: { lastCheckedAt: capturedAt },
				});
				cardsProcessed += 1;
				snapshotsCreated += created.count;
			} catch (error) {
				errors.push({
					number: question.number,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
		const finishedAt = new Date();
		await this.db.syncRun.update({
			where: { id: run.id },
			data: {
				status:
					errors.length > 0 ? SyncRunStatus.FAILED : SyncRunStatus.COMPLETED,
				finishedAt,
				cardsProcessed,
				snapshotsCreated,
				error:
					errors.length > 0
						? errors
								.map((error) => `Q${error.number}: ${error.message}`)
								.join(" | ")
						: null,
				checkpoint: json({ errors }),
			},
		});
		return {
			runId: run.id,
			period,
			cardsProcessed,
			snapshotsCreated,
			errors,
		};
	}
}
