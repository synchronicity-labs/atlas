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
import { MetabaseClient } from "../metabase/metabase.client";
import { metabaseConfig } from "../metabase/metabase.config";
import { assertReadOnlyQuery } from "../questions/read-only-query";
import {
	type EconomicsQuery,
	economicsQuery,
	type ModalImport,
} from "./economics.contracts";

const ECONOMICS_SOURCE = "atlas:economics";
const MODAL_SOURCE = "modal:billing";
const MODAL_RAW_QUESTION = "economics:modal:cost-by-model-raw";
const FRESHNESS_MS = 8 * 60 * 60 * 1000;
const MODAL_FRESHNESS_MS = 30 * 60 * 60 * 1000;

export const ECONOMICS_WAREHOUSE_QUERY = `with now('UTC') as end_utc
select
  toStartOfMonth("generationEndedAt", 'UTC') as month,
  ifNull(nullIf(model, ''), 'unknown') as model,
  sumIf("frameCount", "organizationPlanType" is null or "organizationPlanType" = '') as free_frames,
  sumIf("frameCount", "organizationPlanType" is not null and "organizationPlanType" <> '') as paid_frames,
  sumIf("generationCostMillicents", "organizationPlanType" is not null and "organizationPlanType" <> '') / 100000.0 as usage_revenue_usd
from sync_prod.sync_usage3
where "generationEndedAt" >= addMonths(toStartOfMonth(end_utc, 'UTC'), -6)
  and "generationEndedAt" < end_utc
group by month, model
order by month, model`;

type Result = {
	columns: Array<{
		name: string;
		displayName: string | null;
		baseType: string | null;
	}>;
	rows: unknown[][];
};

type WarehouseRow = {
	month: string;
	model: string;
	freeFrames: number;
	paidFrames: number;
	usageRevenueUsd: number;
};

type ModalRow = { month: string; model: string; costUsd: number };

type MonthlyEconomics = {
	month: string;
	usageRevenueUsd: number;
	freeInferenceCostUsd: number;
	paidInferenceCostUsd: number;
	prodInferenceCostUsd: number;
	totalModalCostUsd: number;
	stagingOtherCostUsd: number;
	contributionMarginUsd: number;
	contributionMarginPct: number;
	freeFrames: number;
	paidFrames: number;
	estimated: boolean;
};

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function month(value: unknown): string {
	return String(value ?? "").slice(0, 7);
}

function column(name: string, displayName: string, baseType = "type/Decimal") {
	return { name, displayName, baseType };
}

