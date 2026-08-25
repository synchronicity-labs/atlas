import type { Db } from "./client";
import { ExternalRecordKind } from "./generated/prisma/enums";

export type HubspotSalesQuery = {
	report:
		| "open-pipeline"
		| "weighted-pipeline"
		| "closed-won"
		| "closed-won-by-company"
		| "deals-created"
		| "win-rate"
		| "pipeline-by-stage"
		| "pipeline-by-owner"
		| "sales-cycle"
		| "open-deal-forecast"
		| "open-deals"
		| "deal-revenue-forecast-by-stage"
		| "contact-deal-totals"
		| "team-activity-totals"
		| "closed-deal-vs-goal"
		| "lead-pipeline-status"
		| "lead-stage-view"
		| "active-pilot-summary";
	months: number;
	pipelines: string[];
};

export type HubspotSalesResult = {
	columns: Array<{
		name: string;
		displayName: string;
		baseType: string;
	}>;
	rows: Array<Array<string | number | null>>;
};

type JsonRecord = Record<string, unknown>;

type DealRecord = {
	id: string;
	name: string;
	companyIds: string[];
	pipelineId: string;
	stageId: string;
	ownerId: string;
	amount: number;
	weightedAmount: number;
	isClosed: boolean;
	isWon: boolean;
	createdAt: Date | null;
	closeAt: Date | null;
	daysToClose: number | null;
	stageHistory: Array<{ stageId: string; changedAt: Date }>;
};

type PipelineRecord = {
	id: string;
	label: string;
	order: number;
	stages: Map<string, { label: string; order: number; probability: number }>;
};

function record(value: unknown): JsonRecord {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: {};
}

function stringValue(value: unknown): string {
	return value === null || value === undefined ? "" : String(value).trim();
}

function numberValue(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown): Date | null {
	const source = stringValue(value);
	if (!source) return null;
	const parsed = new Date(source);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function booleanValue(value: unknown): boolean {
	return value === true || value === "true" || value === "1" || value === 1;
}

function column(name: string, displayName: string, baseType: string) {
	return { name, displayName, baseType };
}

function monthKey(value: Date): string {
	return value.toISOString().slice(0, 7);
}

function monthIso(key: string): string {
	return `${key}-01T00:00:00.000Z`;
}

function monthKeys(count: number): string[] {
	const now = new Date();
	return Array.from({ length: count }, (_, index) => {
		const value = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count + index + 1, 1),
		);
		return monthKey(value);
	});
}

function futureMonthKeys(count: number): string[] {
	const now = new Date();
	return Array.from({ length: count }, (_, index) => {
		const value = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index, 1),
		);
		return monthKey(value);
	});
}

function pipelineFilter(deal: DealRecord, query: HubspotSalesQuery): boolean {
	return (
		query.pipelines.length === 0 || query.pipelines.includes(deal.pipelineId)
	);
}

export function parseHubspotSalesQuery(value: unknown): HubspotSalesQuery {
	const input = record(value);
	if (input.source !== "hubspot") {
		throw new Error("Sales questions require the HubSpot source.");
	}
	const report = stringValue(input.report) as HubspotSalesQuery["report"];
	const supported = new Set<HubspotSalesQuery["report"]>([
		"open-pipeline",
		"weighted-pipeline",
		"closed-won",
		"closed-won-by-company",
		"deals-created",
		"win-rate",
		"pipeline-by-stage",
		"pipeline-by-owner",
		"sales-cycle",
		"open-deal-forecast",
		"open-deals",
		"deal-revenue-forecast-by-stage",
		"contact-deal-totals",
		"team-activity-totals",
		"closed-deal-vs-goal",
		"lead-pipeline-status",
		"lead-stage-view",
		"active-pilot-summary",
	]);
	if (!supported.has(report))
		throw new Error("Unsupported HubSpot sales report.");
	const months = Math.min(
		24,
		Math.max(1, Math.trunc(numberValue(input.months) || 6)),
	);
	const pipelines = Array.isArray(input.pipelines)
		? input.pipelines.map(stringValue).filter(Boolean)
		: [];
	return { report, months, pipelines };
}

