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
import type { RevenueDoorPolicyEvidence } from "./revenue-door-policy.service";

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
	pendingChecks?: Array<{
		name: string;
		reason: string;
	}>;
	ownerTeam?: string;
	createdBy?: string;
	cadenceMinutes?: number;
};

export type PublishInput = {
	question: {
		id: string;
		number: number;
		name: string;
		description: string | null;
		connector?: DataSourceKind;
		sourceExternalId: string | null;
		databaseExternalId: string | null;
		metricVersionId?: string | null;
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
	eligibility?: {
		applied: boolean;
		capturedAt: string;
		contentHash: string;
		excludedUsers: number;
		excludedOrganizations: number;
		excludedCustomers: number;
		complete: boolean;
		sourceRows: number;
		returnedRows: number;
		scope?: "ALL_IDENTITIES" | "SUBSCRIBED_ORGANIZATIONS";
	};
	revenueDoorPolicy?: RevenueDoorPolicyEvidence;
};

const sharedNormalizationPolicy = {
	timeZone: "UTC",
	periodBoundaries: "half_open",
	internalDomains: ["sync.so", "sync.labs"],
	excludedUserStates: ["banned", "anonymous"],
	observedLifecycleStates: ["disabled"],
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
			"Self-serve organizations with 3+ billable generations on 2+ distinct UTC days.",
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
				"3+ completed generations across 2+ distinct UTC days within 14 days",
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
				"$100+ accrued value, 3+ billable generations, and generations on 2+ distinct UTC days",
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
			"Accrued professional organization-months with $100+ in paid subscription and usage invoices in the same month.",
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
	{
		questionNumber: 42,
		sourceExternalId: "8318",
		key: "product.generation_upvote_rate",
		name: "Generation upvote rate",
		description:
			"Positive ratings divided by all rated generations, with model and workflow breakdowns.",
		grain: FactGrain.WEEK,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "week_start",
		businessDefinition: {
			entity: "generation",
			numerator: "positive_rated_generations",
			denominator: "all_rated_generations",
			breakdowns: ["model", "workflow"],
		},
		computation: {
			aggregate: "ratio_percentage",
			output: "positive_feedback_rate_pct",
		},
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "approved_rating_definition",
				reason:
					"Confirm which feedback values count as positive and how ratings on retried or deleted generations are treated.",
			},
		],
	},
	{
		questionNumber: 39,
		sourceExternalId: "8252",
		key: "product.feedback_coverage_rate",
		name: "Feedback coverage rate",
		description:
			"Rated completed app generations divided by completed app generations.",
		grain: FactGrain.WEEK,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "week_start",
		businessDefinition: {
			entity: "completed_app_generation",
			numerator: "rated_completed_app_generations",
			denominator: "completed_app_generations",
			breakdowns: ["workflow", "model"],
		},
		computation: {
			aggregate: "ratio_percentage",
			output: "feedback_coverage_rate_pct",
		},
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "approved_completed_status",
				reason:
					"Confirm that the denominator is final completed app generations and how retried or deleted generations are treated.",
			},
		],
	},
];