@Injectable()
export class EconomicsService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async preview(queryText: string): Promise<Result> {
		return this.execute(economicsQuery.parse(JSON.parse(queryText)));
	}

	async importModal(input: ModalImport) {
		const source = await this.db.dataSource.findUnique({
			where: { key: MODAL_SOURCE },
		});
		if (!source) throw new Error("The Modal billing source is not configured.");
		const normalized = input.rows
			.map((row) => ({
				month: row.month,
				model: normalizeModel(row.model),
				costUsd: row.costUsd,
			}))
			.sort((a, b) =>
				`${a.month}:${a.model}`.localeCompare(`${b.month}:${b.model}`),
			);
		const payload = { collector: input.collector, rows: normalized };
		const contentHash = hash(payload);
		const reportingPeriod = normalized.at(-1)?.month ?? month(input.capturedAt);
		const capturedAt = new Date(input.capturedAt);
		const created = await this.db.resultSnapshot.createMany({
			data: [
				{
					idempotencyKey: `${MODAL_SOURCE}:${reportingPeriod}:${contentHash}`,
					sourceId: source.id,
					dashboardExternalId: "atlas:6",
					questionExternalId: MODAL_RAW_QUESTION,
					reportingPeriod,
					capturedAt,
					contentHash,
					columns: json([
						column("month", "Month", "type/DateTime"),
						column("model", "Model", "type/Text"),
						column("cost_usd", "Modal cost"),
					]),
					rows: json(
						normalized.map((row) => [row.month, row.model, row.costUsd]),
					),
					rowCount: normalized.length,
				},
			],
			skipDuplicates: true,
		});
		await this.db.dataSource.update({
			where: { id: source.id },
			data: {
				state: SourceStatus.HEALTHY,
				lastSyncAt: capturedAt,
				lastError: null,
				freshnessDeadlineAt: new Date(
					capturedAt.getTime() + MODAL_FRESHNESS_MS,
				),
			},
		});
		return {
			reportingPeriod,
			rows: normalized.length,
			snapshotCreated: created.count === 1,
		};
	}

	async syncDashboard(number = 6) {
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
		].filter((question) => {
			const version = question.versions[0];
			if (version?.queryLanguage !== "API") return false;
			try {
				economicsQuery.parse(JSON.parse(version.queryText));
				return true;
			} catch {
				return false;
			}
		});
		const source = await this.db.dataSource.findUnique({
			where: { key: ECONOMICS_SOURCE },
		});
		if (
			!source ||
			questions.length === 0 ||
			questions.some((question) => question.sourceId !== source.id)
		) {
			throw new Error("The inference economics source is not configured.");
		}
		const reportingPeriod = new Date().toISOString().slice(0, 7);
		const run = await this.db.syncRun.create({
			data: {
				runKey: `${ECONOMICS_SOURCE}:${reportingPeriod}:${randomUUID()}`,
				sourceId: source.id,
				mode: SyncMode.INCREMENTAL,
				status: SyncRunStatus.RUNNING,
				scope: `dashboard:${number}`,
				period: reportingPeriod,
			},
		});
		await this.db.dataSource.update({
			where: { id: source.id },
			data: { state: SourceStatus.SYNCING, lastError: null },
		});
		let cardsProcessed = 0;
		let snapshotsCreated = 0;
		try {
			for (const question of questions) {
				const version = question.versions[0];
				if (!version) continue;
				const result = await this.execute(
					economicsQuery.parse(JSON.parse(version.queryText)),
				);
				const payload = { columns: result.columns, rows: result.rows };
				const contentHash = hash(payload);
				const externalId =
					question.sourceExternalId ?? `economics:question:${question.number}`;
				const created = await this.db.resultSnapshot.createMany({
					data: [
						{
							idempotencyKey: `${ECONOMICS_SOURCE}:${externalId}:v${version.version}:${reportingPeriod}:${contentHash}`,
							sourceId: source.id,
							dashboardExternalId: `atlas:${number}`,
							questionExternalId: externalId,
							reportingPeriod,
							capturedAt: new Date(),
							contentHash,
							columns: json(result.columns),
							rows: json(result.rows),
							rowCount: result.rows.length,
						},
					],
					skipDuplicates: true,
				});
				cardsProcessed += 1;
				snapshotsCreated += created.count;
			}
			const finishedAt = new Date();
			await this.db.$transaction([
				this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: SyncRunStatus.COMPLETED,
						finishedAt,
						cardsProcessed,
						snapshotsCreated,
					},
				}),
				this.db.dataSource.update({
					where: { id: source.id },
					data: {
						state: SourceStatus.HEALTHY,
						lastSyncAt: finishedAt,
						lastError: null,
						freshnessDeadlineAt: new Date(Date.now() + FRESHNESS_MS),
					},
				}),
			]);
			return { cardsProcessed, snapshotsCreated, errors: [] };
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Unknown economics sync error.";
			await this.db.$transaction([
				this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: SyncRunStatus.FAILED,
						finishedAt: new Date(),
						error: message,
						cardsProcessed,
						snapshotsCreated,
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

	private async execute(query: EconomicsQuery): Promise<Result> {
		const modal = await this.db.resultSnapshot.findFirst({
			where: { questionExternalId: MODAL_RAW_QUESTION },
			orderBy: { capturedAt: "desc" },
			select: { capturedAt: true, rows: true },
		});
		if (!modal) {
			throw new Error("Modal billing has no imported aggregate snapshot.");
		}
		if (Date.now() - modal.capturedAt.getTime() > MODAL_FRESHNESS_MS) {
			throw new Error(
				"Modal billing aggregate is stale and must be re-imported.",
			);
		}
		const config = metabaseConfig();
		if (!config) throw new Error("Metabase is not configured.");
		const warehouseSql = query.warehouseSql ?? ECONOMICS_WAREHOUSE_QUERY;
		assertReadOnlyQuery("SQL", warehouseSql);
		const warehouse = await new MetabaseClient(config).preview({
			language: "SQL",
			queryText: warehouseSql,
			databaseExternalId: "166",
		});
		const warehouseRows = warehouse.rows.map((row) => ({
			month: month(row[0]),
			model: normalizeModel(String(row[1] ?? "unknown")),
			freeFrames: Number(row[2] ?? 0),
			paidFrames: Number(row[3] ?? 0),
			usageRevenueUsd: Number(row[4] ?? 0),
		}));
		const modalRows = (modal.rows as unknown[][]).map((row) => ({
			month: month(row[0]),
			model: normalizeModel(String(row[1] ?? "other")),
			costUsd: Number(row[2] ?? 0),
		}));
		return economicsResult(query, warehouseRows, modalRows);
	}
}

export function economicsResult(
	query: EconomicsQuery,
	warehouseRows: WarehouseRow[],
	modalRows: ModalRow[],
): Result {
	const monthly = buildMonthlyEconomics(warehouseRows, modalRows).slice(
		-query.months,
	);
	if (query.report === "modal-spend") {
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("total_modal_cost_usd", "Total Modal spend"),
			],
			rows: monthly.map((row) => [row.month, row.totalModalCostUsd]),
		};
	}
	if (query.report === "prod-inference-cost") {
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("prod_inference_cost_usd", "Production inference cost"),
			],
			rows: monthly.map((row) => [row.month, row.prodInferenceCostUsd]),
		};
	}
	if (query.report === "usage-revenue") {
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("usage_revenue_usd", "Usage revenue"),
			],
			rows: monthly.map((row) => [row.month, row.usageRevenueUsd]),
		};
	}
	if (query.report === "margin-pct") {
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("contribution_margin_pct", "Inference contribution margin"),
			],
			rows: monthly.map((row) => [row.month, row.contributionMarginPct]),
		};
	}
	if (query.report === "margin-history") {
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("usage_revenue_usd", "Usage revenue"),
				column("prod_inference_cost_usd", "Production inference cost"),
				column("contribution_margin_usd", "Contribution margin"),
			],
			rows: monthly.map((row) => [
				row.month,
				row.usageRevenueUsd,
				row.prodInferenceCostUsd,
				row.contributionMarginUsd,
			]),
		};
	}
	if (query.report === "frames-by-tier") {
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("free_frames", "Free frames", "type/Integer"),
				column("paid_frames", "Paid frames", "type/Integer"),
			],
			rows: monthly.map((row) => [row.month, row.freeFrames, row.paidFrames]),
		};
	}
	const models = [
		...new Set(modalRows.map((row) => normalizeModel(row.model))),
	].sort();
	const byMonth = new Map<string, Map<string, number>>();
	for (const row of modalRows) {
		const values = byMonth.get(row.month) ?? new Map<string, number>();
		values.set(row.model, (values.get(row.model) ?? 0) + row.costUsd);
		byMonth.set(row.month, values);
	}
	return {
		columns: [
			column("month", "Month", "type/DateTime"),
			...models.map((model) => column(model, model)),
		],
		rows: [...byMonth.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.slice(-query.months)
			.map(([period, values]) => [
				period,
				...models.map((model) => values.get(model) ?? 0),
			]),
	};
}

