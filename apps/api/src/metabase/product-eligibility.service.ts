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
import { MarketingClient } from "../marketing/marketing.client";
import { marketingConfig } from "../marketing/marketing.config";
import { MetabaseClient, type MetabaseResult } from "./metabase.client";
import { metabaseConfig } from "./metabase.config";
import {
	type ProductEligibilityQuery,
	productEligibilityQuery,
} from "./product-eligibility.contracts";

const SOURCE_KEY = "atlas:product-eligibility";
const PAGE_SIZE = 1_000;
const FRESHNESS_MS = 8 * 60 * 60 * 1_000;

type AttributionRow = {
	period: string;
	organizationId: string;
	activityDate: string;
	userId: string;
	apiKeyId: string;
	generations: number;
	accruedValueUsd: number;
	lastActivityAt: Date;
};

type Principal = {
	eligible: boolean;
	ownerUserId: string;
};

type MonthResult = {
	period: string;
	professionalOrganizations: number;
	qualifiedThenDeletedOrganizations: number;
	deletedContributors: number;
};

type Analysis = {
	months: MonthResult[];
	complete: boolean;
	sourceRows: number;
	returnedRows: number;
	missingPrincipals: number;
	missingUserPrincipals: number;
	missingApiKeyPrincipals: number;
	unattributedOrganizations: number;
	excludedPrincipals: number;
	excludedOrganizations: number;
	capturedAt: Date;
	contentHash: string;
};

type GovernedResult = {
	result: MetabaseResult;
	eligibility: {
		applied: boolean;
		capturedAt: string;
		contentHash: string;
		excludedUsers: number;
		excludedOrganizations: number;
		excludedCustomers: number;
		complete: boolean;
		sourceRows: number;
		returnedRows: number;
	};
};

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sqlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown): boolean {
	return value === true || value === 1 || value === "1" || value === "true";
}

function date(value: unknown): Date {
	const parsed = new Date(String(value));
	if (!Number.isFinite(parsed.getTime()))
		throw new Error("Invalid source date.");
	return parsed;
}

function monthStart(value: Date): string {
	return value.toISOString().slice(0, 7);
}

function nextMonth(period: string): string {
	const [year, month] = period.split("-").map(Number);
	if (!year || !month) throw new Error(`Invalid period ${period}.`);
	return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}

function completeMonths(count: number): string[] {
	const current = new Date();
	const values: string[] = [];
	for (let offset = count; offset >= 1; offset -= 1) {
		values.push(
			monthStart(
				new Date(
					Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - offset, 1),
				),
			),
		);
	}
	return values;
}

