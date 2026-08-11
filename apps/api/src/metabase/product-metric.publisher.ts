import { createHash } from "node:crypto";
import {
	DataSourceKind,
	type Db,
	FactGrain,
	MetricLifecycleStatus,
	MetricRunStatus,
	MetricTrustStatus,
	type Prisma,
	QueryLanguage,
	QuestionPurpose,
	SourceStatus,
	VerificationStatus,
} from "@crm/db";
import { type MetricContract, stableMetricContractHash } from "@crm/metrics";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type { MetabaseResult } from "./metabase.client";

const FRESHNESS_SLA_MINUTES = 10 * 60;
const MAX_LAG_SECONDS = FRESHNESS_SLA_MINUTES * 60;

type ProductMetricSpec = {
	questionNumber: number;
	sourceExternalId: string;
	key: string;
	name: string;
	description: string;
	grain: FactGrain;
	source: {
		key: string;
		kind: DataSourceKind;
		label: string;
	};
	eventTimeField: string;
	businessDefinition: Record<string, unknown>;
	computation: Record<string, unknown>;
	requiresCrossSourceEligibility: boolean;
	ownerTeam?: string;
	createdBy?: string;
	cadenceMinutes?: number;
};

type PublishInput = {
	question: {
		id: string;
		number: number;
		name: string;
		description: string | null;
		sourceExternalId: string | null;
		databaseExternalId: string | null;
	};
	version: {
		id: string;
		version: number;
		queryLanguage: QueryLanguage;
		queryText: string;
	};
	result: MetabaseResult;
	syncRunId: string;
	capturedAt: Date;
};

const sharedNormalizationPolicy = {
	timeZone: "UTC",
	periodBoundaries: "half_open",
	internalDomains: ["sync.so", "sync.labs"],
	excludedUserStates: ["banned", "disabled", "anonymous"],
	retroactiveEligibility: "current_known_state",
};