export function buildMonthlyEconomics(
	warehouseRows: WarehouseRow[],
	modalRows: ModalRow[],
): MonthlyEconomics[] {
	const frames = new Map<
		string,
		Map<string, { free: number; paid: number; usageRevenueUsd: number }>
	>();
	for (const row of warehouseRows) {
		const models = frames.get(row.month) ?? new Map();
		const current = models.get(row.model) ?? {
			free: 0,
			paid: 0,
			usageRevenueUsd: 0,
		};
		current.free += row.freeFrames;
		current.paid += row.paidFrames;
		current.usageRevenueUsd += row.usageRevenueUsd;
		models.set(row.model, current);
		frames.set(row.month, models);
	}
	const modal = new Map<string, Map<string, number>>();
	for (const row of modalRows) {
		const models = modal.get(row.month) ?? new Map();
		models.set(row.model, (models.get(row.model) ?? 0) + row.costUsd);
		modal.set(row.month, models);
	}
	const actualCostByModel = new Map<string, number>();
	const actualFramesByModel = new Map<string, number>();
	for (const [period, costs] of modal) {
		const periodFrames = frames.get(period);
		if (!periodFrames) continue;
		for (const [model, cost] of costs) {
			const modelFrames = periodFrames.get(model);
			const total = (modelFrames?.free ?? 0) + (modelFrames?.paid ?? 0);
			if (total > 0) {
				actualCostByModel.set(
					model,
					(actualCostByModel.get(model) ?? 0) + cost,
				);
				actualFramesByModel.set(
					model,
					(actualFramesByModel.get(model) ?? 0) + total,
				);
			}
		}
	}
	const costPerFrame = new Map(
		[...actualCostByModel].map(([model, cost]) => [
			model,
			cost / (actualFramesByModel.get(model) ?? 1),
		]),
	);
	return [...frames.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([period, models]) => {
			const actual = modal.get(period);
			let freeCost = 0;
			let paidCost = 0;
			let usageRevenueUsd = 0;
			let freeFrames = 0;
			let paidFrames = 0;
			for (const [model, values] of models) {
				freeFrames += values.free;
				paidFrames += values.paid;
				usageRevenueUsd += values.usageRevenueUsd;
				const total = values.free + values.paid;
				const cost =
					actual?.get(model) ?? total * (costPerFrame.get(model) ?? 0);
				if (total > 0) {
					freeCost += cost * (values.free / total);
					paidCost += cost * (values.paid / total);
				}
			}
			const prodCost = freeCost + paidCost;
			const totalModalCost = actual
				? [...actual.values()].reduce((sum, value) => sum + value, 0)
				: prodCost;
			const margin = usageRevenueUsd - prodCost;
			return {
				month: `${period}-01T00:00:00.000Z`,
				usageRevenueUsd,
				freeInferenceCostUsd: freeCost,
				paidInferenceCostUsd: paidCost,
				prodInferenceCostUsd: prodCost,
				totalModalCostUsd: totalModalCost,
				stagingOtherCostUsd: Math.max(0, totalModalCost - prodCost),
				contributionMarginUsd: margin,
				contributionMarginPct:
					usageRevenueUsd > 0 ? (margin / usageRevenueUsd) * 100 : 0,
				freeFrames,
				paidFrames,
				estimated: actual == null,
			};
		});
}

function normalizeModel(model: string): string {
	const value = model.trim().toLowerCase();
	if (value === "sync-1.9.0-beta") return "sync-1.9";
	if (value === "sync-3.0") return "sync-3";
	return value || "other";
}