function parsePipeline(
	payload: unknown,
	fallbackOrder: number,
): PipelineRecord {
	const value = record(payload);
	const stages = Array.isArray(value.stages) ? value.stages : [];
	return {
		id: stringValue(value.id),
		label: stringValue(value.label) || stringValue(value.id),
		order: numberValue(value.displayOrder) || fallbackOrder,
		stages: new Map(
			stages.map((stage, index) => {
				const item = record(stage);
				const metadata = record(item.metadata);
				return [
					stringValue(item.id),
					{
						label: stringValue(item.label) || stringValue(item.id),
						order: numberValue(item.displayOrder) || index,
						probability: numberValue(metadata.probability),
					},
				] as const;
			}),
		),
	};
}

function parseDeal(payload: unknown, sourceCreatedAt: Date | null): DealRecord {
	const value = record(payload);
	const properties = record(value.properties);
	const amount = numberValue(
		properties.amount_in_home_currency ?? properties.amount,
	);
	const probability = numberValue(properties.hs_deal_stage_probability);
	const weighted = numberValue(
		properties.hs_projected_amount_in_home_currency ??
			properties.hs_projected_amount ??
			properties.hs_forecast_amount,
	);
	const history = record(value.propertyHistory);
	const stageHistory = Array.isArray(history.dealstage)
		? history.dealstage.flatMap((entry) => {
				const item = record(entry);
				const stageId = stringValue(item.value);
				const changedAt = dateValue(item.timestamp);
				return stageId && changedAt ? [{ stageId, changedAt }] : [];
			})
		: [];
	return {
		id: stringValue(value.id),
		name:
			stringValue(properties.dealname) ||
			`HubSpot deal ${stringValue(value.id)}`,
		companyIds: Array.isArray(value.companyIds)
			? value.companyIds.map(stringValue).filter(Boolean)
			: [],
		pipelineId: stringValue(properties.pipeline),
		stageId: stringValue(properties.dealstage),
		ownerId: stringValue(properties.hubspot_owner_id),
		amount,
		weightedAmount: weighted || amount * probability,
		isClosed: booleanValue(properties.hs_is_closed),
		isWon: booleanValue(properties.hs_is_closed_won),
		createdAt: dateValue(properties.createdate) ?? sourceCreatedAt,
		closeAt: dateValue(properties.closedate),
		daysToClose:
			properties.days_to_close === null ||
			properties.days_to_close === undefined
				? null
				: numberValue(properties.days_to_close),
		stageHistory,
	};
}

type PilotSummaryDeal = Pick<
	DealRecord,
	| "id"
	| "name"
	| "companyIds"
	| "pipelineId"
	| "stageId"
	| "ownerId"
	| "createdAt"
	| "stageHistory"
>;

type PilotSummaryPipeline = {
	stages: Map<string, string | { label: string }>;
};

export function buildActivePilotSummary(input: {
	now: Date;
	dataThrough: Date;
	deals: PilotSummaryDeal[];
	pipelines: Map<string, PilotSummaryPipeline>;
	owners: Map<string, string>;
	companies: Map<string, string>;
}): HubspotSalesResult {
	const weekStart = new Date(input.now);
	weekStart.setUTCHours(0, 0, 0, 0);
	weekStart.setUTCDate(
		weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7),
	);
	const active = input.deals.filter((deal) =>
		pilotStage(input.pipelines, deal),
	);
	const entered = new Set<string>();
	const exited = new Set<string>();
	for (const deal of input.deals) {
		let wasPilot = false;
		for (const history of [...deal.stageHistory].sort(
			(a, b) => a.changedAt.getTime() - b.changedAt.getTime(),
		)) {
			const isPilot = pilotStage(input.pipelines, {
				...deal,
				stageId: history.stageId,
			});
			if (history.changedAt >= weekStart) {
				if (!wasPilot && isPilot) entered.add(deal.id);
				if (wasPilot && !isPilot) exited.add(deal.id);
			}
			wasPilot = isPilot;
		}
		if (
			deal.stageHistory.length === 0 &&
			deal.createdAt &&
			deal.createdAt >= weekStart &&
			pilotStage(input.pipelines, deal)
		) {
			entered.add(deal.id);
		}
	}
	const accounts = active
		.map((deal) => input.companies.get(deal.companyIds[0] ?? "") ?? deal.name)
		.sort();
	const owners = [
		...new Set(
			active.map((deal) => input.owners.get(deal.ownerId) ?? "Unassigned"),
		),
	].sort();
	return {
		columns: [
			column("week_start", "Week start", "type/DateTime"),
			column("active_pilots", "Active pilots", "type/Integer"),
			column("new_pilots", "New pilots", "type/Integer"),
			column("exited_pilots", "Exited pilots", "type/Integer"),
			column("pilot_accounts", "Pilot accounts", "type/Text"),
			column("owners", "Owners", "type/Text"),
			column("data_through", "Data through", "type/DateTime"),
		],
		rows: [
			[
				weekStart.toISOString(),
				active.length,
				entered.size,
				exited.size,
				accounts.join("; "),
				owners.join("; "),
				input.dataThrough.toISOString(),
			],
		],
	};
}