function chunks<T>(values: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

function column(name: string, baseType: string) {
	return { name, displayName: name, baseType };
}

function parseQuery(queryText: string): ProductEligibilityQuery {
	let value: unknown;
	try {
		value = JSON.parse(queryText);
	} catch {
		throw new Error("Atlas product eligibility questions require valid JSON.");
	}
	return productEligibilityQuery.parse(value);
}

function incompleteMessage(analysis: Analysis): string {
	return `Product eligibility join is incomplete: ${analysis.missingPrincipals} principals could not be resolved (${analysis.missingUserPrincipals} users, ${analysis.missingApiKeyPrincipals} API keys).`;
}

@Injectable()
export class ProductEligibilityService {
	private readonly cache = new Map<
		string,
		{ expiresAt: number; value: Analysis }
	>();

	constructor(@InjectDatabase() private readonly db: Db) {}

	async preview(queryText: string): Promise<MetabaseResult> {
		const query = parseQuery(queryText);
		const analysis = await this.analyze(completeMonths(query.months));
		if (!analysis.complete) {
			throw new Error(incompleteMessage(analysis));
		}
		return this.deletedResult(analysis);
	}

	async governProfessionalResult(
		result: MetabaseResult,
	): Promise<GovernedResult> {
		const periods = result.rows
			.map((row) => text(row[0]).slice(0, 7))
			.filter((period) => /^\d{4}-\d{2}$/.test(period));
		const analysis = await this.analyze([...new Set(periods)]);
		if (!analysis.complete) throw new Error(incompleteMessage(analysis));
		return {
			result: {
				columns: result.columns,
				rows: analysis.months.map((month) => [
					`${month.period}-01T00:00:00.000Z`,
					month.professionalOrganizations,
				]),
			},
			eligibility: {
				applied: analysis.complete,
				capturedAt: analysis.capturedAt.toISOString(),
				contentHash: analysis.contentHash,
				excludedUsers: analysis.excludedPrincipals,
				excludedOrganizations: analysis.excludedOrganizations,
				excludedCustomers: 0,
				complete: analysis.complete,
				sourceRows: analysis.sourceRows,
				returnedRows: analysis.returnedRows,
			},
		};
	}

	async syncDashboard(number: number) {
		const dashboard = await this.db.dashboard.findUnique({
			where: { number },
			select: {
				cards: {
					select: {
						question: {
							select: {
								id: true,
								number: true,
								sourceId: true,
								sourceExternalId: true,
								source: { select: { key: true } },
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
		const questions = [
			...new Map(
				dashboard.cards.map((card) => [card.question.id, card.question]),
			).values(),
		].filter(
			(question) =>
				question.source?.key === SOURCE_KEY &&
				question.versions[0]?.queryLanguage === "API",
		);
		if (questions.length === 0) {
			throw new Error("This dashboard has no product eligibility questions.");
		}
		const sourceId = questions[0]?.sourceId;
		if (!sourceId)
			throw new Error("The product eligibility source is missing.");
		const source = await this.db.dataSource.findUniqueOrThrow({
			where: { id: sourceId },
		});
		const period = monthStart(new Date());
		const run = await this.db.syncRun.create({
			data: {
				runKey: `${SOURCE_KEY}:${period}:${randomUUID()}`,
				sourceId,
				mode: SyncMode.INCREMENTAL,
				status: SyncRunStatus.RUNNING,
				scope: `dashboard:${number}`,
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
		let checkpoint: Record<string, unknown> = {};
		for (const question of questions) {
			const version = question.versions[0];
			if (!version) continue;
			try {
				const query = parseQuery(version.queryText);
				const analysis = await this.analyze(completeMonths(query.months));
				if (!analysis.complete) {
					throw new Error(
						`Cross-source join is incomplete for ${analysis.missingPrincipals} principals (${analysis.missingUserPrincipals} users, ${analysis.missingApiKeyPrincipals} API keys).`,
					);
				}
				const result = this.deletedResult(analysis);
				const payload = { columns: result.columns, rows: result.rows };
				const contentHash = hash(payload);
				const externalId =
					question.sourceExternalId ?? `product-eligibility:${question.number}`;
				const created = await this.db.resultSnapshot.createMany({
					data: [
						{
							idempotencyKey: `${SOURCE_KEY}:${externalId}:v${version.version}:${period}:${contentHash}`,
							sourceId,
							dashboardExternalId: `atlas:${number}`,
							questionExternalId: externalId,
							reportingPeriod: period,
							capturedAt: analysis.capturedAt,
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
					data: { lastCheckedAt: analysis.capturedAt },
				});
				cardsProcessed += 1;
				snapshotsCreated += created.count;
				checkpoint = {
					complete: analysis.complete,
					sourceRows: analysis.sourceRows,
					returnedRows: analysis.returnedRows,
					missingPrincipals: analysis.missingPrincipals,
					missingUserPrincipals: analysis.missingUserPrincipals,
					missingApiKeyPrincipals: analysis.missingApiKeyPrincipals,
					unattributedOrganizations: analysis.unattributedOrganizations,
					contentHash: analysis.contentHash,
				};
			} catch (error) {
				errors.push({
					number: question.number,
					message:
						error instanceof Error ? error.message : "Unknown join error.",
				});
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
					checkpoint: json({ ...checkpoint, errors }),
				},
			}),
			this.db.dataSource.update({
				where: { id: source.id },
				data: {
					state: failed ? SourceStatus.ERROR : SourceStatus.HEALTHY,
					lastSyncAt: finishedAt,
					lastError,
					freshnessDeadlineAt: new Date(finishedAt.getTime() + FRESHNESS_MS),
				},
			}),
		]);
		return { runId: run.id, cardsProcessed, snapshotsCreated, errors };
	}

	private deletedResult(analysis: Analysis): MetabaseResult {
		return {
			columns: [
				column("period", "type/Date"),
				column("qualified_then_deleted_orgs", "type/Integer"),
			],
			rows: analysis.months.map((month) => [
				`${month.period}-01T00:00:00.000Z`,
				month.qualifiedThenDeletedOrganizations,
			]),
		};
	}

	private async analyze(periods: string[]): Promise<Analysis> {
		if (periods.length === 0)
			throw new Error("At least one month is required.");
		const sorted = [...periods].sort();
		const cacheKey = sorted.join(",");
		const cached = this.cache.get(cacheKey);
		if (cached && cached.expiresAt > Date.now()) return cached.value;
		const config = metabaseConfig();
		if (!config) throw new Error("Metabase is not configured.");
		const client = new MetabaseClient(config);
		const attribution = await this.attributionRows(client, sorted);
		const principals = await this.principals(client, attribution.rows);
		const deletions = await this.userDeletionEvents(principals);
		const rawOrganizations = new Map<string, Set<string>>();
		const organizations = new Map<
			string,
			{
				period: string;
				organizationId: string;
				days: Map<
					string,
					{ generations: number; accrued: number; lastAt: Date }
				>;
				contributors: Set<string>;
			}
		>();
		const missing = new Set<string>();
		const excluded = new Set<string>();
		const unattributed = new Set<string>();
		for (const row of attribution.rows) {
			const raw = rawOrganizations.get(row.period) ?? new Set<string>();
			raw.add(row.organizationId);
			rawOrganizations.set(row.period, raw);
			const principalKey = row.userId
				? `user:${row.userId}`
				: row.apiKeyId
					? `api:${row.apiKeyId}`
					: "";
			if (!principalKey) {
				unattributed.add(`${row.period}:${row.organizationId}`);
				continue;
			}
			const principal = principals.get(principalKey);
			if (!principal) {
				missing.add(principalKey);
				continue;
			}
			if (!principal.eligible) {
				excluded.add(principalKey);
				continue;
			}
			const key = `${row.period}:${row.organizationId}`;
			const organization = organizations.get(key) ?? {
				period: row.period,
				organizationId: row.organizationId,
				days: new Map(),
				contributors: new Set(),
			};
			const day = organization.days.get(row.activityDate) ?? {
				generations: 0,
				accrued: 0,
				lastAt: row.lastActivityAt,
			};
			day.generations += row.generations;
			day.accrued += row.accruedValueUsd;
			if (row.lastActivityAt > day.lastAt) day.lastAt = row.lastActivityAt;
			organization.days.set(row.activityDate, day);
			organization.contributors.add(principal.ownerUserId);
			organizations.set(key, organization);
		}
		const governedByMonth = new Map<string, number>();
		const deletedOrgsByMonth = new Map<string, number>();
		const deletedUsersByMonth = new Map<string, Set<string>>();
		for (const organization of organizations.values()) {
			let generations = 0;
			let accrued = 0;
			let activeDays = 0;
			let firstQualifiedAt: Date | null = null;
			const days = [...organization.days.values()].sort(
				(left, right) => left.lastAt.getTime() - right.lastAt.getTime(),
			);
			for (const day of days) {
				activeDays += 1;
				generations += day.generations;
				accrued += day.accrued;
				if (
					!firstQualifiedAt &&
					generations >= 3 &&
					accrued >= 100 &&
					activeDays >= 2
				) {
					firstQualifiedAt = day.lastAt;
				}
			}
			if (generations < 3 || organization.days.size < 2 || accrued < 100)
				continue;
			governedByMonth.set(
				organization.period,
				(governedByMonth.get(organization.period) ?? 0) + 1,
			);
			const deleted = [...organization.contributors].filter((ownerUserId) => {
				const deletedAt = deletions.get(ownerUserId);
				return firstQualifiedAt && deletedAt && deletedAt > firstQualifiedAt;
			});
			if (deleted.length === 0) continue;
			deletedOrgsByMonth.set(
				organization.period,
				(deletedOrgsByMonth.get(organization.period) ?? 0) + 1,
			);
			const users = deletedUsersByMonth.get(organization.period) ?? new Set();
			for (const ownerUserId of deleted) users.add(ownerUserId);
			deletedUsersByMonth.set(organization.period, users);
		}
		const months = sorted.map((period) => ({
			period,
			professionalOrganizations: governedByMonth.get(period) ?? 0,
			qualifiedThenDeletedOrganizations: deletedOrgsByMonth.get(period) ?? 0,
			deletedContributors: deletedUsersByMonth.get(period)?.size ?? 0,
		}));
		const rawCount = [...rawOrganizations.values()].reduce(
			(total, organizationsForMonth) => total + organizationsForMonth.size,
			0,
		);
		const governedCount = months.reduce(
			(total, month) => total + month.professionalOrganizations,
			0,
		);
		const capturedAt = new Date();
		const missingUserPrincipals = [...missing].filter((value) =>
			value.startsWith("user:"),
		).length;
		const missingApiKeyPrincipals = [...missing].filter((value) =>
			value.startsWith("api:"),
		).length;
		const value: Analysis = {
			months,
			complete:
				attribution.complete &&
				missing.size === 0 &&
				months.every((month) => rawOrganizations.has(month.period)),
			sourceRows: attribution.sourceRows,
			returnedRows: attribution.rows.length,
			missingPrincipals: missing.size,
			missingUserPrincipals,
			missingApiKeyPrincipals,
			unattributedOrganizations: unattributed.size,
			excludedPrincipals: excluded.size,
			excludedOrganizations: rawCount - governedCount,
			capturedAt,
			contentHash: hash({
				months,
				sourceRows: attribution.sourceRows,
				missingPrincipals: missing.size,
				excludedPrincipals: excluded.size,
				unattributedOrganizations: unattributed.size,
				deletionEvents: deletions.size,
			}),
		};
		this.cache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value });
		return value;
	}

	private async attributionRows(client: MetabaseClient, periods: string[]) {
		const start = `${periods[0]}-01 00:00:00`;
		const end = `${nextMonth(periods.at(-1) ?? periods[0] ?? "")}-01 00:00:00`;
		const rows: AttributionRow[] = [];
		let sourceRows = 0;
		for (let offset = 0; ; offset += PAGE_SIZE) {
			const result = await client.preview({
				language: "SQL",
				databaseExternalId: "166",
				queryText: `with professional as (
  select toStartOfMonth(generationCreatedAt) as month, organizationId
  from sync_prod.sync_usage3
  where generationCreatedAt >= toDateTime('${start}')
    and generationCreatedAt < toDateTime('${end}')
    and organizationId != ''
    and organizationPlanType in ('hobbyist','creator','growth','scale')
  group by month, organizationId
  having countDistinct(generationId) >= 3
    and countDistinct(toDate(generationCreatedAt)) >= 2
    and sum(generationCostMillicents) / 100000.0 >= 100
), attributed as (
  select
    toStartOfMonth(u.generationCreatedAt) as period,
    u.organizationId,
    toDate(u.generationCreatedAt) as activity_date,
    ifNull(u.userId, '') as user_id,
    ifNull(u.apiKeyId, '') as api_key_id,
    countDistinct(u.generationId) as generations,
    sum(u.generationCostMillicents) / 100000.0 as accrued_value_usd,
    max(u.generationCreatedAt) as last_activity_at
  from sync_prod.sync_usage3 u
  inner join professional p
    on p.month = toStartOfMonth(u.generationCreatedAt)
    and p.organizationId = u.organizationId
  where u.generationCreatedAt >= toDateTime('${start}')
    and u.generationCreatedAt < toDateTime('${end}')
    and u.organizationPlanType in ('hobbyist','creator','growth','scale')
  group by period, u.organizationId, activity_date, user_id, api_key_id
)
select *, count() over() as source_row_count
from attributed
order by period, organizationId, activity_date, user_id, api_key_id
limit ${PAGE_SIZE} offset ${offset}`,
			});
			for (const values of result.rows) {
				rows.push({
					period: text(values[0]).slice(0, 7),
					organizationId: text(values[1]),
					activityDate: text(values[2]).slice(0, 10),
					userId: text(values[3]),
					apiKeyId: text(values[4]),
					generations: number(values[5]),
					accruedValueUsd: number(values[6]),
					lastActivityAt: date(values[7]),
				});
				sourceRows = Math.max(sourceRows, number(values[8]));
			}
			if (result.rows.length < PAGE_SIZE) break;
		}
		return { rows, sourceRows, complete: rows.length === sourceRows };
	}

	private async principals(
		client: MetabaseClient,
		rows: AttributionRow[],
	): Promise<Map<string, Principal>> {
		const userIds = [...new Set(rows.map((row) => row.userId).filter(Boolean))];
		const apiKeyIds = [
			...new Set(rows.map((row) => row.apiKeyId).filter(Boolean)),
		];
		const principals = new Map<string, Principal>();
		for (const ids of chunks(userIds, 400)) {
			const result = await client.preview({
				language: "SQL",
				databaseExternalId: "34",
				queryText: `select
  'user' as principal_type,
  u.id::text as principal_id,
  u.id::text as owner_user_id,
  lower(coalesce(u.email, '')) as email,
  coalesce(u.banned, false) as banned,
  coalesce(u.is_anonymous, false) as is_anonymous
from auth.users u
where u.id::text in (${ids.map(sqlString).join(", ")})`,
			});
			this.addPrincipals(principals, result);
		}
		for (const ids of chunks(apiKeyIds, 400)) {
			const result = await client.preview({
				language: "SQL",
				databaseExternalId: "34",
				queryText: `select
  'api' as principal_type,
  k.id::text as principal_id,
  u.id::text as owner_user_id,
  lower(coalesce(u.email, '')) as email,
  coalesce(u.banned, false) as banned,
  coalesce(u.is_anonymous, false) as is_anonymous
from public.api_keys k
left join auth.users u on u.id = k.user_id
where k.id::text in (${ids.map(sqlString).join(", ")})`,
			});
			this.addPrincipals(principals, result);
		}
		return principals;
	}

	private async userDeletionEvents(
		principals: Map<string, Principal>,
	): Promise<Map<string, Date>> {
		const ownerUserIds = [
			...new Set(
				[...principals.values()].map((principal) => principal.ownerUserId),
			),
		];
		const client = new MarketingClient(marketingConfig());
		const deletions = new Map<string, Date>();
		for (const ids of chunks(ownerUserIds, 400)) {
			const result = await client.execute({
				source: "posthog",
				personPolicy: "all_events",
				query: `select
  distinct_id,
  min(timestamp) as deleted_at
from events
where event = 'user_account_deleted'
  and distinct_id in (${ids.map(sqlString).join(", ")})
group by distinct_id`,
			});
			for (const values of result.rows) {
				const ownerUserId = text(values[0]);
				if (ownerUserId && values[1])
					deletions.set(ownerUserId, date(values[1]));
			}
		}
		return deletions;
	}

	private addPrincipals(
		principals: Map<string, Principal>,
		result: MetabaseResult,
	) {
		for (const values of result.rows) {
			const type = text(values[0]);
			const id = text(values[1]);
			const ownerUserId = text(values[2]);
			if (!type || !id || !ownerUserId) continue;
			const email = text(values[3]).toLowerCase();
			const banned = bool(values[4]);
			const anonymous = bool(values[5]);
			principals.set(`${type}:${id}`, {
				eligible:
					!banned &&
					!anonymous &&
					!email.endsWith("@sync.so") &&
					!email.endsWith("@sync.labs"),
				ownerUserId,
			});
		}
	}
}