export const PRODUCT_METRIC_SPECS: ProductMetricSpec[] = [
	{
		questionNumber: 15,
		sourceExternalId: "8164",
		key: "product.monthly_professional_organizations",
		name: "Monthly professional organizations",
		description:
			"Self-serve organizations that meet the professional usage and accrued-value definition.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "generationCreatedAt",
		businessDefinition: {
			entity: "organization_month",
			population: "v2_self_serve",
			professional: {
				minimumAccruedValueUsd: 100,
				minimumCompletedBillableGenerations: 3,
				minimumActiveDays: 2,
			},
		},
		computation: { aggregate: "count_organizations", output: "value" },
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 16,
		sourceExternalId: "8165",
		key: "product.monthly_activated_organizations",
		name: "Monthly activated organizations",
		description:
			"Self-serve organizations with three completed generations across at least two distinct days.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "generationCreatedAt",
		businessDefinition: {
			entity: "organization_month",
			population: "v2_self_serve",
			minimumCompletedGenerations: 3,
			minimumActiveDays: 2,
		},
		computation: { aggregate: "count_organizations", output: "value" },
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 21,
		sourceExternalId: "8170",
		key: "product.first_generation_14d_activation",
		name: "First-generation 14-day return and activation",
		description:
			"Matured first-generation organization cohorts measured for second-day return and activation within 14 days.",
		grain: FactGrain.WEEK,
		source: {
			key: "postgres:product",
			kind: DataSourceKind.POSTGRES,
			label: "Product Postgres",
		},
		eventTimeField: "created_at",
		businessDefinition: {
			entity: "first_generation_organization",
			maturityDays: 14,
			secondDayReturn:
				"another completed generation on a distinct day within 14 days",
			activation:
				"three completed generations across two distinct days within 14 days",
		},
		computation: {
			aggregate: "cohort_share",
			outputs: ["second_day_return_rate_pct", "activation_14d_rate_pct"],
		},
		requiresCrossSourceEligibility: false,
	},
	{
		questionNumber: 22,
		sourceExternalId: "8172",
		key: "product.activated_to_professional_rate",
		name: "Activated-to-professional rate",
		description:
			"Professional organization-months divided by activated organization-months.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "generationCreatedAt",
		businessDefinition: {
			numerator: "professional_organization_months",
			denominator: "activated_organization_months",
			professionalAccruedValueUsd: 100,
		},
		computation: {
			aggregate: "percentage",
			output: "activated_to_professional_rate_pct",
		},
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 23,
		sourceExternalId: "8173",
		key: "product.product_led_subscription_conversion_30d",
		name: "30-day product-led subscription conversion",
		description:
			"Organizations that completed a first generation before subscribing and started a subscription within 30 days.",
		grain: FactGrain.WEEK,
		source: {
			key: "postgres:product",
			kind: DataSourceKind.POSTGRES,
			label: "Product Postgres",
		},
		eventTimeField: "created_at",
		businessDefinition: {
			entity: "first_generation_organization",
			maturityDays: 30,
			conversion:
				"subscription starts within 30 days after the first completed generation",
		},
		computation: { aggregate: "cohort_share", output: "conversion_30d_pct" },
		requiresCrossSourceEligibility: false,
	},
	{
		questionNumber: 17,
		sourceExternalId: "8166",
		key: "product.m3_professional_requalification",
		name: "M3 professional-organization requalification",
		description:
			"Starting professional organization cohorts that pass the complete professional definition two calendar months later.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "generationCreatedAt",
		businessDefinition: {
			entity: "starting_professional_organization_cohort",
			requalificationMonthOffset: 2,
			professionalDefinition:
				"100 USD accrued value, three completed billable generations, two active days",
		},
		computation: { aggregate: "cohort_share", output: "value" },
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 24,
		sourceExternalId: "8175",
		key: "product.professional_organization_accrued_value",
		name: "Accrued value from professional organizations",
		description:
			"Allocated subscription value plus consumed usage for active professional organizations.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "generationCreatedAt",
		businessDefinition: {
			entity: "professional_organization_month",
			valueBasis: "accrued_operating_value",
			cashBasis: false,
		},
		computation: { aggregate: "sum", output: "accrued_value_usd" },
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 18,
		sourceExternalId: "8167",
		key: "product.m3_accrued_ndr",
		name: "M3 accrued NDR",
		description:
			"Month-three accrued value from the fixed starting professional cohort divided by starting-month accrued value.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "generationCreatedAt",
		businessDefinition: {
			entity: "starting_professional_organization_cohort",
			currentMonthOffset: 2,
			numerator: "same_cohort_month_three_accrued_value",
			denominator: "starting_month_accrued_value",
		},
		computation: { aggregate: "ratio_percentage", output: "value" },
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 8,
		sourceExternalId: "8177",
		key: "product.generation_completion_rate",
		name: "Generation completion rate",
		description:
			"Completed generation records divided by all non-deleted generation records.",
		grain: FactGrain.WEEK,
		source: {
			key: "postgres:product",
			kind: DataSourceKind.POSTGRES,
			label: "Product Postgres",
		},
		eventTimeField: "created_at",
		businessDefinition: {
			numerator: "completed_non_deleted_generations",
			denominator: "all_non_deleted_generations",
			statusBasis: "final_database_status",
		},
		computation: {
			aggregate: "ratio_percentage",
			output: "completion_rate_pct",
		},
		requiresCrossSourceEligibility: false,
	},
	{
		questionNumber: 9,
		sourceExternalId: "8178",
		key: "product.accrued_professional_paid_qualified",
		name: "Accrued professional organization-months paid-qualified",
		description:
			"Accrued professional organization-months with at least 100 USD in paid subscription and usage invoices in the same month.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage-billing",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage and Stripe mirror",
		},
		eventTimeField: "generationCreatedAt",
		businessDefinition: {
			numerator: "accrued_professional_org_months_with_100_usd_paid",
			denominator: "accrued_professional_org_months",
			paidValueIncludes: ["subscription_invoices", "usage_invoices"],
		},
		computation: {
			aggregate: "ratio_percentage",
			output: "paid_qualified_pct",
		},
		requiresCrossSourceEligibility: true,
	},
];