function pilotStage(
	pipelines: Map<string, PilotSummaryPipeline>,
	deal: Pick<PilotSummaryDeal, "pipelineId" | "stageId">,
): boolean {
	const value = pipelines.get(deal.pipelineId)?.stages.get(deal.stageId);
	const label = typeof value === "string" ? value : value?.label;
	return ["pilot", "pilot/poc"].includes(label?.trim().toLowerCase() ?? "");
}

function metricRows(payload: unknown): Array<{
	key: string;
	label: string;
	current: number | null;
	previous: number | null;
	changePct: number | null;
	status: string;
	error: string;
}> {
	const value = record(payload);
	const metrics = Array.isArray(value.metrics) ? value.metrics : [];
	return metrics.map((metric) => {
		const item = record(metric);
		return {
			key: stringValue(item.key),
			label: stringValue(item.label),
			current:
				item.current === null || item.current === undefined
					? null
					: numberValue(item.current),
			previous:
				item.previous === null || item.previous === undefined
					? null
					: numberValue(item.previous),
			changePct:
				item.changePct === null || item.changePct === undefined
					? null
					: numberValue(item.changePct),
			status: stringValue(item.status),
			error: stringValue(item.error),
		};
	});
}

function dayKey(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function dailyKeys(count: number): string[] {
	const now = new Date();
	const today = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	);
	return Array.from({ length: count }, (_, index) =>
		dayKey(new Date(today - (count - index - 1) * 24 * 60 * 60 * 1000)),
	);
}

