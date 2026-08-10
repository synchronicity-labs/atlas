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
import {
	MetabaseClient,
	type MetabaseResult,
} from "../metabase/metabase.client";
import { metabaseConfig } from "../metabase/metabase.config";
import {
	type BillingExperimentQuery,
	billingExperimentQuery,
} from "./billing-experiment.contracts";

const SOURCE_KEY = "atlas:billing-experiment";
const EXPERIMENT_START = "2026-06-22 00:00:00";
const PAGE_SIZE = 2000;
const MAX_ROWS = 100000;
const FRESHNESS_MS = 8 * 60 * 60 * 1000;
const CACHE_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;
const PAID_MONTH_DAYS = 30.4375;

type Arm = "v2_control" | "v3_treatment";

type Assignment = {
	organizationId: string;
	arm: Arm;
	assignmentAt: number;
	firstSubscribedAt: number | null;
	currentPlan: string | null;
};

type Invoice = {
	id: string;
	organizationId: string;
	billingReason: string;
	amountUsd: number;
	createdAt: number;
	plan: string | null;
};

type Payment = {
	id: string;
	organizationId: string;
	amountUsd: number;
	createdAt: number;
	status: string;
};

type Cancellation = {
	id: string;
	organizationId: string;
	canceledAt: number;
};

export type BillingExperimentArmReadout = {
	arm: Arm;
	assignedOrgs: number;
	paidOrgs: number;
	paidConversionPct: number;
	cashEligibleOrgs: number;
	cashUsd: number;
	paidMonths: number;
	cashPerPaidOrgMonthUsd: number | null;
	eligible30d: number;
	churned30d: number;
	churn30dPct: number | null;
	churn30dLowPct: number | null;
	churn30dHighPct: number | null;
	eligible60d: number;
	churned60d: number;
	churn60dPct: number | null;
	impliedLifetimeMonths: number | null;
	impliedCashLtvUsd: number | null;
};

type LiveReadout = {
	asOf: string;
	arms: BillingExperimentArmReadout[];
};