export const REVENUE_CLOSE_METRIC_SPECS: ProductMetricSpec[] = [
	{
		questionNumber: 1001,
		sourceExternalId: "revenue:product-run-rate",
		key: "company.revenue_close_product_run_rate",
		name: "Product accrual run-rate",
		description:
			"Monthly usage incurred when generations finish plus the licensed invoice-item base. This is a run-rate reconstruction, not cash collected or recognized revenue.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "generationEndedAt and invoice-item createdAt",
		businessDefinition: {
			formula: "paid_usage_accrual + licensed_subscription_base_proxy",
			usageTimeField: "generationEndedAt",
			classification: "run_rate_reconstruction",
			notEquivalentTo: ["cash_collected", "recognized_revenue"],
		},
		computation: { aggregate: "sum", output: "product_run_rate" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1002,
		sourceExternalId: "revenue:paid-usage-accrual",
		key: "company.revenue_close_paid_usage_accrual",
		name: "Paid usage accrual",
		description:
			"Generation value incurred in the UTC month when each generation finished. This is usage activity, not an invoice or cash receipt.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			valueBasis: "generationCostMillicents divided by 100000",
			timeField: "generationEndedAt",
			population: "organizations with a non-empty paid plan type",
		},
		computation: { aggregate: "monthly_sum", output: "usage_usd" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1003,
		sourceExternalId: "revenue:licensed-subscription-base",
		key: "company.revenue_close_licensed_subscription_base_proxy",
		name: "Licensed subscription base proxy",
		description:
			"Licensed Stripe invoice-item value after keeping one latest state per invoice-item id. This is an invoice-item proxy, not the live active-subscription base.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "createdAt",
		businessDefinition: {
			entity: "latest_stripe_invoice_item_state",
			priceType: "licensed",
			includedStatuses: ["paid", "open"],
			classification: "subscription_base_proxy",
		},
		computation: { aggregate: "monthly_sum", output: "subs_usd" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1004,
		sourceExternalId: "revenue:paid-customer-revenue",
		key: "company.revenue_close_paid_customer_monthly_revenue",
		name: "Paid customer monthly revenue",
		description:
			"Monthly paid-customer revenue from the warehouse table used as a native SQL replacement for Metabase question 1256.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "month",
		businessDefinition: {
			source: "sync_prod.paid_customer_monthly_revenue",
			replacesMetabaseQuestion: 1256,
			classification: "native_sql_equivalent",
		},
		computation: { aggregate: "monthly_sum", output: "revenue_usd" },
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "saved_question_equivalence",
				reason:
					"Direct execution of Metabase question 1256 is permission blocked, so Atlas cannot yet prove that the native SQL replacement is exactly equivalent.",
			},
		],
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1005,
		sourceExternalId: "revenue:paid-invoice-collections",
		key: "company.revenue_close_stripe_collections",
		name: "Stripe paid invoice collections",
		description:
			"Cash paid on Stripe invoices after keeping one latest state per invoice id. This is money collected, not invoices raised or recognized revenue.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "invoice createdAt",
		businessDefinition: {
			entity: "latest_stripe_invoice_state",
			valueBasis: "amountPaid",
			includedStatus: "paid",
			classification: "cash_collected",
		},
		computation: { aggregate: "monthly_sum", output: "collections_usd" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1006,
		sourceExternalId: "revenue:paid-open-billings",
		key: "company.revenue_close_stripe_billings",
		name: "Stripe paid + open invoice billings",
		description:
			"Stripe invoice amount due after keeping one latest state per invoice id, grouped by invoice creation month. This is invoices raised, not cash collected.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "invoice createdAt",
		businessDefinition: {
			entity: "latest_stripe_invoice_state",
			valueBasis: "amountDue",
			includedStatuses: ["paid", "open"],
			classification: "invoices_raised",
		},
		computation: { aggregate: "monthly_sum", output: "amount_due_usd" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1007,
		sourceExternalId: "revenue:usage-spend-ndr",
		key: "company.revenue_close_usage_ndr",
		name: "Usage-spend NDR",
		description:
			"Next-month usage from the fixed prior-month organization cohort divided by that cohort's starting usage. Organizations with no next-month usage count as zero.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			cohort: "organizations with usage in the starting month",
			numerator: "next-month usage from the same organizations",
			denominator: "starting-month usage",
			missingCurrentUsage: 0,
		},
		computation: { aggregate: "cohort_ratio", output: "usage_ndr_pct" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1008,
		sourceExternalId: "revenue:product-run-rate-history",
		key: "company.revenue_close_run_rate_history",
		name: "Product run-rate composition history",
		description:
			"Shows monthly usage incurred and the licensed invoice-item proxy as separate parts of the product run-rate reconstruction.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "generationEndedAt and invoice-item createdAt",
		businessDefinition: {
			components: ["paid_usage_accrual", "licensed_subscription_base_proxy"],
			classification: "run_rate_reconstruction",
		},
		computation: { aggregate: "monthly_components" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1009,
		sourceExternalId: "revenue:reconciliation-history",
		key: "company.revenue_close_reconciliation_history",
		name: "Revenue reconciliation history",
		description:
			"Shows paid-customer revenue, Stripe cash collected, and Stripe invoices raised side by side. These are different views and must not be added together.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "month and invoice createdAt",
		businessDefinition: {
			measures: [
				"paid_customer_revenue",
				"paid_invoice_collections",
				"paid_open_invoice_billings",
			],
			warning: "the measures are reconciliations, not additive revenue",
		},
		computation: { aggregate: "monthly_reconciliation" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1010,
		sourceExternalId: "revenue:usage-spend-ndr-history",
		key: "company.revenue_close_usage_ndr_history",
		name: "Usage-spend NDR history",
		description:
			"Shows the fixed-cohort usage NDR calculation for each complete month pair in the history window.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			cohort: "organizations with usage in the starting month",
			numerator: "next-month usage from the same organizations",
			denominator: "starting-month usage",
		},
		computation: { aggregate: "monthly_cohort_ratio_history" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1011,
		sourceExternalId: "revenue:annualized-run-rate",
		key: "company.revenue_close_annualized_run_rate",
		name: "Annualized product run-rate",
		description:
			"Monthly product accrual run-rate multiplied by 12. This is a pace estimate, not a forecast or recognized annual revenue.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "generationEndedAt and invoice-item createdAt",
		businessDefinition: {
			formula: "monthly_product_run_rate multiplied by 12",
			classification: "annualized_pace",
		},
		computation: { aggregate: "multiply", output: "annualized_run_rate" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1012,
		sourceExternalId: "revenue:paid-usage-organizations",
		key: "company.revenue_close_paid_usage_organizations",
		name: "Paid usage organizations",
		description:
			"Counts distinct organizations with paid-plan generation usage in each complete UTC month, using the generation finish time.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			entity: "organization_month",
			timeField: "generationEndedAt",
			population: "organizations with a non-empty paid plan type",
		},
		computation: {
			aggregate: "count_distinct",
			output: "paid_usage_organizations",
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1013,
		sourceExternalId: "revenue:ndr-starting-spend",
		key: "company.revenue_close_ndr_starting_spend",
		name: "NDR starting cohort spend",
		description:
			"Shows the starting-month usage for the fixed organization cohort. This is the denominator of Usage-spend NDR.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			cohort: "organizations with usage in the starting month",
			role: "usage_ndr_denominator",
		},
		computation: { aggregate: "monthly_sum", output: "starting_usage_spend" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1014,
		sourceExternalId: "revenue:ndr-retained-spend",
		key: "company.revenue_close_ndr_retained_spend",
		name: "NDR retained cohort spend",
		description:
			"Shows next-month usage from the fixed starting cohort. This is the numerator of Usage-spend NDR.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			cohort: "organizations with usage in the starting month",
			role: "usage_ndr_numerator",
			missingCurrentUsage: 0,
		},
		computation: { aggregate: "monthly_sum", output: "retained_usage_spend" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-close",
		cadenceMinutes: 8 * 60,
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
			revenueDoor: "sync.tools",
			licensedBase:
				"latest active or past-due self-serve subscriptions at the current v2 or v3 plan price",
			usageActual: "paid-plan generation value grouped by generationEndedAt",
			usagePace:
				"month-to-date accrued usage divided by exact elapsed UTC seconds and multiplied by seconds in the calendar month",
			productRunRate: "licensed base plus projected accrued usage",
			annualizedRunRate: "product run-rate multiplied by 12",
			excluded: [
				"enterprise plans",
				"program plans",
				"channel partners in the governed revenue-door registry",
			],
			channelPartnerRegistryStatus: "partial",
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
		name: "Self-serve combined run-rate",
		description:
			"Self-serve subscription run-rate plus projected current-month usage accrual at one UTC cutoff. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			revenueDoor: "sync.tools",
			formula: "licensed_subscription_base + projected_usage_accrual",
			enterpriseCommitmentsIncluded: false,
			channelPartnersIncluded: false,
			channelPartnerRegistryStatus: "partial",
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
		name: "Self-serve usage accrual and MTD pace",
		description:
			"Completed-month usage accrual plus current-month actual and projected pace, using generationEndedAt in UTC. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			revenueDoor: "sync.tools",
			valueBasis: "generationCostMillicents divided by 100000",
			timeField: "generationEndedAt",
			population:
				"self-serve organizations after governed revenue-door exclusions",
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
		name: "Self-serve subscription run-rate by billing type and plan",
		description:
			"Latest active or past-due self-serve Stripe subscriptions multiplied by the current monthly plan price, grouped by V2 or V3 billing type and plan. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed. This is subscription run-rate, not cash collected.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "createdAt",
		businessDefinition: {
			revenueDoor: "sync.tools",
			entity: "latest_subscription",
			billingType: {
				V2: ["hobbyist", "creator", "growth", "scale"],
				V3: ["starter", "pro", "team"],
			},
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
		questionNumber: 1110,
		sourceExternalId: "weekly-revenue:usage-run-rate",
		key: "company.self_serve_usage_run_rate",
		name: "Self-serve usage run-rate",
		description:
			"Projected self-serve usage accrual for the current UTC month compared with the previous complete month. Completed months use actual accrued usage. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			revenueDoor: "sync.tools",
			valueBasis: "generationCostMillicents divided by 100000",
			timeField: "generationEndedAt",
			currentMonth:
				"month-to-date accrual projected over the full UTC calendar month using exact elapsed seconds",
			channelPartnersIncluded: false,
			channelPartnerRegistryStatus: "partial",
		},
		computation: {
			aggregate: "monthly_sum_or_current_month_pace",
			output: "usage_run_rate",
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1111,
		sourceExternalId: "weekly-revenue:subscription-run-rate",
		key: "company.self_serve_subscription_run_rate",
		name: "Self-serve subscription run-rate",
		description:
			"Active or past-due self-serve subscriptions at the plan price in effect at each UTC cutoff, compared with the previous month-end. Excludes enterprise and program plans, plus known channel partners in the governed revenue-door registry. The channel-partner list is still being completed.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "createdAt",
		businessDefinition: {
			revenueDoor: "sync.tools",
			includedStatuses: ["active", "past_due"],
			valueBasis: "subscription count multiplied by monthly plan price",
			channelPartnersIncluded: false,
			channelPartnerRegistryStatus: "partial",
		},
		computation: {
			aggregate: "subscription_count_times_plan_price",
			output: "subscription_run_rate",
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1112,
		sourceExternalId: "weekly-revenue:partner-usage-run-rate",
		key: "company.partner_usage_run_rate",
		name: "Channel-partner usage run-rate",
		description:
			"Accrued usage from organizations in the governed sync.partners registry. The current month is projected from the exact UTC data-through time and compared with the previous complete month.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			revenueDoor: "sync.partners",
			valueBasis: "generationCostMillicents divided by 100000",
			timeField: "generationEndedAt",
			currentMonth:
				"month-to-date accrual projected over the full UTC calendar month using exact elapsed seconds",
			partnerRegistryStatus: "partial",
		},
		computation: {
			aggregate: "monthly_sum_or_current_month_pace",
			output: "partner_usage_run_rate",
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1113,
		sourceExternalId: "weekly-revenue:partner-booked-revenue",
		key: "company.partner_booked_revenue",
		name: "Channel-partner invoices raised",
		description:
			"Stripe invoice amount due for known channel partners, counted once when the invoice was raised. The current month is compared with the same elapsed UTC window in the previous month. This is booked revenue, not cash collected or recognized revenue.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "createdAt",
		businessDefinition: {
			revenueDoor: "sync.partners",
			entity: "stripe_invoice",
			valueBasis: "amountDue",
			timeField: "invoice createdAt",
			deduplication: "one latest-state record per Stripe invoice id",
			comparison: "current MTD versus the same elapsed UTC window last month",
		},
		computation: { aggregate: "sum", output: "booked_revenue" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1114,
		sourceExternalId: "weekly-revenue:partner-cash-collected",
		key: "company.partner_cash_collected",
		name: "Channel-partner cash collected",
		description:
			"Stripe amount paid for known channel-partner invoices, grouped by the actual paid timestamp. The current month is compared with the same elapsed UTC window in the previous month. This is cash collected, not booked or recognized revenue.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "status_transitions.paid_at",
		businessDefinition: {
			revenueDoor: "sync.partners",
			entity: "paid_stripe_invoice",
			valueBasis: "amountPaid",
			timeField: "status_transitions.paid_at",
			deduplication: "one paid result per Stripe invoice id",
			comparison: "current MTD versus the same elapsed UTC window last month",
		},
		computation: { aggregate: "sum", output: "cash_collected" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1115,
		sourceExternalId: "weekly-revenue:partner-usage-history",
		key: "company.partner_usage_history",
		name: "Channel-partner usage by partner",
		description:
			"Monthly accrued usage for the four known channel-partner domains and any additional organizations already marked with the partner plan. The current month is month to date.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			revenueDoor: "sync.partners",
			breakdown: "governed partner label",
			valueBasis: "accrued usage",
			partnerRegistryStatus: "partial",
		},
		computation: { aggregate: "monthly_sum_by_partner" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1116,
		sourceExternalId: "weekly-revenue:partner-reconciliation",
		key: "company.partner_revenue_reconciliation",
		name: "Channel-partner revenue reconciliation",
		description:
			"Monthly partner usage incurred, Stripe invoices raised, and cash collected shown together by partner. These are different accounting views and must not be added together.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt and Stripe invoice timestamps",
		businessDefinition: {
			revenueDoor: "sync.partners",
			measures: ["usage_incurred", "invoices_raised", "cash_collected"],
			warning: "the three measures are reconciliations, not additive revenue",
		},
		computation: { aggregate: "monthly_sum_by_partner_and_basis" },
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
			revenueDoor: "sync.tools",
			cohort:
				"self-serve organizations with accrued usage in the starting month after governed revenue-door exclusions",
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
			revenueDoor: "sync.tools",
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
			revenueDoor: "sync.tools",
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
			revenueDoor: "sync.tools",
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
			revenueDoor: "sync.tools",
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

const ALL_METRIC_SPECS = [
	...PRODUCT_METRIC_SPECS,
	...REVENUE_CLOSE_METRIC_SPECS,
	...REVENUE_METRIC_SPECS,
];
const specsByQuestion = new Map(
	ALL_METRIC_SPECS.map((spec) => [spec.questionNumber, spec]),
);
const specsBySourceExternalId = new Map(
	ALL_METRIC_SPECS.map((spec) => [spec.sourceExternalId, spec]),
);

type LinkedMetric = {
	approvedAt: Date | null;
	metric: {
		key: string;
		name: string;
		description: string;
		ownerTeam: string;
	};
};

function buildQuestionMetricSpec(
	input: PublishInput,
	linkedMetric?: LinkedMetric,
): ProductMetricSpec {
	const name = linkedMetric?.metric.name ?? input.question.name;
	const sourceKind =
		input.question.databaseExternalId === "166"
			? DataSourceKind.TINYBIRD
			: input.question.databaseExternalId === "34"
				? DataSourceKind.POSTGRES
				: (input.question.connector ?? DataSourceKind.METABASE);
	const sourceLabel =
		sourceKind === DataSourceKind.TINYBIRD
			? "TinyBird through Metabase"
			: sourceKind === DataSourceKind.POSTGRES
				? "Product Postgres through Metabase"
				: sourceKind === DataSourceKind.POSTHOG
					? "PostHog"
					: sourceKind === DataSourceKind.HUBSPOT
						? "HubSpot CRM"
						: sourceKind === DataSourceKind.STRIPE
							? "Stripe"
							: sourceKind === DataSourceKind.ATLAS
								? "Atlas normalized source"
								: "Metabase saved question";
	const pendingChecks = linkedMetric?.approvedAt
		? []
		: [
				{
					name: "approved_metric_definition",
					reason:
						"The query returns data, but the metric owner still needs to confirm the definition, population, and reporting period.",
				},
			];
	return {
		questionNumber: input.question.number,
		sourceExternalId:
			input.question.sourceExternalId ?? `question:${input.question.number}`,
		key:
			linkedMetric?.metric.key ??
			`atlas.question.${input.question.number}.${metricSlug(input.question.name)}`,
		name,
		description:
			linkedMetric?.metric.description ??
			input.question.description ??
			`The governed result for Atlas question ${input.question.number}, ${input.question.name}.`,
		grain: inferQuestionGrain(input.question.name, input.version.queryText),
		source: {
			key: `atlas-question-source:${sourceKind.toLowerCase()}:${input.question.databaseExternalId ?? "local"}`,
			kind: sourceKind,
			label: sourceLabel,
		},
		eventTimeField: "source_query_period",
		businessDefinition: {
			questionNumber: input.question.number,
			questionName: input.question.name,
			definition:
				input.question.description ??
				"The saved Atlas query is the current candidate definition.",
			definitionState:
				pendingChecks.length === 0 ? "approved" : "pending_owner_review",
		},
		computation: {
			type: "saved_question",
			queryLanguage: input.version.queryLanguage,
			output: "query_result",
		},
		requiresCrossSourceEligibility: questionNeedsIdentityEligibility(input),
		pendingChecks,
		ownerTeam: linkedMetric?.metric.ownerTeam ?? "Atlas",
		createdBy: "atlas-question-registry",
	};
}

function questionNeedsIdentityEligibility(input: PublishInput): boolean {
	if (input.question.connector === DataSourceKind.HUBSPOT) return false;
	const text =
		`${input.question.name}\n${input.version.queryText}`.toLowerCase();
	return (
		input.question.databaseExternalId === "166" ||
		/(?:user|organization|org\b|signup|generation|subscription|customer|revenue|usage|retention|churn|activation|professional)/.test(
			text,
		)
	);
}

function inferQuestionGrain(name: string, queryText: string): FactGrain {
	const text = `${name}\n${queryText}`.toLowerCase();
	if (/quarter|date_trunc\s*\(\s*'quarter'/.test(text))
		return FactGrain.QUARTER;
	if (/weekly|\bweek\b|date_trunc\s*\(\s*'week'/.test(text))
		return FactGrain.WEEK;
	if (/daily|\btoday\b|\bday\b|date_trunc\s*\(\s*'day'/.test(text))
		return FactGrain.DAY;
	if (/monthly|\bmonth\b|date_trunc\s*\(\s*'month'/.test(text))
		return FactGrain.MONTH;
	return FactGrain.EVENT;
}

function metricSlug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 80);
}

function sourceAdapter(kind: DataSourceKind): string {
	if (kind === DataSourceKind.POSTHOG) return "posthog_hogql";
	if (kind === DataSourceKind.HUBSPOT) return "hubspot_normalized_query";
	if (kind === DataSourceKind.STRIPE) return "stripe_normalized_query";
	if (kind === DataSourceKind.ATLAS) return "atlas_normalized_query";
	return "metabase_read_transport";
}

function sourceTransport(kind: DataSourceKind): string {
	if (kind === DataSourceKind.POSTHOG) return "posthog";
	if (kind === DataSourceKind.HUBSPOT) return "hubspot";
	if (kind === DataSourceKind.STRIPE) return "stripe";
	if (kind === DataSourceKind.ATLAS) return "atlas";
	return "metabase";
}

export function preferredAtlasQuestionNumber(
	sourceExternalId: string,
): number | null {
	return specsBySourceExternalId.get(sourceExternalId)?.questionNumber ?? null;
}

@Injectable()
export class ProductMetricPublisher {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async publish(input: PublishInput) {
		const registeredSpec =
			(input.question.sourceExternalId
				? specsBySourceExternalId.get(input.question.sourceExternalId)
				: undefined) ?? specsByQuestion.get(input.question.number);
		const linkedMetric =
			!registeredSpec && input.question.metricVersionId
				? await this.db.metricVersion.findUnique({
						where: { id: input.question.metricVersionId },
						select: {
							approvedAt: true,
							metric: {
								select: {
									key: true,
									name: true,
									description: true,
									ownerTeam: true,
								},
							},
						},
					})
				: null;
		const spec =
			registeredSpec ??
			buildQuestionMetricSpec(input, linkedMetric ?? undefined);
		const ownerTeam = spec.ownerTeam ?? "Product";
		const createdBy = spec.createdBy ?? "atlas-product-registry";
		const cadenceMinutes = spec.cadenceMinutes ?? 8 * 60;

		const eligibilityVerified =
			!spec.requiresCrossSourceEligibility ||
			(input.eligibility?.applied === true &&
				input.eligibility.complete === true) ||
			hasRequiredEligibilityPredicates(input.version.queryText);
		const requiresRevenueDoorPolicy = REVENUE_METRIC_SPECS.some(
			(candidate) => candidate.key === spec.key,
		);
		const revenueDoorVerified =
			!requiresRevenueDoorPolicy ||
			(input.revenueDoorPolicy?.applied === true &&
				input.revenueDoorPolicy.complete === true);
		const governanceVerified = eligibilityVerified && revenueDoorVerified;
		const definitionVerified = (spec.pendingChecks?.length ?? 0) === 0;
		const lifecycleStatus =
			governanceVerified && definitionVerified
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
				adapter: sourceAdapter(spec.source.kind),
				eventTimeField: spec.eventTimeField,
				watermarkField: spec.eventTimeField,
				cadenceMinutes,
				freshnessSlaMinutes: FRESHNESS_SLA_MINUTES,
				backfillWindowDays: 366,
				config: json({
					databaseExternalId: input.question.databaseExternalId,
					transport: sourceTransport(spec.source.kind),
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
					transport: sourceTransport(spec.source.kind),
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
				state: governanceVerified
					? "enforced"
					: revenueDoorVerified
						? "pending_cross_source_join"
						: "pending_revenue_door_registry",
				revenueDoorPolicy: requiresRevenueDoorPolicy
					? {
							policyId: input.revenueDoorPolicy?.policyId ?? null,
							status: input.revenueDoorPolicy?.status ?? null,
							complete: input.revenueDoorPolicy?.complete ?? false,
							contentHash: input.revenueDoorPolicy?.contentHash ?? null,
							matchMode: input.revenueDoorPolicy?.matchMode ?? null,
							door: input.revenueDoorPolicy?.door ?? null,
							excludedPlans: input.revenueDoorPolicy?.excludedPlans ?? [],
							excludedDomains: input.revenueDoorPolicy?.excludedDomains ?? [],
							includedPlans: input.revenueDoorPolicy?.includedPlans ?? [],
							includedDomains: input.revenueDoorPolicy?.includedDomains ?? [],
						}
					: null,
			},
			computation: spec.computation,
			verificationPolicy: {
				tolerance: 0,
				requiredChecks: [
					"read_only_query",
					"source_snapshot",
					"result_non_empty",
					...(spec.requiresCrossSourceEligibility
						? ["exclude_banned_anonymous_internal"]
						: []),
					...(requiresRevenueDoorPolicy
						? ["complete_revenue_door_registry"]
						: []),
					...(spec.pendingChecks?.map((check) => check.name) ?? []),
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
					approvedBy:
						governanceVerified && definitionVerified ? "atlas-policy" : null,
					approvedAt:
						governanceVerified && definitionVerified ? input.capturedAt : null,
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
		} else if (
			governanceVerified &&
			definitionVerified &&
			!metricVersion.approvedAt
		) {
			metricVersion = await this.db.metricVersion.update({
				where: { id: metricVersion.id },
				data: { approvedBy: "atlas-policy", approvedAt: input.capturedAt },
			});
		}

		await this.db.question.update({
			where: { id: input.question.id },
			data: {
				metricVersionId: metricVersion.id,
				purpose:
					governanceVerified && definitionVerified
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
					checkpoint: json({
						reportingPeriod: window.reportingPeriod,
						eligibility: input.eligibility ?? null,
						revenueDoorPolicy: input.revenueDoorPolicy ?? null,
					}),
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
			governanceVerified,
			eligibility: input.eligibility,
			revenueDoorPolicy: input.revenueDoorPolicy,
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
			: governanceVerified && definitionVerified
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
				validation: json({
					eligibilityVerified,
					eligibility: input.eligibility ?? null,
					revenueDoorVerified,
					revenueDoorPolicy: input.revenueDoorPolicy ?? null,
					resultPresent,
				}),
				startedAt: input.capturedAt,
				finishedAt: input.capturedAt,
				verifications: {
					create: verificationRows({
						eligibilityVerified,
						requiresEligibility: spec.requiresCrossSourceEligibility,
						eligibility: input.eligibility,
						requiresRevenueDoorPolicy,
						revenueDoorPolicy: input.revenueDoorPolicy,
						resultPresent,
						questionVersion: input.version.version,
						capturedAt: input.capturedAt,
						pendingChecks: spec.pendingChecks ?? [],
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
		governanceVerified: boolean;
		eligibility?: PublishInput["eligibility"];
		revenueDoorPolicy?: RevenueDoorPolicyEvidence;
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
					evidence: {
						userEligibility: input.eligibility ?? null,
						revenueDoorPolicy: input.revenueDoorPolicy ?? null,
					},
					state: input.governanceVerified ? "enforced" : "pending_governance",
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
	return ["banned", "is_anonymous", "@sync.so", "@sync.labs"].every((term) =>
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
	requiresEligibility: boolean;
	eligibility?: PublishInput["eligibility"];
	requiresRevenueDoorPolicy: boolean;
	revenueDoorPolicy?: RevenueDoorPolicyEvidence;
	resultPresent: boolean;
	questionVersion: number;
	capturedAt: Date;
	pendingChecks: Array<{ name: string; reason: string }>;
}) {
	const passed = {
		status: VerificationStatus.PASSED,
		verifiedBy: "atlas-policy",
		verifiedAt: input.capturedAt,
	};
	const eligibility = input.eligibility;
	const incompleteEligibilityReason =
		eligibility?.scope === "SUBSCRIBED_ORGANIZATIONS" &&
		!input.eligibilityVerified
			? "Atlas applied the smaller subscribed-customer exclusion list. This keeps known paying banned and internal identities out, but it does not certify the wider free-user population."
			: eligibility && eligibility.complete === false
				? `Atlas could load only ${eligibility.returnedRows.toLocaleString()} of ${eligibility.sourceRows.toLocaleString()} identity and organization membership records because the source response was capped. This is not the number of customers in this metric. Atlas did not apply or approve a partial banned, anonymous, and internal identity filter.`
				: "TinyBird usage must be joined to the governed product-user eligibility dataset.";
	const eligibilityPassedReason =
		eligibility?.scope === "SUBSCRIBED_ORGANIZATIONS"
			? "The revenue query requires subscription history, then excludes banned, anonymous, and internal identities linked to that population."
			: "The source query applies the canonical exclusions.";
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
		...(input.requiresEligibility
			? [
					{
						name: "exclude_banned_anonymous_internal",
						referenceType: "eligibility_policy",
						referenceValue: json(sharedNormalizationPolicy),
						actualValue: json({ enforced: input.eligibilityVerified }),
						evidence: json({
							reason: input.eligibilityVerified
								? eligibilityPassedReason
								: incompleteEligibilityReason,
						}),
						status: input.eligibilityVerified
							? VerificationStatus.PASSED
							: VerificationStatus.PENDING,
						verifiedBy: input.eligibilityVerified ? "atlas-policy" : null,
						verifiedAt: input.eligibilityVerified ? input.capturedAt : null,
					},
				]
			: []),
		...(input.requiresRevenueDoorPolicy
			? [
					{
						name: "complete_revenue_door_registry",
						referenceType: "revenue_door_policy",
						referenceValue: json({
							policyId: "company-revenue-doors",
							requiredStatus: "COMPLETE",
						}),
						actualValue: json({
							applied: input.revenueDoorPolicy?.applied ?? false,
							status: input.revenueDoorPolicy?.status ?? null,
							complete: input.revenueDoorPolicy?.complete ?? false,
						}),
						evidence: json({
							reason: input.revenueDoorPolicy?.complete
								? "The revenue-door registry is complete and was applied before aggregation."
								: input.revenueDoorPolicy?.matchMode === "INCLUDE_PARTNERS"
									? "Known channel partners are included, but the partner registry still needs a complete review."
									: "Known non-tools revenue is excluded, but the channel-partner registry still needs a complete review.",
							matchMode: input.revenueDoorPolicy?.matchMode ?? null,
							door: input.revenueDoorPolicy?.door ?? null,
							excludedPlans: input.revenueDoorPolicy?.excludedPlans ?? [],
							excludedDomains: input.revenueDoorPolicy?.excludedDomains ?? [],
							excludedOrganizationCount:
								input.revenueDoorPolicy?.excludedOrganizationIds.length ?? 0,
							includedPlans: input.revenueDoorPolicy?.includedPlans ?? [],
							includedDomains: input.revenueDoorPolicy?.includedDomains ?? [],
							includedOrganizationCount:
								input.revenueDoorPolicy?.includedOrganizationIds.length ?? 0,
							unresolvedDomains:
								input.revenueDoorPolicy?.unresolvedDomains ?? [],
							contentHash: input.revenueDoorPolicy?.contentHash ?? null,
						}),
						status: input.revenueDoorPolicy?.complete
							? VerificationStatus.PASSED
							: VerificationStatus.PENDING,
						verifiedBy: input.revenueDoorPolicy?.complete
							? "atlas-policy"
							: null,
						verifiedAt: input.revenueDoorPolicy?.complete
							? input.capturedAt
							: null,
					},
				]
			: []),
		...input.pendingChecks.map((check) => ({
			name: check.name,
			referenceType: "definition_approval",
			referenceValue: json({ required: true }),
			actualValue: json({ approved: false }),
			evidence: json({ reason: check.reason }),
			status: VerificationStatus.PENDING,
			verifiedBy: null,
			verifiedAt: null,
		})),
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