export const REVENUE_METRIC_SPECS: ProductMetricSpec[] = [
	{
		questionNumber: 1101,
		sourceExternalId: "weekly-revenue:overview",
		key: "company.weekly_revenue_lite_overview",
		name: "Weekly Revenue Lite overview",
		description:
			"Current self-serve licensed base, accrued usage pace, run-rate, annualized run-rate, and Stripe cash reconciliation at one UTC cutoff.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			licensedBase:
				"latest active or past-due self-serve subscriptions at the current v2 or v3 plan price",
			usageActual: "paid-plan generation value grouped by generationEndedAt",
			usagePace:
				"month-to-date accrued usage divided by exact elapsed UTC seconds and multiplied by seconds in the calendar month",
			productRunRate: "licensed base plus projected accrued usage",
			annualizedRunRate: "product run-rate multiplied by 12",
			excluded: ["enterprise commitments", "Studio commitments"],
		},
		computation: {
			aggregate: "run_rate_reconstruction",
			outputs: [
				"licensed_subscription_base",
				"usage_accrual_mtd",
				"projected_usage_accrual",
				"product_run_rate",
				"annualized_product_run_rate",
			],
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1102,
		sourceExternalId: "weekly-revenue:product-run-rate",
		key: "company.product_run_rate",
		name: "Current product run-rate",
		description:
			"Self-serve licensed subscription base plus current-month accrued usage pace at a shared UTC cutoff.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			formula: "licensed_subscription_base + projected_usage_accrual",
			enterpriseCommitmentsIncluded: false,
			studioCommitmentsIncluded: false,
		},
		computation: { aggregate: "sum", output: "product_run_rate" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1103,
		sourceExternalId: "weekly-revenue:usage-history-pace",
		key: "company.paid_plan_usage_accrual",
		name: "Paid-plan usage accrual history and MTD pace",
		description:
			"Completed-month accrued usage plus current-month actual and projected pace, using generationEndedAt in UTC.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			valueBasis: "generationCostMillicents divided by 100000",
			timeField: "generationEndedAt",
			population: "non-empty organizationPlanType",
		},
		computation: {
			aggregate: "monthly_sum_and_current_month_pace",
			outputs: ["usage_accrual", "projected_usage_accrual"],
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1104,
		sourceExternalId: "weekly-revenue:licensed-base-by-plan",
		key: "company.active_licensed_subscription_base",
		name: "Active licensed subscription base by plan",
		description:
			"Latest active or past-due self-serve Stripe subscription state multiplied by the current licensed monthly price for each v2 and v3 plan.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "createdAt",
		businessDefinition: {
			entity: "latest_subscription",
			includedStatuses: ["active", "past_due"],
			includedPlans: [
				"hobbyist",
				"creator",
				"growth",
				"scale",
				"starter",
				"pro",
				"team",
			],
			excludedPlans: ["enterprise", "program", "partner"],
		},
		computation: {
			aggregate: "subscription_count_times_current_plan_price",
			output: "licensed_subscription_base",
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1105,
		sourceExternalId: "weekly-revenue:complete-month-ndr",
		key: "company.complete_month_usage_ndr",
		name: "Latest complete-month usage NDR",
		description:
			"Current-period accrued usage from the fixed prior-month organization cohort divided by that cohort's starting accrued usage.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			cohort:
				"organizations with paid-plan accrued usage in the starting month",
			numerator: "next-month usage from the same starting organizations",
			denominator: "starting-month usage",
			missingCurrentUsage: 0,
		},
		computation: { aggregate: "cohort_ratio", output: "usage_ndr_pct" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1106,
		sourceExternalId: "weekly-revenue:complete-month-ndr-tiers",
		key: "company.complete_month_usage_ndr_by_starting_tier",
		name: "Complete-month usage NDR by starting tier",
		description:
			"Latest complete-month usage NDR grouped by each organization's paid plan at the end of the starting month.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			cohort: "fixed starting-month organizations",
			tierAssignment: "latest organizationPlanType in the starting month",
		},
		computation: {
			aggregate: "cohort_ratio_by_dimension",
			dimension: "starting_tier",
			output: "usage_ndr_pct",
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1107,
		sourceExternalId: "weekly-revenue:weekly-ndr-proxy",
		key: "company.weekly_usage_ndr_proxy",
		name: "Weekly usage NDR proxy",
		description:
			"Directional Monday-Sunday UTC usage retention from the fixed prior-week organization cohort; not finance-grade NDR.",
		grain: FactGrain.WEEK,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			cohort: "organizations with paid-plan accrued usage in the starting week",
			window: "complete Monday-Sunday UTC weeks",
			classification: "directional_proxy",
		},
		computation: {
			aggregate: "weekly_cohort_ratio",
			output: "usage_ndr_proxy_pct",
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1108,
		sourceExternalId: "weekly-revenue:weekly-retention-bridge",
		key: "company.weekly_usage_retention_bridge",
		name: "Weekly usage retention bridge",
		description:
			"Starting cohort spend, retained spend, total current-week spend, and spend from organizations outside the starting cohort.",
		grain: FactGrain.WEEK,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			retained: "report-week usage from starting-week organizations",
			outsideStartingCohort:
				"total report-week usage minus retained starting-cohort usage",
		},
		computation: {
			aggregate: "weekly_retention_bridge",
			outputs: [
				"starting_usage_accrual",
				"retained_usage_accrual",
				"report_total_usage",
				"usage_outside_starting_cohort",
			],
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1109,
		sourceExternalId: "weekly-revenue:weekly-ndr-tiers",
		key: "company.weekly_usage_ndr_proxy_by_starting_tier",
		name: "Weekly usage NDR proxy by starting tier",
		description:
			"Directional complete-week usage retention grouped by the paid plan at the end of the starting week.",
		grain: FactGrain.WEEK,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			cohort: "fixed starting-week organizations",
			tierAssignment: "latest organizationPlanType in the starting week",
			classification: "directional_proxy",
		},
		computation: {
			aggregate: "weekly_cohort_ratio_by_dimension",
			dimension: "starting_tier",
			output: "usage_ndr_proxy_pct",
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
];

const ALL_METRIC_SPECS = [...PRODUCT_METRIC_SPECS, ...REVENUE_METRIC_SPECS];
const specsByQuestion = new Map(
	ALL_METRIC_SPECS.map((spec) => [spec.questionNumber, spec]),
);
const specsBySourceExternalId = new Map(
	ALL_METRIC_SPECS.map((spec) => [spec.sourceExternalId, spec]),
);

export function preferredAtlasQuestionNumber(
	sourceExternalId: string,
): number | null {
	return specsBySourceExternalId.get(sourceExternalId)?.questionNumber ?? null;
}

@Injectable()
export class ProductMetricPublisher {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async publish(input: PublishInput) {
		const spec =
			(input.question.sourceExternalId
				? specsBySourceExternalId.get(input.question.sourceExternalId)
				: undefined) ?? specsByQuestion.get(input.question.number);
		if (!spec) return null;
		const ownerTeam = spec.ownerTeam ?? "Product";
		const createdBy = spec.createdBy ?? "atlas-product-registry";
		const cadenceMinutes = spec.cadenceMinutes ?? 8 * 60;

		const eligibilityVerified =
			!spec.requiresCrossSourceEligibility &&
			hasRequiredEligibilityPredicates(input.version.queryText);
		const lifecycleStatus = eligibilityVerified
			? MetricLifecycleStatus.CERTIFIED
			: MetricLifecycleStatus.DRAFT;
		const source = await this.db.dataSource.upsert({
			where: { key: spec.source.key },
			create: {
				...spec.source,
				state: SourceStatus.HEALTHY,
				lastSyncAt: input.capturedAt,
				freshnessDeadlineAt: new Date(
					input.capturedAt.getTime() + FRESHNESS_SLA_MINUTES * 60_000,
				),
			},
			update: {
				kind: spec.source.kind,
				label: spec.source.label,
				state: SourceStatus.HEALTHY,
				lastSyncAt: input.capturedAt,
				lastError: null,
				freshnessDeadlineAt: new Date(
					input.capturedAt.getTime() + FRESHNESS_SLA_MINUTES * 60_000,
				),
			},
		});
		const datasetKey = `${spec.key}.source_rows`;
		const dataset = await this.db.ingestionDataset.upsert({
			where: {
				sourceId_key: { sourceId: source.id, key: datasetKey },
			},
			create: {
				sourceId: source.id,
				key: datasetKey,
				label: `${spec.name} source rows`,
				description: spec.description,
				adapter: "metabase_read_transport",
				eventTimeField: spec.eventTimeField,
				watermarkField: spec.eventTimeField,
				cadenceMinutes,
				freshnessSlaMinutes: FRESHNESS_SLA_MINUTES,
				backfillWindowDays: 366,
				config: json({
					databaseExternalId: input.question.databaseExternalId,
					transport: "metabase",
				}),
			},
			update: {
				label: `${spec.name} source rows`,
				description: spec.description,
				eventTimeField: spec.eventTimeField,
				watermarkField: spec.eventTimeField,
				freshnessSlaMinutes: FRESHNESS_SLA_MINUTES,
				config: json({
					databaseExternalId: input.question.databaseExternalId,
					transport: "metabase",
				}),
			},
		});

		const contract: MetricContract = {
			key: spec.key,
			name: spec.name,
			ownerTeam,
			businessDefinition: spec.businessDefinition,
			normalizationPolicy: {
				...sharedNormalizationPolicy,
				state: eligibilityVerified ? "enforced" : "pending_cross_source_join",
			},
			computation: spec.computation,
			verificationPolicy: {
				tolerance: 0,
				requiredChecks: [
					"read_only_query",
					"source_snapshot",
					"result_non_empty",
					"exclude_banned_disabled_anonymous_internal",
				],
			},
			cadence: { everyMinutes: cadenceMinutes, timeZone: "UTC" },
			inputs: [
				{
					alias: "source_rows",
					datasetKey,
					queryLanguage: input.version.queryLanguage,
					queryText: input.version.queryText,
					expectedGrain: spec.grain,
					maxLagSeconds: MAX_LAG_SECONDS,
					required: true,
				},
			],
		};
		const contractHash = stableMetricContractHash(contract);
		const metric = await this.db.metricDefinition.upsert({
			where: { key: spec.key },
			create: {
				key: spec.key,
				name: spec.name,
				description: spec.description,
				ownerTeam,
				status: lifecycleStatus,
			},
			update: {
				name: spec.name,
				description: spec.description,
				ownerTeam,
				status: lifecycleStatus,
			},
		});
		let metricVersion = await this.db.metricVersion.findFirst({
			where: { metricId: metric.id, contentHash: contractHash },
			orderBy: { version: "desc" },
		});
		if (!metricVersion) {
			const latest = await this.db.metricVersion.aggregate({
				where: { metricId: metric.id },
				_max: { version: true },
			});
			metricVersion = await this.db.metricVersion.create({
				data: {
					metricId: metric.id,
					version: (latest._max.version ?? 0) + 1,
					businessDefinition: json(contract.businessDefinition),
					normalizationPolicy: json(contract.normalizationPolicy),
					computation: json(contract.computation),
					verificationPolicy: json(contract.verificationPolicy),
					cadence: json(contract.cadence),
					contentHash: contractHash,
					createdBy,
					approvedBy: eligibilityVerified ? "atlas-policy" : null,
					approvedAt: eligibilityVerified ? input.capturedAt : null,
					inputs: {
						create: {
							datasetId: dataset.id,
							alias: "source_rows",
							required: true,
							queryLanguage: input.version.queryLanguage,
							queryText: input.version.queryText,
							queryHash: hash(input.version.queryText),
							expectedGrain: spec.grain,
							maxLagSeconds: MAX_LAG_SECONDS,
						},
					},
				},
			});
		} else if (eligibilityVerified && !metricVersion.approvedAt) {
			metricVersion = await this.db.metricVersion.update({
				where: { id: metricVersion.id },
				data: { approvedBy: "atlas-policy", approvedAt: input.capturedAt },
			});
		}

		await this.db.question.update({
			where: { id: input.question.id },
			data: {
				metricVersionId: metricVersion.id,
				purpose: eligibilityVerified
					? QuestionPurpose.CERTIFIED
					: QuestionPurpose.RECONCILIATION,
			},
		});

		const window = inferMetricWindow(
			input.result,
			spec.grain,
			input.capturedAt,
		);
		const payload = {
			columns: input.result.columns,
			rows: input.result.rows,
		};
		const outputHash = hash(payload);
		const watermarkKey = `${dataset.id}:${window.dataThrough.toISOString()}:${outputHash}`;
		await this.db.sourceWatermark.createMany({
			data: [
				{
					idempotencyKey: watermarkKey,
					datasetId: dataset.id,
					sourceId: source.id,
					syncRunId: input.syncRunId,
					dataThrough: window.dataThrough,
					complete: true,
					rowCount: input.result.rows.length,
					contentHash: outputHash,
					checkpoint: json({ reportingPeriod: window.reportingPeriod }),
					observedAt: input.capturedAt,
				},
			],
			skipDuplicates: true,
		});
		await this.persistFacts({
			datasetId: dataset.id,
			sourceId: source.id,
			syncRunId: input.syncRunId,
			spec,
			result: input.result,
			window,
			eligibilityVerified,
		});

		const snapshotKey = `${metricVersion.id}:${window.reportingPeriod}:${outputHash}`;
		const existing = await this.db.metricSnapshot.findUnique({
			where: { idempotencyKey: snapshotKey },
			select: { id: true },
		});
		if (existing) return existing;

		const resultPresent = input.result.rows.length > 0;
		const trustStatus = !resultPresent
			? MetricTrustStatus.FAILED
			: eligibilityVerified
				? MetricTrustStatus.VERIFIED
				: MetricTrustStatus.PENDING;
		const metricRun = await this.db.metricRun.create({
			data: {
				runKey: `${metricVersion.id}:${input.capturedAt.toISOString()}:${outputHash}`,
				metricVersionId: metricVersion.id,
				status: MetricRunStatus.PUBLISHED,
				periodStart: window.periodStart,
				periodEnd: window.periodEnd,
				dataThrough: window.dataThrough,
				sourceWatermarks: json([
					{
						datasetKey,
						dataThrough: window.dataThrough.toISOString(),
						contentHash: outputHash,
					},
				]),
				inputHash: hash(input.version.queryText),
				outputHash,
				rowCount: input.result.rows.length,
				validation: json({ eligibilityVerified, resultPresent }),
				startedAt: input.capturedAt,
				finishedAt: input.capturedAt,
				verifications: {
					create: verificationRows({
						eligibilityVerified,
						resultPresent,
						questionVersion: input.version.version,
						capturedAt: input.capturedAt,
					}),
				},
			},
		});
		return this.db.metricSnapshot.create({
			data: {
				idempotencyKey: snapshotKey,
				metricVersionId: metricVersion.id,
				metricRunId: metricRun.id,
				reportingPeriod: window.reportingPeriod,
				periodStart: window.periodStart,
				periodEnd: window.periodEnd,
				dataThrough: window.dataThrough,
				computedAt: input.capturedAt,
				trustStatus,
				contentHash: outputHash,
				columns: json(input.result.columns),
				rows: json(input.result.rows),
				rowCount: input.result.rows.length,
			},
		});
	}

	private async persistFacts(input: {
		datasetId: string;
		sourceId: string;
		syncRunId: string;
		spec: ProductMetricSpec;
		result: MetabaseResult;
		window: MetricWindow;
		eligibilityVerified: boolean;
	}) {
		const facts = input.result.rows.map((row, index) => {
			const record = Object.fromEntries(
				input.result.columns.map((column, columnIndex) => [
					column.name,
					row[columnIndex] ?? null,
				]),
			);
			const rowStart = firstDateValue(record) ?? input.window.periodStart;
			const rowEnd = incrementPeriod(rowStart, input.spec.grain);
			const dimensions: Record<string, unknown> = { metricKey: input.spec.key };
			const measures: Record<string, unknown> = {};
			for (const [column, value] of Object.entries(record)) {
				if (typeof value === "number") measures[column] = value;
				else dimensions[column] = value;
			}
			const contentHash = hash(record);
			return {
				idempotencyKey: `${input.datasetId}:${input.spec.key}:${index}:${contentHash}`,
				datasetId: input.datasetId,
				sourceId: input.sourceId,
				syncRunId: input.syncRunId,
				entityType: "metric_source_row",
				entityId: `${input.spec.key}:${rowStart.toISOString()}:${index}`,
				grain: input.spec.grain,
				periodStart: rowStart,
				periodEnd: rowEnd,
				eventTime: rowStart,
				dataThrough: input.window.dataThrough,
				dimensions: json(dimensions),
				measures: json(measures),
				eligibility: json({
					policy: sharedNormalizationPolicy,
					state: input.eligibilityVerified
						? "enforced"
						: "pending_cross_source_join",
				}),
				contentHash,
			};
		});
		if (facts.length > 0) {
			await this.db.normalizedFact.createMany({
				data: facts,
				skipDuplicates: true,
			});
		}
	}
}

type MetricWindow = {
	periodStart: Date;
	periodEnd: Date;
	dataThrough: Date;
	reportingPeriod: string;
};

export function hasRequiredEligibilityPredicates(queryText: string): boolean {
	const normalized = queryText.toLowerCase();
	return ["banned", "disabled", "is_anonymous", "@sync.so"].every((term) =>
		normalized.includes(term),
	);
}

export function inferMetricWindow(
	result: MetabaseResult,
	grain: FactGrain,
	capturedAt: Date,
): MetricWindow {
	const records = result.rows.map((row) =>
		Object.fromEntries(
			result.columns.map((column, index) => [column.name, row[index] ?? null]),
		),
	);
	const dates = records.flatMap((record) => {
		const date = firstDateValue(record);
		return date ? [date] : [];
	});
	const explicitStarts = namedDateValues(records, [
		"period_start",
		"window_start",
	]);
	const explicitEnds = namedDateValues(records, ["period_end", "window_end"]);
	const explicitDataThrough = namedDateValues(records, ["data_through"]);
	const fallbackStart = new Date(
		Date.UTC(capturedAt.getUTCFullYear(), capturedAt.getUTCMonth(), 1),
	);
	const periodStart = explicitStarts.length
		? new Date(Math.min(...explicitStarts.map((date) => date.getTime())))
		: dates.length
			? new Date(Math.min(...dates.map((date) => date.getTime())))
			: fallbackStart;
	const latest = dates.length
		? new Date(Math.max(...dates.map((date) => date.getTime())))
		: capturedAt;
	const periodEnd = explicitEnds.length
		? new Date(Math.max(...explicitEnds.map((date) => date.getTime())))
		: dates.length
			? incrementPeriod(latest, grain)
			: capturedAt;
	const dataThrough = explicitDataThrough.length
		? new Date(Math.min(...explicitDataThrough.map((date) => date.getTime())))
		: new Date(Math.min(capturedAt.getTime(), periodEnd.getTime()));
	const labelInstant = new Date(
		Math.max(
			periodStart.getTime(),
			Math.min(capturedAt.getTime(), periodEnd.getTime() - 1),
		),
	);
	return {
		periodStart,
		periodEnd,
		dataThrough,
		reportingPeriod: labelInstant.toISOString().slice(0, 7),
	};
}

function namedDateValues(
	records: Record<string, unknown>[],
	names: string[],
): Date[] {
	const allowed = new Set(names);
	return records.flatMap((record) => {
		for (const [key, value] of Object.entries(record)) {
			if (!allowed.has(key.toLowerCase())) continue;
			const date = parseDate(value);
			if (date) return [date];
		}
		return [];
	});
}

function firstDateValue(record: Record<string, unknown>): Date | null {
	for (const [key, value] of Object.entries(record)) {
		if (!/(month|week|date|period|day|cohort)/i.test(key)) continue;
		const date = parseDate(value);
		if (date) return date;
	}
	return null;
}

function parseDate(value: unknown): Date | null {
	if (value instanceof Date && Number.isFinite(value.getTime())) return value;
	if (typeof value !== "string") return null;
	if (!/^\d{4}-\d{2}(?:-\d{2})?(?:[T ]|$)/.test(value)) return null;
	const normalized = /^\d{4}-\d{2}$/.test(value)
		? `${value}-01T00:00:00Z`
		: value;
	const date = new Date(normalized);
	return Number.isFinite(date.getTime()) ? date : null;
}

function incrementPeriod(value: Date, grain: FactGrain): Date {
	const date = new Date(value);
	if (grain === FactGrain.MONTH) {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
	}
	if (grain === FactGrain.WEEK) {
		return new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
	}
	if (grain === FactGrain.DAY) {
		return new Date(date.getTime() + 24 * 60 * 60 * 1000);
	}
	if (grain === FactGrain.QUARTER) {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1));
	}
	return new Date(date.getTime() + 1);
}

function verificationRows(input: {
	eligibilityVerified: boolean;
	resultPresent: boolean;
	questionVersion: number;
	capturedAt: Date;
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
			evidence: json({ questionVersion: input.questionVersion }),
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
			name: "exclude_banned_disabled_anonymous_internal",
			referenceType: "eligibility_policy",
			referenceValue: json(sharedNormalizationPolicy),
			actualValue: json({ enforced: input.eligibilityVerified }),
			evidence: json({
				reason: input.eligibilityVerified
					? "The source query applies the canonical exclusions."
					: "TinyBird usage must be joined to the governed product-user eligibility dataset.",
			}),
			status: input.eligibilityVerified
				? VerificationStatus.PASSED
				: VerificationStatus.PENDING,
			verifiedBy: input.eligibilityVerified ? "atlas-policy" : null,
			verifiedAt: input.eligibilityVerified ? input.capturedAt : null,
		},
	];
}

function hash(value: unknown): string {
	return createHash("sha256")
		.update(typeof value === "string" ? value : JSON.stringify(value))
		.digest("hex");
}

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