type Result = MetabaseResult;

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function number(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(value: unknown): number | null {
	if (!value) return null;
	const parsed = Date.parse(String(value));
	return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, decimals = 2): number {
	const scale = 10 ** decimals;
	return Math.round(value * scale) / scale;
}

function percent(numerator: number, denominator: number): number | null {
	return denominator > 0 ? round((numerator / denominator) * 100, 2) : null;
}

function wilsonInterval(successes: number, total: number) {
	if (total === 0) return { low: null, high: null };
	const z = 1.959963984540054;
	const rate = successes / total;
	const denominator = 1 + (z * z) / total;
	const center = rate + (z * z) / (2 * total);
	const spread =
		z * Math.sqrt((rate * (1 - rate)) / total + (z * z) / (4 * total * total));
	return {
		low: round(((center - spread) / denominator) * 100, 2),
		high: round(((center + spread) / denominator) * 100, 2),
	};
}

function column(name: string, displayName: string, baseType = "type/Decimal") {
	return { name, displayName, baseType };
}

function armLabel(arm: Arm): string {
	return arm === "v2_control" ? "v2 control" : "v3 treatment";
}

export function buildBillingExperimentReadout(input: {
	asOf: Date;
	assignments: Assignment[];
	invoices: Invoice[];
	payments: Payment[];
	cancellations: Cancellation[];
}): LiveReadout {
	const asOf = input.asOf.getTime();
	const assignmentByOrg = new Map(
		input.assignments.map((assignment) => [
			assignment.organizationId,
			assignment,
		]),
	);
	const invoiceById = new Map(
		input.invoices.map((invoice) => [invoice.id, invoice]),
	);
	const paymentById = new Map(
		input.payments.map((payment) => [payment.id, payment]),
	);
	const firstCancellationByOrg = new Map<string, number>();
	for (const cancellation of input.cancellations) {
		const current = firstCancellationByOrg.get(cancellation.organizationId);
		if (current === undefined || cancellation.canceledAt < current) {
			firstCancellationByOrg.set(
				cancellation.organizationId,
				cancellation.canceledAt,
			);
		}
	}
	const conversionPlanByOrg = new Map<string, string | null>();
	for (const invoice of [...invoiceById.values()].sort(
		(a, b) => a.createdAt - b.createdAt,
	)) {
		const assignment = assignmentByOrg.get(invoice.organizationId);
		if (
			assignment &&
			invoice.billingReason === "subscription_create" &&
			invoice.createdAt >= assignment.assignmentAt &&
			!conversionPlanByOrg.has(invoice.organizationId)
		) {
			conversionPlanByOrg.set(invoice.organizationId, invoice.plan);
		}
	}

	const arms: BillingExperimentArmReadout[] = [];
	for (const arm of ["v2_control", "v3_treatment"] as const) {
		const assignments = input.assignments.filter(
			(assignment) => assignment.arm === arm,
		);
		const converted = assignments.filter(
			(assignment) =>
				assignment.firstSubscribedAt !== null &&
				assignment.firstSubscribedAt >= assignment.assignmentAt &&
				assignment.firstSubscribedAt <= asOf,
		);
		const comparisonEligible = converted.filter((assignment) => {
			if (arm !== "v2_control") return true;
			return (
				conversionPlanByOrg.get(assignment.organizationId) !== "hobbyist" &&
				assignment.currentPlan !== "hobbyist"
			);
		});
		const cashEligible = comparisonEligible.filter(
			(assignment) =>
				asOf - (assignment.firstSubscribedAt ?? asOf) >= 14 * DAY_MS,
		);
		const cashOrgIds = new Set(
			cashEligible.map((assignment) => assignment.organizationId),
		);
		let cashUsd = 0;
		for (const invoice of invoiceById.values()) {
			const assignment = assignmentByOrg.get(invoice.organizationId);
			if (!assignment || !cashOrgIds.has(invoice.organizationId)) continue;
			const conversionAt = assignment.firstSubscribedAt ?? asOf;
			const afterBoundary =
				invoice.billingReason === "subscription_create"
					? invoice.createdAt >= assignment.assignmentAt
					: invoice.createdAt >= conversionAt;
			if (afterBoundary && invoice.createdAt <= asOf) {
				cashUsd += invoice.amountUsd;
			}
		}
		if (arm === "v3_treatment") {
			for (const payment of paymentById.values()) {
				const assignment = assignmentByOrg.get(payment.organizationId);
				if (
					assignment &&
					cashOrgIds.has(payment.organizationId) &&
					payment.status === "succeeded" &&
					payment.createdAt >= (assignment.firstSubscribedAt ?? asOf) &&
					payment.createdAt <= asOf
				) {
					cashUsd += payment.amountUsd;
				}
			}
		}
		const paidMonths = cashEligible.reduce(
			(total, assignment) =>
				total +
				(asOf - (assignment.firstSubscribedAt ?? asOf)) /
					(PAID_MONTH_DAYS * DAY_MS),
			0,
		);
		const eligible30 = comparisonEligible.filter(
			(assignment) =>
				asOf - (assignment.firstSubscribedAt ?? asOf) >= 30 * DAY_MS,
		);
		const eligible60 = comparisonEligible.filter(
			(assignment) =>
				asOf - (assignment.firstSubscribedAt ?? asOf) >= 60 * DAY_MS,
		);
		const churnedWithin = (assignment: Assignment, days: number) => {
			const subscribedAt = assignment.firstSubscribedAt;
			const canceledAt = firstCancellationByOrg.get(assignment.organizationId);
			return (
				subscribedAt !== null &&
				canceledAt !== undefined &&
				canceledAt >= subscribedAt &&
				canceledAt <= subscribedAt + days * DAY_MS
			);
		};
		const churned30 = eligible30.filter((assignment) =>
			churnedWithin(assignment, 30),
		).length;
		const churned60 = eligible60.filter((assignment) =>
			churnedWithin(assignment, 60),
		).length;
		const churn30Pct = percent(churned30, eligible30.length);
		const cashRate = paidMonths > 0 ? round(cashUsd / paidMonths, 2) : null;
		const impliedLifetime =
			churn30Pct !== null && churn30Pct > 0 ? round(100 / churn30Pct, 2) : null;
		const interval = wilsonInterval(churned30, eligible30.length);
		arms.push({
			arm,
			assignedOrgs: assignments.length,
			paidOrgs: converted.length,
			paidConversionPct: percent(converted.length, assignments.length) ?? 0,
			cashEligibleOrgs: cashEligible.length,
			cashUsd: round(cashUsd, 2),
			paidMonths: round(paidMonths, 2),
			cashPerPaidOrgMonthUsd: cashRate,
			eligible30d: eligible30.length,
			churned30d: churned30,
			churn30dPct: churn30Pct,
			churn30dLowPct: interval.low,
			churn30dHighPct: interval.high,
			eligible60d: eligible60.length,
			churned60d: churned60,
			churn60dPct: percent(churned60, eligible60.length),
			impliedLifetimeMonths: impliedLifetime,
			impliedCashLtvUsd:
				cashRate !== null && impliedLifetime !== null
					? round(cashRate * impliedLifetime, 2)
					: null,
		});
	}
	return { asOf: input.asOf.toISOString(), arms };
}

@Injectable()
export class BillingExperimentService {
	private cache:
		| { expiresAt: number; promise: Promise<LiveReadout> }
		| undefined;

	constructor(@InjectDatabase() private readonly db: Db) {}

	async preview(queryText: string): Promise<Result> {
		return this.execute(billingExperimentQuery.parse(JSON.parse(queryText)));
	}

	async syncDashboard(number = 1) {
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
		const source = await this.db.dataSource.findUnique({
			where: { key: SOURCE_KEY },
		});
		const questions = [
			...new Map(
				dashboard.cards.map((card) => [card.question.id, card.question]),
			).values(),
		].filter((question) => {
			const version = question.versions[0];
			if (
				!source ||
				question.sourceId !== source.id ||
				version?.queryLanguage !== "API"
			) {
				return false;
			}
			try {
				billingExperimentQuery.parse(JSON.parse(version.queryText));
				return true;
			} catch {
				return false;
			}
		});
		if (!source || questions.length === 0) {
			throw new Error("The billing experiment source is not configured.");
		}
		const period = new Date().toISOString().slice(0, 7);
		const run = await this.db.syncRun.create({
			data: {
				runKey: `${SOURCE_KEY}:${period}:${randomUUID()}`,
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
		let cardsProcessed = 0;
		let snapshotsCreated = 0;
		const errors: Array<{ number: number; message: string }> = [];
		for (const question of questions) {
			const version = question.versions[0];
			if (!version) continue;
			try {
				const result = await this.execute(
					billingExperimentQuery.parse(JSON.parse(version.queryText)),
				);
				const payload = { columns: result.columns, rows: result.rows };
				const contentHash = hash(payload);
				const externalId =
					question.sourceExternalId ?? `billing-experiment:${question.number}`;
				const created = await this.db.resultSnapshot.createMany({
					data: [
						{
							idempotencyKey: `${SOURCE_KEY}:${externalId}:v${version.version}:${period}:${contentHash}`,
							sourceId: source.id,
							dashboardExternalId: `atlas:${number}`,
							questionExternalId: externalId,
							reportingPeriod: period,
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
			} catch (error) {
				errors.push({
					number: question.number,
					message:
						error instanceof Error ? error.message : "Unknown sync error.",
				});
			}
		}
		const finishedAt = new Date();
		const lastError = errors.length
			? errors.map((error) => `Q${error.number}: ${error.message}`).join(" | ")
			: null;
		await this.db.$transaction([
			this.db.syncRun.update({
				where: { id: run.id },
				data: {
					status: lastError ? SyncRunStatus.FAILED : SyncRunStatus.COMPLETED,
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
					state: lastError ? SourceStatus.ERROR : SourceStatus.HEALTHY,
					lastSyncAt: finishedAt,
					lastError,
					freshnessDeadlineAt: new Date(finishedAt.getTime() + FRESHNESS_MS),
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

	private async execute(query: BillingExperimentQuery): Promise<Result> {
		if (query.report.startsWith("published-")) {
			return this.published(query.report);
		}
		if (query.report === "milestones") return this.milestones();
		const live = await this.live();
		if (query.report === "live-cash") {
			return {
				columns: [
					column("arm", "Experiment arm", "type/Text"),
					column("cash_per_paid_org_month_usd", "Cash / paid-org month"),
				],
				rows: live.arms.map((arm) => [
					armLabel(arm.arm),
					arm.cashPerPaidOrgMonthUsd,
				]),
			};
		}
		if (query.report === "live-churn") {
			return {
				columns: [
					column("arm", "Experiment arm", "type/Text"),
					column("churn_30d_pct", "30-day churn (%)"),
				],
				rows: live.arms.map((arm) => [armLabel(arm.arm), arm.churn30dPct]),
			};
		}
		if (query.report === "live-ltv") {
			return {
				columns: [
					column("arm", "Experiment arm", "type/Text"),
					column("implied_cash_ltv_usd", "Implied cash LTV"),
				],
				rows: live.arms.map((arm) => [
					armLabel(arm.arm),
					arm.impliedCashLtvUsd,
				]),
			};
		}
		if (query.report === "live-summary") {
			return {
				columns: [
					column("arm", "Experiment arm", "type/Text"),
					column("cash_per_paid_org_month_usd", "Cash / paid-org month"),
					column("cash_usd", "Cash collected"),
					column("paid_months", "Paid months"),
					column("cash_sample", "14-day cash sample", "type/Integer"),
					column("churn_30d_pct", "30-day churn (%)"),
					column("churned_30d", "Churned by day 30", "type/Integer"),
					column("churn_30d_n", "30-day sample", "type/Integer"),
					column("churn_30d_low_pct", "Churn 95% low (%)"),
					column("churn_30d_high_pct", "Churn 95% high (%)"),
					column("implied_lifetime_months", "Implied lifetime (months)"),
					column("implied_cash_ltv_usd", "Implied cash LTV"),
					column("as_of", "As of", "type/DateTime"),
				],
				rows: live.arms.map((arm) => [
					armLabel(arm.arm),
					arm.cashPerPaidOrgMonthUsd,
					arm.cashUsd,
					arm.paidMonths,
					arm.cashEligibleOrgs,
					arm.churn30dPct,
					arm.churned30d,
					arm.eligible30d,
					arm.churn30dLowPct,
					arm.churn30dHighPct,
					arm.impliedLifetimeMonths,
					arm.impliedCashLtvUsd,
					live.asOf,
				]),
			};
		}
		if (query.report === "live-funnel") {
			return {
				columns: [
					column("arm", "Experiment arm", "type/Text"),
					column("assigned_orgs", "Assigned orgs", "type/Integer"),
					column("paid_orgs", "Paid orgs", "type/Integer"),
					column("paid_conversion_pct", "Paid conversion (%)"),
					column("cash_eligible_orgs", "14-day cash sample", "type/Integer"),
					column("eligible_30d", "30-day mature", "type/Integer"),
					column("eligible_60d", "60-day mature", "type/Integer"),
				],
				rows: live.arms.map((arm) => [
					armLabel(arm.arm),
					arm.assignedOrgs,
					arm.paidOrgs,
					arm.paidConversionPct,
					arm.cashEligibleOrgs,
					arm.eligible30d,
					arm.eligible60d,
				]),
			};
		}
		return {
			columns: [
				column("arm", "Experiment arm", "type/Text"),
				column("cash_per_paid_org_month_usd", "Cash / paid-org month"),
				column("cash_sample", "Cash sample", "type/Integer"),
				column("churn_30d_pct", "30-day churn (%)"),
				column("churn_30d_n", "30-day sample", "type/Integer"),
				column("churn_60d_pct", "60-day churn (%)"),
				column("churn_60d_n", "60-day sample", "type/Integer"),
				column("implied_cash_ltv_usd", "Implied cash LTV"),
				column("as_of", "As of", "type/DateTime"),
			],
			rows: live.arms.map((arm) => [
				armLabel(arm.arm),
				arm.cashPerPaidOrgMonthUsd,
				arm.cashEligibleOrgs,
				arm.churn30dPct,
				arm.eligible30d,
				arm.churn60dPct,
				arm.eligible60d,
				arm.impliedCashLtvUsd,
				live.asOf,
			]),
		};
	}

	private published(report: BillingExperimentQuery["report"]): Result {
		const asOf = "2026-07-27T13:47:00.000Z";
		const rows = [
			{
				arm: "v2 control",
				cashRate: 116.79,
				cashOrgs: 90,
				cashUsd: 8276,
				paidMonths: 70.87,
				churnPct: 57.14,
				churned: 12,
				churnN: 21,
				lifetime: 1.75,
				ltv: 204.38,
			},
			{
				arm: "v3 treatment",
				cashRate: 69.43,
				cashOrgs: 108,
				cashUsd: 5832,
				paidMonths: 84,
				churnPct: 29.41,
				churned: 5,
				churnN: 17,
				lifetime: 3.4,
				ltv: 236.06,
			},
		];
		if (report === "published-cash") {
			return {
				columns: [
					column("arm", "Experiment arm", "type/Text"),
					column("cash_per_paid_org_month_usd", "Cash / paid-org month"),
				],
				rows: rows.map((row) => [row.arm, row.cashRate]),
			};
		}
		if (report === "published-churn") {
			return {
				columns: [
					column("arm", "Experiment arm", "type/Text"),
					column("month_one_churn_pct", "Month-one churn (%)"),
				],
				rows: rows.map((row) => [row.arm, row.churnPct]),
			};
		}
		if (report === "published-ltv") {
			return {
				columns: [
					column("arm", "Experiment arm", "type/Text"),
					column("implied_cash_ltv_usd", "Implied cash LTV"),
				],
				rows: rows.map((row) => [row.arm, row.ltv]),
			};
		}
		return {
			columns: [
				column("arm", "Experiment arm", "type/Text"),
				column("cash_per_paid_org_month_usd", "Cash / paid-org month"),
				column("cash_sample", "14-day cash sample", "type/Integer"),
				column("month_one_churn_pct", "Month-one churn (%)"),
				column("churn_sample", "30-day churn sample", "type/Integer"),
				column("implied_lifetime_months", "Implied lifetime (months)"),
				column("implied_cash_ltv_usd", "Implied cash LTV"),
				column("as_of", "Published as of", "type/DateTime"),
			],
			rows: rows.map((row) => [
				row.arm,
				row.cashRate,
				row.cashOrgs,
				row.churnPct,
				row.churnN,
				row.lifetime,
				row.ltv,
				asOf,
			]),
		};
	}

	private milestones(): Result {
		const now = Date.now();
		const rows: Array<[string, string]> = [
			["v3 30-day sample reaches 100", "2026-08-11T00:00:00.000Z"],
			["v2 30-day sample reaches 100", "2026-08-14T00:00:00.000Z"],
			["First remaining-credit expiry wave", "2026-08-26T00:00:00.000Z"],
			["v3 60-day sample reaches 100", "2026-09-10T00:00:00.000Z"],
			["v2 60-day sample reaches 100", "2026-09-13T00:00:00.000Z"],
			["Decision checkpoint", "2026-09-30T00:00:00.000Z"],
		];
		return {
			columns: [
				column("milestone", "Milestone", "type/Text"),
				column("date", "Date", "type/DateTime"),
				column("status", "Status", "type/Text"),
			],
			rows: rows.map(([label, date]) => [
				label,
				date,
				Date.parse(date) <= now ? "reached" : "upcoming",
			]),
		};
	}

	private live(): Promise<LiveReadout> {
		if (this.cache && this.cache.expiresAt > Date.now()) {
			return this.cache.promise;
		}
		const promise = this.loadLive().catch((error) => {
			this.cache = undefined;
			throw error;
		});
		this.cache = { expiresAt: Date.now() + CACHE_MS, promise };
		return promise;
	}

	private async loadLive(): Promise<LiveReadout> {
		const config = metabaseConfig();
		if (!config) throw new Error("Metabase is not configured.");
		const client = new MetabaseClient(config);
		const [assignmentRows, invoiceRows, paymentRows, cancellationRows] =
			await Promise.all([
				this.queryAll(
					client,
					"34",
					`select distinct on (a.organization_id)
  a.organization_id::text as organization_id,
  case
    when a.cohort = 'control' and a.variant = 'control' and a.billing_version = 'v2' then 'v2_control'
    when a.cohort = 'treatment' and a.variant = 'treatment' and a.billing_version = 'v3' then 'v3_treatment'
  end as arm,
  a.created_at as assignment_at,
  o.first_subscribed_at,
  o.plan as current_plan
from public.billing_version_assignments a
join public.organizations o on o.id = a.organization_id
join public.user_organizations uo on uo.organization_id = a.organization_id and uo.role = 'owner'
join auth.users u on u.id = uo.user_id
where a.flag = 'billing_v3_experiment'
  and a.source = 'signup_flag'
  and (
    (a.cohort = 'control' and a.variant = 'control' and a.billing_version = 'v2')
    or (a.cohort = 'treatment' and a.variant = 'treatment' and a.billing_version = 'v3')
  )
  and coalesce(u.banned, false) = false
  and coalesce(u.disabled, false) = false
  and lower(u.email) not like '%@sync.so'
order by a.organization_id, a.created_at`,
				),
				this.queryAll(
					client,
					"166",
					`select
  id,
  "organizationId" as organization_id,
  "billingReason" as billing_reason,
  "amountPaid" / 100.0 as amount_usd,
  "createdAt" as created_at,
  plan
from sync_prod.sync_stripe_invoices_paid
where "createdAt" >= toDateTime('${EXPERIMENT_START}')
  and "amountPaid" > 0
order by "createdAt", id`,
				),
				this.queryAll(
					client,
					"166",
					`select
  id,
  "organizationId" as organization_id,
  amount / 100.0 as amount_usd,
  status,
  "createdAt" as created_at
from sync_prod.sync_stripe_payments
where "createdAt" >= toDateTime('${EXPERIMENT_START}')
order by "createdAt", id`,
				),
				this.queryAll(
					client,
					"166",
					`select
  id,
  "organizationId" as organization_id,
  "canceledAt" as canceled_at
from sync_prod.sync_stripe_subscription_cancellations
where "createdAt" >= toDateTime('${EXPERIMENT_START}')
  and "canceledAt" is not null
order by "canceledAt", id`,
				),
			]);
		const assignments = assignmentRows.flatMap((row): Assignment[] => {
			const assignmentAt = timestamp(row.assignment_at);
			const arm = row.arm;
			if (!assignmentAt || (arm !== "v2_control" && arm !== "v3_treatment")) {
				return [];
			}
			return [
				{
					organizationId: String(row.organization_id),
					arm,
					assignmentAt,
					firstSubscribedAt: timestamp(row.first_subscribed_at),
					currentPlan: row.current_plan ? String(row.current_plan) : null,
				},
			];
		});
		const invoices = invoiceRows.flatMap((row): Invoice[] => {
			const createdAt = timestamp(row.created_at);
			if (!createdAt) return [];
			return [
				{
					id: String(row.id),
					organizationId: String(row.organization_id),
					billingReason: String(row.billing_reason ?? ""),
					amountUsd: number(row.amount_usd),
					createdAt,
					plan: row.plan ? String(row.plan) : null,
				},
			];
		});
		const payments = paymentRows.flatMap((row): Payment[] => {
			const createdAt = timestamp(row.created_at);
			if (!createdAt) return [];
			return [
				{
					id: String(row.id),
					organizationId: String(row.organization_id),
					amountUsd: number(row.amount_usd),
					createdAt,
					status: String(row.status ?? ""),
				},
			];
		});
		const cancellations = cancellationRows.flatMap((row): Cancellation[] => {
			const canceledAt = timestamp(row.canceled_at);
			if (!canceledAt) return [];
			return [
				{
					id: String(row.id),
					organizationId: String(row.organization_id),
					canceledAt,
				},
			];
		});
		return buildBillingExperimentReadout({
			asOf: new Date(),
			assignments,
			invoices,
			payments,
			cancellations,
		});
	}

	private async queryAll(
		client: MetabaseClient,
		databaseExternalId: string,
		query: string,
	): Promise<Array<Record<string, unknown>>> {
		const rows: Array<Record<string, unknown>> = [];
		for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
			const result = await client.preview({
				language: "SQL",
				queryText: `${query}\nlimit ${PAGE_SIZE} offset ${offset}`,
				databaseExternalId,
			});
			rows.push(
				...result.rows.map((row) =>
					Object.fromEntries(
						result.columns.map((column, index) => [
							column.name,
							row[index] ?? null,
						]),
					),
				),
			);
			if (result.rows.length < PAGE_SIZE) return rows;
		}
		throw new Error(`Billing experiment query exceeded ${MAX_ROWS} rows.`);
	}
}