export async function executeHubspotSalesQuery(
	db: Db,
	input: unknown,
): Promise<HubspotSalesResult> {
	const query = parseHubspotSalesQuery(input);
	const source = await db.dataSource.findUnique({
		where: { key: "hubspot:crm" },
		select: { id: true, lastSyncAt: true },
	});
	if (!source) throw new Error("HubSpot CRM has not been ingested yet.");
	const [dealRows, pipelineRows, ownerRows, companyRows, activityRows] =
		await Promise.all([
			db.sourceRecord.findMany({
				where: { sourceId: source.id, kind: ExternalRecordKind.DEAL },
				select: { payload: true, sourceCreatedAt: true },
			}),
			db.sourceRecord.findMany({
				where: { sourceId: source.id, kind: ExternalRecordKind.PIPELINE },
				select: { payload: true },
			}),
			db.sourceRecord.findMany({
				where: { sourceId: source.id, kind: ExternalRecordKind.OWNER },
				select: { externalId: true, payload: true },
			}),
			db.sourceRecord.findMany({
				where: { sourceId: source.id, kind: ExternalRecordKind.COMPANY },
				select: {
					externalId: true,
					companyId: true,
				},
			}),
			db.sourceRecord.findMany({
				where: { sourceId: source.id, kind: ExternalRecordKind.ACTIVITY },
				select: { externalId: true, payload: true },
			}),
		]);
	const pipelines = new Map(
		pipelineRows.map((row, index) => {
			const pipeline = parsePipeline(row.payload, index);
			return [pipeline.id, pipeline] as const;
		}),
	);
	const owners = new Map(
		ownerRows.map((row) => {
			const value = record(row.payload);
			const name = [stringValue(value.firstName), stringValue(value.lastName)]
				.filter(Boolean)
				.join(" ");
			return [row.externalId, name || stringValue(value.email) || "Unassigned"];
		}),
	);
	const linkedCompanies = (await db.company.findMany({
		where: {
			id: {
				in: companyRows.flatMap((row) =>
					row.companyId ? [row.companyId] : [],
				),
			},
		},
		select: { id: true, name: true, domain: true },
	})) as Array<{ id: string; name: string; domain: string | null }>;
	const companyNames = new Map<string, string>(
		linkedCompanies.map((company) => [
			company.id,
			company.name || company.domain || "Unknown company",
		]),
	);
	const companies = new Map<string, string>(
		companyRows.map((row) => [
			row.externalId,
			(row.companyId && companyNames.get(row.companyId)) || "Unknown company",
		]),
	);
	const deals = dealRows
		.map((row) => parseDeal(row.payload, row.sourceCreatedAt))
		.filter((deal) => pipelineFilter(deal, query));
	const currentPeriod = monthIso(monthKey(new Date()));
	const openDeals = deals.filter((deal) => !deal.isClosed);
	const activities = new Map(
		activityRows.map((row) => [row.externalId, row.payload] as const),
	);
	if (query.report === "active-pilot-summary") {
		return buildActivePilotSummary({
			now: new Date(),
			dataThrough: source.lastSyncAt ?? new Date(0),
			deals,
			pipelines,
			owners,
			companies,
		});
	}

	if (
		query.report === "contact-deal-totals" ||
		query.report === "team-activity-totals"
	) {
		const externalId =
			query.report === "contact-deal-totals"
				? "report:contact-deal-totals"
				: "report:team-activity-totals";
		return {
			columns: [
				column("metric", "Metric", "type/Text"),
				column("value", "Value", "type/Decimal"),
				column("previous_value", "Previous value", "type/Decimal"),
				column("change_pct", "Change", "type/Decimal"),
				column("status", "Status", "type/Text"),
				column("error", "Source note", "type/Text"),
			],
			rows: metricRows(activities.get(externalId)).map((metric) => [
				metric.label || metric.key,
				metric.current,
				metric.previous,
				metric.changePct,
				metric.status,
				metric.error || null,
			]),
		};
	}

	if (
		query.report === "lead-pipeline-status" ||
		query.report === "lead-stage-view"
	) {
		const payload = record(activities.get("report:lead-stage-view"));
		if (stringValue(payload.status) === "unavailable") {
			throw new Error(
				stringValue(payload.error) ||
					"HubSpot lead stages are unavailable with the current read access.",
			);
		}
		const stages = Array.isArray(payload.stages) ? payload.stages : [];
		return {
			columns: [
				column(
					"stage",
					query.report === "lead-pipeline-status"
						? "Pipeline stage category"
						: "Pipeline stage category id",
					"type/Text",
				),
				column("leads", "Leads", "type/Integer"),
			],
			rows: stages.map((stage) => {
				const item = record(stage);
				return [
					query.report === "lead-pipeline-status"
						? stringValue(item.label)
						: stringValue(item.key),
					numberValue(item.count),
				];
			}),
		};
	}

	if (query.report === "deal-revenue-forecast-by-stage") {
		const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		const matching = deals.filter(
			(deal) =>
				deal.closeAt && deal.closeAt >= start && deal.closeAt <= new Date(),
		);
		const grouped = new Map<
			string,
			{
				pipeline: string;
				stage: string;
				probability: number;
				deals: number;
				forecast: number;
			}
		>();
		for (const deal of matching) {
			const pipeline = pipelines.get(deal.pipelineId);
			const stage = pipeline?.stages.get(deal.stageId);
			const key = `${deal.pipelineId}:${deal.stageId}`;
			const current = grouped.get(key) ?? {
				pipeline: pipeline?.label ?? deal.pipelineId,
				stage: stage?.label ?? deal.stageId,
				probability: stage?.probability ?? 0,
				deals: 0,
				forecast: 0,
			};
			current.deals += 1;
			current.forecast += deal.weightedAmount;
			grouped.set(key, current);
		}
		return {
			columns: [
				column("stage", "Deal stage", "type/Text"),
				column("probability_pct", "Probability", "type/Decimal"),
				column("deal_count", "Deals", "type/Integer"),
				column("forecast_amount", "Forecast amount", "type/Decimal"),
			],
			rows: [...grouped.values()]
				.filter((value) => value.forecast > 0)
				.sort((a, b) => b.forecast - a.forecast)
				.map((value) => [
					`${value.stage} (${value.pipeline})`,
					value.probability * 100,
					value.deals,
					value.forecast,
				]),
		};
	}

	if (query.report === "closed-deal-vs-goal") {
		const days = dailyKeys(30);
		let cumulative = 0;
		return {
			columns: [
				column("date", "Close date", "type/DateTime"),
				column("closed_amount", "Closed amount", "type/Decimal"),
				column("revenue_goal", "Revenue goal", "type/Decimal"),
			],
			rows: days.map((day) => {
				cumulative += deals
					.filter(
						(deal) =>
							deal.isWon && deal.closeAt && dayKey(deal.closeAt) === day,
					)
					.reduce((sum, deal) => sum + deal.amount, 0);
				return [`${day}T00:00:00.000Z`, cumulative, 0];
			}),
		};
	}

	if (query.report === "open-pipeline") {
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("open_pipeline_amount", "Open pipeline", "type/Decimal"),
			],
			rows: [
				[currentPeriod, openDeals.reduce((sum, deal) => sum + deal.amount, 0)],
			],
		};
	}
	if (query.report === "weighted-pipeline") {
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("weighted_pipeline_amount", "Weighted pipeline", "type/Decimal"),
			],
			rows: [
				[
					currentPeriod,
					openDeals.reduce((sum, deal) => sum + deal.weightedAmount, 0),
				],
			],
		};
	}
	if (query.report === "pipeline-by-stage") {
		const grouped = new Map<
			string,
			{ deals: number; amount: number; weighted: number }
		>();
		for (const deal of openDeals) {
			const key = `${deal.pipelineId}:${deal.stageId}`;
			const current = grouped.get(key) ?? { deals: 0, amount: 0, weighted: 0 };
			current.deals += 1;
			current.amount += deal.amount;
			current.weighted += deal.weightedAmount;
			grouped.set(key, current);
		}
		const rows = [...grouped.entries()]
			.map(([key, value]) => {
				const [pipelineId, stageId] = key.split(":");
				const pipeline = pipelines.get(pipelineId ?? "");
				const stage = pipeline?.stages.get(stageId ?? "");
				return {
					order: (pipeline?.order ?? 999) * 100 + (stage?.order ?? 99),
					row: [
						pipeline?.label ?? pipelineId ?? "Unknown pipeline",
						stage?.label ?? stageId ?? "Unknown stage",
						value.deals,
						value.amount,
						value.weighted,
					] as Array<string | number>,
				};
			})
			.sort((a, b) => a.order - b.order)
			.map((value) => value.row);
		return {
			columns: [
				column("pipeline", "Pipeline", "type/Text"),
				column("stage", "Stage", "type/Text"),
				column("deals", "Deals", "type/Integer"),
				column("amount", "Amount", "type/Decimal"),
				column("weighted_amount", "Weighted amount", "type/Decimal"),
			],
			rows,
		};
	}
	if (query.report === "pipeline-by-owner") {
		const grouped = new Map<
			string,
			{ deals: number; amount: number; weighted: number }
		>();
		for (const deal of openDeals) {
			const current = grouped.get(deal.ownerId) ?? {
				deals: 0,
				amount: 0,
				weighted: 0,
			};
			current.deals += 1;
			current.amount += deal.amount;
			current.weighted += deal.weightedAmount;
			grouped.set(deal.ownerId, current);
		}
		return {
			columns: [
				column("owner", "Owner", "type/Text"),
				column("open_deals", "Open deals", "type/Integer"),
				column("open_amount", "Open amount", "type/Decimal"),
				column("weighted_amount", "Weighted amount", "type/Decimal"),
			],
			rows: [...grouped.entries()]
				.map(
					([ownerId, value]) =>
						[
							owners.get(ownerId) ?? "Unassigned",
							value.deals,
							value.amount,
							value.weighted,
						] as Array<string | number>,
				)
				.sort((a, b) => Number(b[2]) - Number(a[2])),
		};
	}
	if (query.report === "open-deal-forecast") {
		const periods = futureMonthKeys(query.months);
		return {
			columns: [
				column("month", "Close month", "type/DateTime"),
				column("open_pipeline_amount", "Open pipeline", "type/Decimal"),
				column("weighted_pipeline_amount", "Weighted pipeline", "type/Decimal"),
			],
			rows: periods.map((period) => {
				const matching = openDeals.filter(
					(deal) => deal.closeAt && monthKey(deal.closeAt) === period,
				);
				return [
					monthIso(period),
					matching.reduce((sum, deal) => sum + deal.amount, 0),
					matching.reduce((sum, deal) => sum + deal.weightedAmount, 0),
				];
			}),
		};
	}
	if (query.report === "open-deals") {
		return {
			columns: [
				column("deal", "Deal", "type/Text"),
				column("company", "Company", "type/Text"),
				column("pipeline", "Pipeline", "type/Text"),
				column("stage", "Stage", "type/Text"),
				column("owner", "Owner", "type/Text"),
				column("amount", "Amount", "type/Decimal"),
				column("close_date", "Close date", "type/DateTime"),
			],
			rows: openDeals
				.sort((a, b) => b.amount - a.amount)
				.slice(0, 100)
				.map((deal) => {
					const pipeline = pipelines.get(deal.pipelineId);
					return [
						deal.name,
						companies.get(deal.companyIds[0] ?? "") ?? "Unassociated",
						pipeline?.label ?? deal.pipelineId,
						pipeline?.stages.get(deal.stageId)?.label ?? deal.stageId,
						owners.get(deal.ownerId) ?? "Unassigned",
						deal.amount,
						deal.closeAt?.toISOString() ?? null,
					];
				}),
		};
	}

	const periods = monthKeys(query.months);
	if (query.report === "closed-won-by-company") {
		const grouped = new Map<
			string,
			{ month: string; company: string; amount: number; deals: number }
		>();
		for (const deal of deals) {
			if (!deal.isWon || !deal.closeAt) continue;
			const period = monthKey(deal.closeAt);
			if (!periods.includes(period)) continue;
			const company = companies.get(deal.companyIds[0] ?? "") ?? "Unassociated";
			const key = `${period}:${company}`;
			const current = grouped.get(key) ?? {
				month: period,
				company,
				amount: 0,
				deals: 0,
			};
			current.amount += deal.amount;
			current.deals += 1;
			grouped.set(key, current);
		}
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("partner", "Partner", "type/Text"),
				column("closed_won_amount", "Closed won", "type/Decimal"),
				column("closed_won_deals", "Closed won deals", "type/Integer"),
			],
			rows: [...grouped.values()]
				.sort((a, b) => a.month.localeCompare(b.month) || b.amount - a.amount)
				.map((value) => [
					monthIso(value.month),
					value.company,
					value.amount,
					value.deals,
				]),
		};
	}
	if (query.report === "closed-won") {
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("closed_won_amount", "Closed won", "type/Decimal"),
				column("closed_won_deals", "Closed won deals", "type/Integer"),
			],
			rows: periods.map((period) => {
				const matching = deals.filter(
					(deal) =>
						deal.isWon && deal.closeAt && monthKey(deal.closeAt) === period,
				);
				return [
					monthIso(period),
					matching.reduce((sum, deal) => sum + deal.amount, 0),
					matching.length,
				];
			}),
		};
	}
	if (query.report === "deals-created") {
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("deals_created", "Deals created", "type/Integer"),
				column("created_pipeline_amount", "Created pipeline", "type/Decimal"),
			],
			rows: periods.map((period) => {
				const matching = deals.filter(
					(deal) => deal.createdAt && monthKey(deal.createdAt) === period,
				);
				return [
					monthIso(period),
					matching.length,
					matching.reduce((sum, deal) => sum + deal.amount, 0),
				];
			}),
		};
	}
	if (query.report === "win-rate") {
		return {
			columns: [
				column("month", "Month", "type/DateTime"),
				column("win_rate_pct", "Win rate", "type/Decimal"),
			],
			rows: periods.map((period) => {
				const closed = deals.filter(
					(deal) =>
						deal.isClosed && deal.closeAt && monthKey(deal.closeAt) === period,
				);
				const won = closed.filter((deal) => deal.isWon).length;
				return [
					monthIso(period),
					closed.length ? (won / closed.length) * 100 : 0,
				];
			}),
		};
	}
	return {
		columns: [
			column("month", "Month", "type/DateTime"),
			column("average_days_to_close", "Average days to close", "type/Decimal"),
		],
		rows: periods.map((period) => {
			const values = deals
				.filter(
					(deal) =>
						deal.isWon && deal.closeAt && monthKey(deal.closeAt) === period,
				)
				.flatMap((deal) =>
					deal.daysToClose === null ? [] : [deal.daysToClose],
				);
			return [
				monthIso(period),
				values.length
					? values.reduce((sum, value) => sum + value, 0) / values.length
					: 0,
			];
		}),
	};
}
