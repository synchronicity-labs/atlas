import { createHash } from "node:crypto";
import {
	DataSourceKind,
	type Db,
	FactGrain,
	MetricCatalogKind,
	MetricLifecycleStatus,
	MetricReadinessStatus,
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
		policy?: "PRODUCT_ACTIVITY" | "MONEY";
		enforcement?: "POSTGRES_LIVE_JOIN" | "TINYBIRD_ID_EXCLUSIONS";
		limitation?: "BANNED_NEVER_SUBSCRIBED_JOIN_REQUIRED";
	};
	revenueDoorPolicy?: RevenueDoorPolicyEvidence;
	verificationChecks?: PublishVerificationCheck[];
};

export type PublishVerificationCheck = {
	name: string;
	status: VerificationStatus;
	reason: string;
	referenceValue?: unknown;
	actualValue?: unknown;
};

const sharedNormalizationPolicy = {
	timeZone: "UTC",
	periodBoundaries: "half_open",
	internalDomains: ["sync.so", "sync.labs"],
	excludedUserStates: ["banned_never_subscribed"],
	observedLifecycleStates: ["disabled"],
	moneyMetricBanPolicy: "keep_historical_paying_customers",
	retroactiveEligibility: "current_known_state",
};

const STUDIO_INSIGHT_CHECKS = [
	{
		name: "native_insight_definition",
		reason:
			"The native PostHog query must match the approved Studio funnel or retention definition and filter test accounts.",
	},
	{
		name: "period_population",
		reason:
			"Every published period or cohort must contain a valid denominator and non-negative output values.",
	},
	{
		name: "metric_reconciliation",
		reason:
			"Published rates must reconcile to their counts, and time-to-magic outputs must remain positive.",
	},
	{
		name: "cohort_maturity",
		reason:
			"Every result must use a complete source period and retention requires a full week-two observation window.",
	},
	{
		name: "sensitive_detail_boundary",
		reason:
			"The result must exclude person, customer, user, organization, and email identifiers.",
	},
	{
		name: "complete_period_watermark",
		reason: "Every row must use one complete-period data-through boundary.",
	},
];

const STUDIO_NATIVE_INSIGHT_SPECS: ProductMetricSpec[] = [
	{
		questionNumber: 7042,
		sourceExternalId: "cron:studio:insight-weekly-time-to-magic",
		key: "product.studio_weekly_time_to_magic",
		name: "Weekly Studio time to magic",
		description:
			"Median and average signup-to-successful-generation time for complete UTC weeks under the approved native PostHog funnel.",
		grain: FactGrain.WEEK,
		eventTimeField: "period_start",
		businessDefinition: {
			entity: "studio_signup_funnel_week",
			periodAssignment: "explicit complete UTC week",
			steps: [
				"pageview",
				"user_signed_up",
				"playground_started_generation",
				"playground_completed_generation",
			],
			measurement:
				"median and average seconds from signup step to completion step",
			window: "ordered funnel completed within 30 minutes",
			generationExclusions: ["plugin_premiere", "agent"],
			population:
				"PostHog test-account filter; native insight output does not expose identity rows",
		},
		computation: {
			aggregate: "native_funnel_time_to_convert",
			outputs: ["median_seconds", "average_seconds", "converted_users"],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: STUDIO_INSIGHT_CHECKS,
		ownerTeam: "Productions",
		createdBy: "atlas-studio-insight-registry",
		cadenceMinutes: 8 * 60,
		source: {
			key: "posthog:product-events",
			kind: DataSourceKind.POSTHOG,
			label: "PostHog native Studio funnel",
		},
	},
	{
		questionNumber: 7043,
		sourceExternalId: "cron:studio:insight-monthly-time-to-magic",
		key: "product.studio_monthly_time_to_magic",
		name: "Monthly Studio time to magic",
		description:
			"Median and average signup-to-successful-generation time for complete UTC months under the approved native PostHog funnel.",
		grain: FactGrain.MONTH,
		eventTimeField: "period_start",
		businessDefinition: {
			entity: "studio_signup_funnel_month",
			periodAssignment: "explicit complete UTC calendar month",
			steps: [
				"pageview",
				"user_signed_up",
				"playground_started_generation",
				"playground_completed_generation",
			],
			measurement:
				"median and average seconds from signup step to completion step",
			window: "ordered funnel completed within 30 minutes",
			generationExclusions: ["plugin_premiere", "agent"],
			population:
				"PostHog test-account filter; native insight output does not expose identity rows",
		},
		computation: {
			aggregate: "native_funnel_time_to_convert",
			outputs: ["median_seconds", "average_seconds", "converted_users"],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: STUDIO_INSIGHT_CHECKS,
		ownerTeam: "Productions",
		createdBy: "atlas-studio-insight-registry",
		cadenceMinutes: 8 * 60,
		source: {
			key: "posthog:product-events",
			kind: DataSourceKind.POSTHOG,
			label: "PostHog native Studio funnel",
		},
	},
	{
		questionNumber: 7044,
		sourceExternalId: "cron:studio:insight-weekly-signup-conversion",
		key: "product.studio_weekly_signup_subscription_conversion",
		name: "Weekly Studio signup to subscription conversion",
		description:
			"Mature UTC-week signup populations and subscription conversion under the approved ordered six-week native PostHog funnel.",
		grain: FactGrain.WEEK,
		eventTimeField: "period_start",
		businessDefinition: {
			entity: "studio_signup_week",
			periodAssignment: "explicit complete UTC week",
			denominator: "native PostHog user_signed_up funnel count",
			numerator:
				"the denominator population reaching subscription_created within six weeks",
			ordering: "ordered",
			maturity:
				"publish only after the complete signup period plus its six-week conversion window",
			population:
				"PostHog test-account filter; native insight output does not expose identity rows",
		},
		computation: {
			aggregate: "native_ordered_funnel_conversion",
			outputs: ["signups", "subscriptions", "conversion_pct"],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: STUDIO_INSIGHT_CHECKS,
		ownerTeam: "Productions",
		createdBy: "atlas-studio-insight-registry",
		cadenceMinutes: 8 * 60,
		source: {
			key: "posthog:product-events",
			kind: DataSourceKind.POSTHOG,
			label: "PostHog native Studio funnel",
		},
	},
	{
		questionNumber: 7045,
		sourceExternalId: "cron:studio:insight-monthly-signup-conversion",
		key: "product.studio_monthly_signup_subscription_conversion",
		name: "Monthly Studio signup to subscription conversion",
		description:
			"Mature UTC-month signup populations and subscription conversion under the approved ordered six-week native PostHog funnel.",
		grain: FactGrain.MONTH,
		eventTimeField: "period_start",
		businessDefinition: {
			entity: "studio_signup_month",
			periodAssignment: "explicit complete UTC calendar month",
			denominator: "native PostHog user_signed_up funnel count",
			numerator:
				"the denominator population reaching subscription_created within six weeks",
			ordering: "ordered",
			maturity:
				"publish only after the complete signup period plus its six-week conversion window",
			population:
				"PostHog test-account filter; native insight output does not expose identity rows",
		},
		computation: {
			aggregate: "native_ordered_funnel_conversion",
			outputs: ["signups", "subscriptions", "conversion_pct"],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: STUDIO_INSIGHT_CHECKS,
		ownerTeam: "Productions",
		createdBy: "atlas-studio-insight-registry",
		cadenceMinutes: 8 * 60,
		source: {
			key: "posthog:product-events",
			kind: DataSourceKind.POSTHOG,
			label: "PostHog native Studio funnel",
		},
	},
	{
		questionNumber: 7046,
		sourceExternalId: "cron:studio:insight-week-two-retention",
		key: "product.studio_week_two_generation_retention",
		name: "Studio week-two generation retention",
		description:
			"Mature weekly generation cohorts and recurring week-two generation retention under the approved native PostHog retention query.",
		grain: FactGrain.WEEK,
		eventTimeField: "cohort_week",
		businessDefinition: {
			entity: "studio_generation_cohort_week",
			periodAssignment:
				"PostHog weekly cohort label normalized to its Monday date inside an explicit UTC read window",
			denominator:
				"users with playground_completed_generation in the cohort week, excluding plugin_premiere",
			numerator:
				"the denominator population with recurring playground_completed_generation in week two",
			maturity: "publish only after a complete three-week observation window",
			population:
				"PostHog test-account filter; native insight output does not expose identity rows",
		},
		computation: {
			aggregate: "native_recurring_week_two_retention",
			outputs: ["cohort_users", "week_two_users", "week_two_retention_pct"],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: STUDIO_INSIGHT_CHECKS,
		ownerTeam: "Productions",
		createdBy: "atlas-studio-insight-registry",
		cadenceMinutes: 8 * 60,
		source: {
			key: "posthog:product-events",
			kind: DataSourceKind.POSTHOG,
			label: "PostHog native Studio retention",
		},
	},
];

const ACTIVE_PILOT_CHECKS = [
	{
		name: "active_registry_parity",
		reason: "The active pilot count must reconcile to the account list.",
	},
	{
		name: "deal_stage_mapping",
		reason:
			"The query must use the approved Enterprise and Studio pilot pipelines.",
	},
	{
		name: "owner_coverage",
		reason: "Every active pilot must have an assigned CRM owner.",
	},
	{
		name: "oldest_complete_watermark",
		reason: "The report must expose the complete HubSpot source watermark.",
	},
];

const ACTIVE_PILOT_ADOPTION_CHECKS = [
	{
		name: "active_registry_parity",
		reason:
			"Every approved active HubSpot pilot must appear exactly once in the result.",
	},
	{
		name: "deal_stage_mapping",
		reason:
			"The question must use the approved Enterprise and Studio pilot pipelines.",
	},
	{
		name: "account_identity_join",
		reason:
			"Workspace identity must use exact company-domain evidence and must keep unmatched pilots visible.",
	},
	{
		name: "usage_population_exclusions",
		reason:
			"Pilot adoption must exclude internal, banned, disabled, and anonymous users, and all counts must reconcile.",
	},
	{
		name: "sensitive_detail_boundary",
		reason:
			"The governed result must exclude domains, emails, and user, organization, or workspace identifiers.",
	},
	{
		name: "oldest_complete_watermark",
		reason:
			"Every row must use the HubSpot source watermark, which is older than the live product query.",
	},
];

const STUDIO_BOOKING_CHECKS = [
	{
		name: "deal_stage_mapping",
		reason: "The question must use only the Sync Studios pipeline.",
	},
	{
		name: "crm_booking_parity",
		reason:
			"Every Studio booking row must retain its CRM account, stage, owner, and non-negative closed-won amount.",
	},
	{
		name: "operational_boundary",
		reason:
			"The CRM metric must not invent contract execution or delivery state.",
	},
	{
		name: "oldest_complete_watermark",
		reason: "Every row must expose one current HubSpot source watermark.",
	},
];

const ENTERPRISE_BOOKING_CHECKS = [
	{
		name: "deal_stage_mapping",
		reason: "The question must use only the Sync Enterprise pipeline.",
	},
	{
		name: "crm_booking_parity",
		reason:
			"Every period must expose non-negative CRM pipeline, booked value, and unmapped-deal counts.",
	},
	{
		name: "contract_classification_boundary",
		reason:
			"The CRM metric must not classify signed contracts, net-new logos, or renewals without verified contract evidence.",
	},
	{
		name: "oldest_complete_watermark",
		reason: "Every row must expose one current HubSpot source watermark.",
	},
];

const HUBSPOT_REPORT_SPECS: ProductMetricSpec[] = [
	{
		questionNumber: 7001,
		sourceExternalId: "cron:active-pilots:adoption",
		key: "sales.active_pilot_product_adoption",
		name: "Active pilot registry and product adoption",
		description:
			"Current active Enterprise and Studio pilots joined to product workspaces by exact company-domain evidence, with unmatched pilots retained as not verified.",
		grain: FactGrain.DAY,
		source: {
			key: "hubspot:crm",
			kind: DataSourceKind.HUBSPOT,
			label: "HubSpot CRM joined to Product Postgres",
		},
		eventTimeField: "data_through",
		businessDefinition: {
			entity: "active_hubspot_pilot",
			active:
				"current deal stage is the approved Enterprise Pilot or Studio Pilot/POC stage",
			workspaceIdentity:
				"at least one eligible product member has an email domain that exactly equals the normalized HubSpot company domain",
			unmatchedPolicy:
				"retain the pilot with workspace_mapping=not_verified and zero product metrics",
			activity:
				"eligible workspace users and non-deleted generations, with current 24-hour and all-time counts",
			population:
				"exclude internal, banned, disabled, and anonymous users from identity proof and usage",
			privacyPolicy:
				"publish account and internal CRM owner labels, but no domain, email, user, organization, or workspace identifiers",
		},
		computation: {
			aggregate: "active_pilot_registry_joined_to_exact_domain_workspaces",
			outputs: [
				"pilot_status",
				"pilot_start",
				"workspace_mapping",
				"matched_workspaces",
				"users",
				"active_users_24h",
				"pending_invites",
				"generations_24h",
				"generations_to_date",
				"completed_generations",
				"failed_generations",
				"output_hours",
				"model_usage",
				"surface_usage",
				"latest_activity_at",
			],
		},
		requiresCrossSourceEligibility: true,
		pendingChecks: ACTIVE_PILOT_ADOPTION_CHECKS,
		ownerTeam: "Sales",
		createdBy: "atlas-sales-pilot-adoption-registry",
		cadenceMinutes: 6 * 60,
	},
	{
		questionNumber: 7006,
		sourceExternalId: "cron:sales:weekly-active-pilots",
		key: "sales.weekly_active_pilots",
		name: "Weekly active pilot count",
		description:
			"Current active pilots and current-week entries and exits from the approved Enterprise and Studio HubSpot pilot stages.",
		grain: FactGrain.WEEK,
		source: {
			key: "hubspot:crm",
			kind: DataSourceKind.HUBSPOT,
			label: "HubSpot CRM",
		},
		eventTimeField: "week_start",
		businessDefinition: {
			entity: "hubspot_deal",
			periodAssignment: "Monday through Sunday UTC",
			active:
				"current deal stage is Pilot in Sync Enterprise or Pilot/POC in Sync Studios",
			newPilot:
				"deal entered an approved pilot stage during the current half-open UTC week",
			exitedPilot:
				"deal left an approved pilot stage during the current half-open UTC week",
			accountLabel:
				"linked HubSpot company name, with deal name retained when the association is absent",
		},
		computation: {
			aggregate: "current_registry_and_stage_transitions",
			outputs: [
				"active_pilots",
				"new_pilots",
				"exited_pilots",
				"pilot_accounts",
				"owners",
			],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: ACTIVE_PILOT_CHECKS,
		ownerTeam: "Sales",
		createdBy: "atlas-sales-registry",
		cadenceMinutes: 6 * 60,
	},
	{
		questionNumber: 7015,
		sourceExternalId: "cron:studio:bookings-pipeline",
		key: "sales.studio_crm_bookings",
		name: "Studio CRM booked revenue",
		description:
			"Studio closed-won value by CRM close month, account, stage, and owner. Contract execution and delivery state remain unavailable until governed sources exist.",
		grain: FactGrain.MONTH,
		source: {
			key: "hubspot:crm",
			kind: DataSourceKind.HUBSPOT,
			label: "HubSpot CRM",
		},
		eventTimeField: "period_start",
		businessDefinition: {
			entity: "studio_closed_won_deal",
			periodAssignment: "HubSpot close date in UTC calendar month",
			bookedValue: "HubSpot amount on a closed-won Sync Studios deal",
			contractStatus: "unavailable",
			deliveryStatus: "unavailable",
			separation:
				"CRM booked value is not product revenue, cash, signed-contract value, or delivery value",
		},
		computation: {
			aggregate: "crm_closed_won_detail",
			outputs: ["account", "stage", "closed_won_value", "owner"],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: STUDIO_BOOKING_CHECKS,
		ownerTeam: "Productions",
		createdBy: "atlas-sales-registry",
		cadenceMinutes: 6 * 60,
	},
	{
		questionNumber: 7016,
		sourceExternalId: "cron:enterprise:bookings-pipeline",
		key: "sales.enterprise_crm_pipeline_and_bookings",
		name: "Enterprise CRM pipeline and bookings",
		description:
			"Enterprise pipeline created and closed-won booked value by UTC month. Signed-contract, net-new-logo, and renewal classifications remain unavailable until verified contract evidence exists.",
		grain: FactGrain.MONTH,
		source: {
			key: "hubspot:crm",
			kind: DataSourceKind.HUBSPOT,
			label: "HubSpot CRM",
		},
		eventTimeField: "period_start",
		businessDefinition: {
			entity: "enterprise_deal_month",
			periodAssignment:
				"pipeline by HubSpot create date and bookings by HubSpot close date in UTC calendar month",
			pipelineCreated: "sum of deal amounts created in the month",
			bookedValue: "sum of closed-won deal amounts closed in the month",
			signedContracts: "unavailable",
			netNewLogos: "unavailable",
			renewals: "unavailable",
			separation:
				"CRM booked value is not product usage revenue, invoices, cash, or signed-contract value",
		},
		computation: {
			aggregate: "crm_monthly_pipeline_and_bookings",
			outputs: ["pipeline_created", "booked_value", "unmapped_deals"],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: ENTERPRISE_BOOKING_CHECKS,
		ownerTeam: "Sales",
		createdBy: "atlas-sales-registry",
		cadenceMinutes: 6 * 60,
	},
];

export const PRODUCT_METRIC_SPECS: ProductMetricSpec[] = [
	{
		questionNumber: 15,
		sourceExternalId: "8164",
		key: "product.monthly_professional_organizations",
		name: "Monthly professional organizations",
		description:
			"V2 self-serve organizations with $100+ accrued value, 3+ completed generations created on a non-free plan, and generation activity on 2+ distinct UTC days in the month.",
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
			periodAssignment: "generationCreatedAt in UTC",
			professional: {
				minimumAccruedValueUsd: 100,
				minimumCompletedBillableGenerations: 3,
				minimumActiveDays: 2,
				completedStatus: "COMPLETED",
				billableDefinition:
					"generation started while its organization was on a non-free plan",
				sourcePlanSnapshot:
					"Product Generations.organizationPlan is captured when the generation starts; V2 TinyBird organizationPlanType is derived from that admission snapshot",
				activeDayDefinition:
					"a distinct UTC date with a completed generation created on a non-free plan",
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
			"V2 self-serve organizations with 3+ completed generations created on a non-free plan across 2+ distinct UTC days in the month, before applying the $100 accrued-value gate.",
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
			periodAssignment: "generationCreatedAt in UTC",
			minimumCompletedGenerations: 3,
			minimumActiveDays: 2,
			completedStatus: "COMPLETED",
			billableDefinition:
				"generation started while its organization was on a non-free plan",
			sourcePlanSnapshot:
				"Product Generations.organizationPlan is captured when the generation starts; V2 TinyBird organizationPlanType is derived from that admission snapshot",
			activeDayDefinition:
				"a distinct UTC date with a completed generation created on a non-free plan",
		},
		computation: { aggregate: "count_organizations", output: "value" },
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 119,
		sourceExternalId: "8168",
		key: "product.professional_and_activated_organization_trend",
		name: "Professional and activated organization trend",
		description:
			"Monthly V2 self-serve professional organizations and activated organizations shown together. Professional organizations also meet the $100+ accrued-value threshold.",
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
			periodAssignment: "generationCreatedAt in UTC",
			activated:
				"3+ completed generations created on a non-free plan across 2+ distinct UTC days",
			professional:
				"the activated definition plus $100+ accrued value in the same UTC month",
		},
		computation: {
			aggregate: "count_organizations",
			outputs: ["professional_orgs", "activated_org_pool"],
		},
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
			periodAssignment: "generationCreatedAt in UTC",
			completedStatus: "COMPLETED",
			billableDefinition:
				"generation started while its organization was on a non-free plan",
			sourcePlanSnapshot:
				"Product Generations.organizationPlan is captured when the generation starts; V2 TinyBird organizationPlanType is derived from that admission snapshot",
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
			periodAssignment: "generationCreatedAt in UTC",
			professionalDefinition:
				"$100+ accrued value, 3+ COMPLETED generations created on a non-free plan, and activity on 2+ distinct UTC days",
		},
		computation: { aggregate: "cohort_share", output: "value" },
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 120,
		sourceExternalId: "8174",
		key: "product.m3_requalification_and_accrued_ndr_trend",
		name: "Month 3 requalification and accrued net dollar retention trend",
		description:
			"For each starting V2 self-serve professional cohort, shows the share that qualifies again two calendar months later and the accrued value retained by that same cohort.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "generationCreatedAt",
		businessDefinition: {
			entity: "starting_professional_organization_cohort",
			population: "v2_self_serve",
			periodAssignment: "generationCreatedAt in UTC",
			requalificationMonthOffset: 2,
			requalification:
				"share of the starting professional cohort that meets the full professional definition again two calendar months later",
			accruedNetDollarRetention:
				"accrued value from the same cohort two calendar months later divided by its starting-month accrued value",
		},
		computation: {
			aggregate: "cohort_retention",
			outputs: ["m3_requalification_pct", "m3_accrued_ndr_pct"],
		},
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
			periodAssignment: "generationCreatedAt in UTC",
			professionalDefinition:
				"$100+ accrued value, 3+ COMPLETED generations created on a non-free plan, and activity on 2+ distinct UTC days",
			cashBasis: false,
		},
		computation: { aggregate: "sum", output: "accrued_value_usd" },
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 242,
		sourceExternalId: "cron:product:activated-not-professional",
		key: "product.activated_not_professional_diagnostics",
		name: "Activated organizations not yet professional",
		description:
			"Latest and previous complete-month V2 self-serve organizations that meet the activation rule but remain below the professional accrued-value threshold, with governed plan, generation, output-hour, and model breakdowns.",
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
			periodAssignment: "generationCreatedAt in UTC",
			activated:
				"3+ completed generations created on a non-free plan across 2+ distinct UTC days",
			professional:
				"the activated definition plus $100+ accrued value in the same UTC month",
			gap: "activated organizations that do not meet the professional definition",
			planAttribution: "latest generation plan snapshot in the UTC month",
			modelAttribution:
				"distinct gap organizations per model; model rows are multi-select and do not sum to the gap total",
			outputHours:
				"sum of generationRecord.outputMediaLength seconds divided by 3600",
		},
		computation: {
			aggregate: "organization_month_diagnostic",
			outputs: [
				"activated_organizations",
				"professional_organizations",
				"gap_organizations",
				"plan",
				"generation_bucket",
				"output_hour_bucket",
				"model",
			],
		},
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "canonical_population",
				reason:
					"Confirm the V2 self-serve plan population and identifier-free output boundary.",
			},
			{
				name: "activation_definition",
				reason:
					"Confirm the three-generation and two-active-day activation rule and summary reconciliation.",
			},
			{
				name: "professional_definition",
				reason:
					"Confirm the activation rule plus $100 accrued-value professional threshold.",
			},
			{
				name: "breakdown_reconciliation",
				reason:
					"Confirm that plan, generation, and output-hour buckets reconcile independently to the gap population.",
			},
			{
				name: "complete_month_boundary",
				reason:
					"Confirm exactly two complete UTC months under one half-open watermark.",
			},
		],
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
			periodAssignment: "generationCreatedAt in UTC",
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
			completedStatus: "COMPLETED",
			periodAssignment: "generation created_at in UTC",
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
			"Accrued professional organization-months that also meet the approved paid-value threshold for their billing version in the same month.",
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
			periodAssignment: "generationCreatedAt in UTC",
			completedStatus: "COMPLETED",
			billableDefinition:
				"generation started while its organization was on a non-free plan",
			sourcePlanSnapshot:
				"Product Generations.organizationPlan is captured when the generation starts; V2 TinyBird organizationPlanType is derived from that admission snapshot",
			paidValueByBillingVersion: {
				V2: ["subscription_invoices", "usage_invoices"],
				V3: ["subscription_invoices", "successful_top_up_payments"],
			},
		},
		computation: {
			aggregate: "ratio_percentage",
			output: "paid_qualified_pct",
		},
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 160,
		sourceExternalId: "atlas:product:qualified-then-deleted",
		key: "product.professional_organizations_with_deleted_user",
		name: "Professional organizations with a user deleted after qualifying",
		description:
			"Professional organizations that met the full monthly threshold before a contributing user chose to delete their account.",
		grain: FactGrain.MONTH,
		source: {
			key: "atlas:product-eligibility",
			kind: DataSourceKind.ATLAS,
			label: "Atlas product eligibility",
		},
		eventTimeField: "period_start",
		businessDefinition: {
			entity: "professional_organization_month",
			population: "v2_self_serve",
			periodAssignment: "generationCreatedAt in UTC",
			deletionEvent: "user-initiated account deletion",
			historicalTreatment:
				"keep the organization in the historical professional count and report the later deletion separately",
		},
		computation: {
			aggregate: "count_organizations",
			output: "organizations_with_qualified_then_deleted_user",
		},
		requiresCrossSourceEligibility: false,
		ownerTeam: "Atlas",
		createdBy: "atlas-operator-definition",
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
				name: "approved_feedback_instrument_rule",
				reason:
					"Confirm whether positive means thumbs-up, 4-5 stars, or both, and whether one generation with more than one rating counts once or more than once.",
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
				name: "approved_feedback_coverage_denominator",
				reason:
					"Confirm whether the official coverage denominator is first generations, all clean COMPLETED generations, or all clean terminal generations.",
			},
		],
	},
	{
		questionNumber: 7004,
		sourceExternalId: "cron:lipsync:product-funnel",
		key: "marketing.lipsync_attributed_product_conversion",
		name: "Lipsync-attributed product conversion",
		description:
			"Mature weekly signup cohorts whose first recorded referring domain is lipsync.com, with seven-day project, successful-generation, and paid-subscription conversion.",
		grain: FactGrain.WEEK,
		source: {
			key: "posthog:product-events",
			kind: DataSourceKind.POSTHOG,
			label: "PostHog product events",
		},
		eventTimeField: "cohort_week",
		businessDefinition: {
			entity: "lipsync_attributed_signup_cohort",
			population:
				"clean-user signups whose first recorded referring domain is lipsync.com or www.lipsync.com",
			periodAssignment: "signup timestamp in UTC Monday weeks",
			periodCompleteness:
				"the current signup week is excluded so every published cohort has a complete seven-day observation window",
			projectConversion:
				"the person's first project starts on or after signup and before seven days after signup",
			successfulGenerationConversion:
				"the person's first successful generation occurs on or after the qualifying project and before seven days after signup",
			paidConversion:
				"the person's first paid subscription starts on or after signup and before seven days after signup; this is a separate subset of signups and is not forced to follow generation",
			trafficBoundary:
				"GA4 sessions and Search Console demand remain separate governed questions because those sources do not share a stable person identifier with PostHog",
		},
		computation: {
			aggregate: "unique_person_weekly_cohort_funnel",
			outputs: [
				"signups",
				"projects_started",
				"successful_generations",
				"paid_subscriptions",
				"signup_to_project_pct",
				"signup_to_generation_pct",
				"signup_to_paid_pct",
			],
		},
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "lipsync_signup_cohort_population",
				reason:
					"Every published cohort must contain clean-user signups attributed through the approved first-referrer domain registry.",
			},
			{
				name: "funnel_ordering",
				reason:
					"Project and generation stages must remain nested, paid conversion must remain a subset of signups, and rates must reconcile to counts.",
			},
			{
				name: "referral_definition",
				reason:
					"Attribution must use the person's first recorded referring domain, not an event-level referrer.",
			},
			{
				name: "seven_day_cohort_maturity",
				reason:
					"Every cohort must have a complete seven-day product-conversion window.",
			},
			{
				name: "sensitive_detail_boundary",
				reason:
					"The published result must exclude person, user, organization, and email identifiers.",
			},
			{
				name: "oldest_complete_watermark",
				reason:
					"All rows must use one UTC data-through boundary for the oldest complete cohort window.",
			},
		],
		ownerTeam: "Marketing",
		createdBy: "atlas-lipsync-funnel-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 7017,
		sourceExternalId: "cron:geo:weekly-conversion",
		key: "marketing.geo_attributed_product_conversion",
		name: "GEO-attributed product conversion",
		description:
			"Two mature weekly signup cohorts attributed through the approved AI-provider registry, with seven-day successful-generation and paid-subscription conversion.",
		grain: FactGrain.WEEK,
		source: {
			key: "posthog:product-events",
			kind: DataSourceKind.POSTHOG,
			label: "PostHog product events",
		},
		eventTimeField: "cohort_week",
		businessDefinition: {
			entity: "geo_attributed_signup_cohort",
			population:
				"clean-user signups whose first recorded referring domain matches the approved ChatGPT, Gemini, Claude, Perplexity, Copilot, Meta AI, Kagi, or Qwen registry",
			periodAssignment: "signup timestamp in UTC Monday weeks",
			periodCompleteness:
				"the current and immediately prior signup weeks are excluded so every published cohort has a complete seven-day observation window",
			successfulGenerationConversion:
				"the person's first successful generation occurs on or after signup and before seven days after signup",
			paidConversion:
				"the person's first paid subscription starts on or after signup and before seven days after signup",
			trafficBoundary:
				"Q25 remains the governed GA4 traffic source because GA4 and PostHog do not share a stable person identifier",
		},
		computation: {
			aggregate: "unique_person_weekly_cohort_funnel_by_ai_provider",
			outputs: [
				"signups",
				"first_successful_generations",
				"paid_subscriptions",
				"signup_to_generation_pct",
				"signup_to_paid_pct",
			],
		},
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "cohort_population",
				reason:
					"The result must contain two complete UTC signup cohorts with at least one attributed signup in every published provider row.",
			},
			{
				name: "cohort_reconciliation",
				reason:
					"Generation and paid stages must remain subsets of signups, and every rate must reconcile to its counts.",
			},
			{
				name: "ai_referrer_registry",
				reason:
					"Attribution must use the person's first recorded referring domain and the approved AI-provider registry.",
			},
			{
				name: "seven_day_cohort_maturity",
				reason:
					"Every signup cohort must have a complete seven-day product-conversion window.",
			},
			{
				name: "sensitive_detail_boundary",
				reason:
					"The published result must exclude person, user, organization, and email identifiers.",
			},
			{
				name: "oldest_complete_watermark",
				reason:
					"All rows must use one UTC data-through boundary for the oldest complete cohort window.",
			},
		],
		ownerTeam: "Marketing",
		createdBy: "atlas-geo-conversion-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 7003,
		sourceExternalId: "cron:adobe-plugin:weekly-kpis",
		key: "product.adobe_plugin_weekly_kpis",
		name: "Adobe plugin adoption, retention, and NPS",
		description:
			"Complete UTC-week Adobe Premiere plugin installs, activation, mature recurring retention, post-generation actions, and de-identified NPS aggregates.",
		grain: FactGrain.WEEK,
		source: {
			key: "atlas:adobe-plugin-composite",
			kind: DataSourceKind.ATLAS,
			label: "PostHog plugin events and product NPS survey",
		},
		eventTimeField: "period_start",
		businessDefinition: {
			entity: "adobe_plugin_weekly_report",
			population:
				"PostHog test-account-filtered plugin events and Adobe Plugin NPS version 1 submissions created before the data-through boundary",
			periodAssignment: "complete Monday-Sunday UTC weeks",
			installs: "unique plugin_installed users",
			activation:
				"ordered install, sign-in, generation, and download funnel for the latest complete week",
			twoDayActivation:
				"users with a second plugin generation within two days from a fully mature 30-day cohort window",
			retention:
				"recurring weekly plugin generation cohorts, with W1-W3 published only after the full return-week window",
			powerRetention:
				"recurring weekly cohorts with at least 10 plugin generations in the cohort week",
			postGeneration:
				"preview, download, and insert events divided by completed plugin generations; action rates can exceed 100 percent",
			nps: "version 1 submitted scores with comments excluded from the governed result",
		},
		computation: {
			aggregate: "composite_weekly_plugin_report",
			outputs: [
				"unique_installs",
				"activation_funnel",
				"two_day_activation_pct",
				"weekly_retention_pct",
				"power_retention_pct",
				"post_generation_action_pct",
				"nps_score",
				"nps_response_rate_pct",
			],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: [
			{
				name: "event_definition_review",
				reason:
					"The report must use the approved Adobe plugin event, funnel, retention, and survey definitions.",
			},
			{
				name: "report_population",
				reason:
					"Every required report section must be present with a valid non-negative population.",
			},
			{
				name: "metric_reconciliation",
				reason: "Every rate must reconcile to its numerator and denominator.",
			},
			{
				name: "cohort_maturity",
				reason:
					"Retention and two-day activation cohorts must have their complete observation windows.",
			},
			{
				name: "nps_response_parity",
				reason:
					"NPS categories and score distribution must reconcile to scored responses.",
			},
			{
				name: "sensitive_detail_boundary",
				reason:
					"The governed result must exclude survey comments and person-level identifiers.",
			},
			{
				name: "oldest_complete_watermark",
				reason:
					"Every row must use the same complete UTC data-through boundary.",
			},
		],
		ownerTeam: "Product",
		createdBy: "atlas-adobe-plugin-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 7005,
		sourceExternalId: "cron:product-pages:weekly-funnel",
		key: "marketing.product_pages_weekly_funnel",
		name: "Product-page acquisition and paid conversion",
		description:
			"Complete UTC-week traffic and first-touch signup-to-paid conversion for the approved Sync product-page registry.",
		grain: FactGrain.WEEK,
		source: {
			key: "atlas:product-pages-composite",
			kind: DataSourceKind.ATLAS,
			label: "GA4 product pages, product signups, and paid subscriptions",
		},
		eventTimeField: "period_start",
		businessDefinition: {
			entity: "product_page_week",
			population:
				"approved /product page registry, clean product signups, and positive paid subscription invoices",
			periodAssignment: "complete Monday-Sunday UTC week",
			traffic:
				"GA4 Blog property exact page-path aggregate across canonical and trailing-slash paths",
			firstTouch:
				"the earliest recognized product-page claim per organization in the reporting week",
			signups:
				"all clean user signups with a recognized product-page attribution slug",
			paidOrganizations:
				"first-touch organizations with at least one subscription whose first positive paid invoice occurs at or after the attributed signup and before the week ends",
			paidConversion:
				"paid organizations divided by first-touch attributed organizations; this is not sessions-to-paid conversion",
			attributionCoverage:
				"recognized product-page signup claims divided by all product-page signup claims",
		},
		computation: {
			aggregate: "weekly_page_traffic_and_first_touch_paid_conversion",
			outputs: [
				"users",
				"sessions",
				"engagement_rate_pct",
				"signups",
				"attributed_organizations",
				"paid_organizations",
				"subscriptions",
				"paid_conversion_pct",
				"attribution_coverage_pct",
			],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: [
			{
				name: "page_registry_review",
				reason:
					"The report must contain every approved product page exactly once.",
			},
			{
				name: "page_population",
				reason:
					"Every registered page must contain valid non-negative traffic and conversion values.",
			},
			{
				name: "first_touch_coverage",
				reason:
					"Recognized product-page claims must reconcile to all product-page claims and clean signups.",
			},
			{
				name: "subscription_parity",
				reason:
					"Paid organizations, subscriptions, and paid conversion rates must reconcile.",
			},
			{
				name: "first_touch_identity",
				reason:
					"Each organization must be assigned to at most one first-touch product page.",
			},
			{
				name: "sensitive_detail_boundary",
				reason:
					"The governed result must exclude person and organization identifiers.",
			},
			{
				name: "oldest_complete_watermark",
				reason:
					"Every row must use the same complete UTC data-through boundary.",
			},
		],
		ownerTeam: "Marketing",
		createdBy: "atlas-product-pages-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 7008,
		sourceExternalId: "cron:api-endpoints:adoption-revenue",
		key: "product.api_endpoint_weekly_adoption",
		name: "Public API adoption and accrued usage",
		description:
			"Two complete UTC weeks of public API TTS, API asset uploads, and generations from API-uploaded assets with resolved organizations and accrued usage value.",
		grain: FactGrain.WEEK,
		source: {
			key: "atlas:api-adoption-composite",
			kind: DataSourceKind.ATLAS,
			label: "Product API keys, assets, generations, and TinyBird usage",
		},
		eventTimeField: "week_start",
		businessDefinition: {
			entity: "api_endpoint_week",
			population:
				"external non-anonymous API-key owners and direct product users, excluding internal users and banned users who never subscribed",
			periodAssignment:
				"TTS and asset uploads use their creation time; asset-backed generation adoption and accrued value use final completion time in complete Monday-Sunday UTC weeks",
			publicApiTts: "sync_usage_integration_tts rows with a non-empty apiKeyId",
			apiAssetUpload:
				"non-deleted product assets created with a non-empty api_key_id",
			apiAssetGeneration:
				"final product generations joined to an API-uploaded asset or marked usedApiUploadedAsset, with TinyBird generation usage providing accrued value",
			revenueBasis:
				"usageCostMillicents or generationCostMillicents divided by 100000; this is accrued usage value, not Stripe cash, invoices, or subscription value",
		},
		computation: {
			aggregate: "weekly_api_surface_adoption_and_accrued_usage",
			outputs: [
				"requests",
				"successful_jobs",
				"failed_jobs",
				"active_organizations",
				"active_api_keys",
				"usage_amount",
				"accrued_usage_usd",
			],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: [
			{
				name: "endpoint_registry_review",
				reason:
					"Both weeks must contain each approved public API adoption surface exactly once.",
			},
			{
				name: "api_key_owner_join",
				reason:
					"Every activity row must resolve to one API-key owner or direct user without conflicts.",
			},
			{
				name: "clean_organization_population",
				reason:
					"Internal, anonymous, and banned-never-subscribed principals must be excluded before aggregation.",
			},
			{
				name: "usage_revenue_basis",
				reason:
					"Accrued usage value must stay separate from Stripe cash, invoices, and subscription value.",
			},
			{
				name: "source_count_reconciliation",
				reason:
					"Requests must reconcile to successful and failed jobs with non-negative values.",
			},
			{
				name: "sensitive_detail_boundary",
				reason:
					"The governed result must exclude user, API-key, organization, and email identifiers.",
			},
			{
				name: "oldest_complete_watermark",
				reason:
					"Both complete weeks must share one explicit UTC data-through boundary.",
			},
		],
		ownerTeam: "Product",
		createdBy: "atlas-api-adoption-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 7009,
		sourceExternalId: "cron:api-endpoints:reliability",
		key: "product.api_endpoint_weekly_reliability",
		name: "Public API endpoint reliability",
		description:
			"Two complete UTC weeks of production API requests, latency, and classified 4xx and 5xx errors for the approved public API endpoint registry.",
		grain: FactGrain.WEEK,
		source: {
			key: "atlas:betterstack-api-reliability",
			kind: DataSourceKind.ATLAS,
			label: "BetterStack [Prod] Sync API V2 response logs",
		},
		eventTimeField: "week_start",
		businessDefinition: {
			entity: "api_endpoint_traffic_scope_week",
			population:
				"finished production requests for the approved public API endpoint registry, excluding health checks, active-job SSE, and recognized bot user agents",
			periodAssignment: "request log dt in complete Monday-Sunday UTC weeks",
			trafficScopes:
				"all eligible request traffic and the subset with a non-empty API key identifier",
			errorDefinition:
				"4xx client, documentation, or authentication errors remain separate from 5xx application errors",
			latencyDefinition:
				"p50 and p95 durationMs across finished requests with a positive recorded duration",
			failureBuckets:
				"CRAFT-4763 asset patch, project-not-found, asset auth or abuse, TTS or voice, invalid asset generation, and CORS server-error classes",
		},
		computation: {
			aggregate: "weekly_api_endpoint_reliability_by_traffic_scope",
			outputs: [
				"requests",
				"errors",
				"client_errors",
				"server_errors",
				"error_rate_pct",
				"p50_latency_ms",
				"p95_latency_ms",
				"top_error_class",
			],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: [
			{
				name: "betterstack_adapter",
				reason:
					"The reader must resolve the exact production Sync API V2 source and use its read-only EU S3 log table.",
			},
			{
				name: "endpoint_registry_review",
				reason:
					"Both weeks must contain every approved endpoint group for all traffic and API-key traffic.",
			},
			{
				name: "bot_and_healthcheck_exclusion",
				reason:
					"Health checks, active-job SSE, and recognized bot user agents must be excluded.",
			},
			{
				name: "error_taxonomy_review",
				reason:
					"Errors must reconcile to separate 4xx, 5xx, and CRAFT-4763 classes.",
			},
			{
				name: "latency_population_review",
				reason:
					"Latency percentiles must use finished requests with positive duration and remain ordered.",
			},
			{
				name: "oldest_complete_watermark",
				reason:
					"The log source must cover both complete weeks through one UTC data-through boundary.",
			},
		],
		ownerTeam: "Engineering",
		createdBy: "atlas-api-reliability-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 7014,
		sourceExternalId: "cron:model-feedback:weekly-coverage",
		key: "product.model_feedback_weekly_coverage",
		name: "Model feedback and support quality coverage",
		description:
			"One complete UTC week of product feedback coverage by model plus deidentified support-negative theme counts from gBrain.",
		grain: FactGrain.WEEK,
		source: {
			key: "atlas:model-feedback-composite",
			kind: DataSourceKind.ATLAS,
			label: "Product feedback and deidentified gBrain evidence",
		},
		eventTimeField: "week_start",
		businessDefinition: {
			entity: "model_feedback_surface_week",
			population:
				"completed generations from external non-anonymous, non-disabled, non-banned users, with internal sync.so and sync.labs users excluded",
			periodAssignment:
				"generation finished_at in the previous complete Monday-Sunday UTC week",
			productFeedback:
				"thumb up and down events plus star scores, where four or five stars are positive and lower scores are negative",
			coverage:
				"distinct completed generations with at least one approved feedback event divided by completed generations",
			supportEvidence:
				"deduplicated customer-originated Pylon and support Slack items classified on Rudy into approved model and theme count aggregates",
			separationPolicy:
				"support-negative counts remain separate from the product feedback denominator and never change the product negative rate",
			privacyPolicy:
				"Atlas receives only week, model, approved support theme, and count aggregates; no customer text, URLs, slugs, ticket IDs, or identities",
		},
		computation: {
			aggregate: "weekly_product_feedback_and_support_theme_counts",
			outputs: [
				"completed_generations",
				"rated_generations",
				"feedback_events",
				"positive_feedback",
				"negative_feedback",
				"negative_rate_pct",
				"coverage_pct",
				"support_negative_tickets",
			],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: [
			{
				name: "feedback_denominator_parity",
				reason:
					"Positive and negative events must reconcile, and rated generations must remain a subset of completed generations.",
			},
			{
				name: "model_mapping",
				reason: "The result must contain the exact approved model registry.",
			},
			{
				name: "support_evidence_join",
				reason:
					"Support evidence must come from one exact-week aggregate with unique model and theme keys.",
			},
			{
				name: "customer_text_boundary",
				reason:
					"The result must exclude customer text, identities, URLs, slugs, and ticket identifiers.",
			},
			{
				name: "oldest_complete_watermark",
				reason:
					"Product feedback and gBrain evidence must share one complete UTC week.",
			},
		],
		ownerTeam: "Product",
		createdBy: "atlas-model-feedback-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 7002,
		sourceExternalId: "cron:studio:period-kpis",
		key: "product.studio_weekly_delivery_logo_movement",
		name: "Weekly Studio delivery and logo movement",
		description:
			"Complete UTC weeks of Studio generated hours, subscription-created events, and organization-deduplicated new, expanded, churned, and net logo movement.",
		grain: FactGrain.WEEK,
		source: {
			key: "posthog:product-events",
			kind: DataSourceKind.POSTHOG,
			label: "PostHog Studio product and subscription events",
		},
		eventTimeField: "period_start",
		businessDefinition: {
			entity: "studio_product_week",
			population: "clean product users under the shared Atlas policy",
			periodAssignment: "event timestamp in complete Monday-Sunday UTC weeks",
			generatedHours:
				"successful generation output_duration_secs divided by 3600, excluding source=plugin_premiere",
			newSubscriptions:
				"unique subscription_created source-event UUIDs; this is not a logo count",
			logoIdentity:
				"non-empty properties.organization_id, counted at most once per movement type and period",
			expansionRule:
				"subscription_updated moves from old_plan to a higher plan in hobbyist, creator, growth, scale order",
			netLogoGrowth: "new_logos + expanded_logos - churned_logos",
			separateQuestions:
				"activation speed, signup conversion, retention, and booked delivery commitments are not inferred by this question",
		},
		computation: {
			aggregate: "weekly_delivery_and_organization_movement",
			outputs: [
				"generated_hours",
				"new_subscriptions",
				"new_logos",
				"expanded_logos",
				"churned_logos",
				"net_logo_growth",
			],
		},
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "period_population",
				reason:
					"Every published period must contain non-negative Studio delivery and subscription movement values.",
			},
			{
				name: "logo_movement_reconciliation",
				reason:
					"Net logo growth must reconcile to new, expanded, and churned organizations.",
			},
			{
				name: "organization_deduplication",
				reason:
					"Each organization must count once per movement type and the expansion rule must use old_plan.",
			},
			{
				name: "premiere_exclusion",
				reason: "Generated hours must exclude Premiere-plugin activity.",
			},
			{
				name: "sensitive_detail_boundary",
				reason:
					"The result must exclude person, customer, user, organization, and email identifiers.",
			},
			{
				name: "complete_period_watermark",
				reason:
					"Every row must use one explicit UTC boundary and exclude the current partial period.",
			},
		],
		ownerTeam: "Productions",
		createdBy: "atlas-studio-product-registry",
		cadenceMinutes: 8 * 60,
	},
	...STUDIO_NATIVE_INSIGHT_SPECS,
	...HUBSPOT_REPORT_SPECS,
	{
		questionNumber: 7041,
		sourceExternalId: "cron:studio:monthly-period-kpis",
		key: "product.studio_monthly_delivery_logo_movement",
		name: "Monthly Studio delivery and logo movement",
		description:
			"Complete UTC months of Studio generated hours, subscription-created events, and organization-deduplicated new, expanded, churned, and net logo movement.",
		grain: FactGrain.MONTH,
		source: {
			key: "posthog:product-events",
			kind: DataSourceKind.POSTHOG,
			label: "PostHog Studio product and subscription events",
		},
		eventTimeField: "period_start",
		businessDefinition: {
			entity: "studio_product_month",
			population: "clean product users under the shared Atlas policy",
			periodAssignment: "event timestamp in complete UTC calendar months",
			generatedHours:
				"successful generation output_duration_secs divided by 3600, excluding source=plugin_premiere",
			newSubscriptions:
				"unique subscription_created source-event UUIDs; this is not a logo count",
			logoIdentity:
				"non-empty properties.organization_id, counted at most once per movement type and period",
			expansionRule:
				"subscription_updated moves from old_plan to a higher plan in hobbyist, creator, growth, scale order",
			netLogoGrowth: "new_logos + expanded_logos - churned_logos",
			separateQuestions:
				"activation speed, signup conversion, retention, and booked delivery commitments are not inferred by this question",
		},
		computation: {
			aggregate: "monthly_delivery_and_organization_movement",
			outputs: [
				"generated_hours",
				"new_subscriptions",
				"new_logos",
				"expanded_logos",
				"churned_logos",
				"net_logo_growth",
			],
		},
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "period_population",
				reason:
					"Every published period must contain non-negative Studio delivery and subscription movement values.",
			},
			{
				name: "logo_movement_reconciliation",
				reason:
					"Net logo growth must reconcile to new, expanded, and churned organizations.",
			},
			{
				name: "organization_deduplication",
				reason:
					"Each organization must count once per movement type and the expansion rule must use old_plan.",
			},
			{
				name: "premiere_exclusion",
				reason: "Generated hours must exclude Premiere-plugin activity.",
			},
			{
				name: "sensitive_detail_boundary",
				reason:
					"The result must exclude person, customer, user, organization, and email identifiers.",
			},
			{
				name: "complete_period_watermark",
				reason:
					"Every row must use one explicit UTC boundary and exclude the current partial period.",
			},
		],
		ownerTeam: "Productions",
		createdBy: "atlas-studio-product-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 7007,
		sourceExternalId: "cron:exit-survey:weekly-summary",
		key: "customer_success.exit_survey_cancellation_coverage",
		name: "Exit survey cancellation-request coverage",
		description:
			"Completed UTC-week cancellation requests, joined exit-survey response coverage, structured reason and plan distributions, and separate survey dismissals. Raw customer text is excluded.",
		grain: FactGrain.WEEK,
		source: {
			key: "posthog:product-events",
			kind: DataSourceKind.POSTHOG,
			label: "PostHog server billing and exit-survey events",
		},
		eventTimeField: "week_start",
		businessDefinition: {
			entity: "cancellation_request_week",
			periodAssignment: "server event timestamp in UTC",
			periodCompleteness: "current partial UTC week excluded",
			denominator:
				"unique subscription_cancel_pending event UUIDs emitted after Stripe accepts a scheduled cancellation request",
			numerator:
				"unique denominator events with survey_completed=true after the server joins the latest organization exit-survey row",
			dismissals:
				"unique exit_survey_dismissed frontend event UUIDs, reported separately and never added to cancellation requests",
			rawTextPolicy:
				"free-text comments, customer identifiers, and competitor names are not queried or published",
		},
		computation: {
			aggregate: "unique_event_uuid_weekly_distribution",
			outputs: [
				"cancellation_requests",
				"responses",
				"response_rate_pct",
				"reason_count",
				"plan_count",
				"dismissed_feedback_forms",
			],
		},
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "cancellation_denominator_parity",
				reason:
					"The cancellation denominator must equal unique server-emitted cancellation-request event UUIDs for each completed UTC week.",
			},
			{
				name: "response_deduplication",
				reason:
					"Each cancellation request can contribute at most one completed survey response.",
			},
			{
				name: "reason_taxonomy_review",
				reason:
					"Every published response reason must use the approved structured exit-survey taxonomy.",
			},
			{
				name: "comment_privacy_boundary",
				reason:
					"The governed query and result must exclude raw comments and customer identifiers.",
			},
			{
				name: "oldest_complete_watermark",
				reason:
					"The result must exclude the current partial week and publish one completed-week watermark.",
			},
		],
		ownerTeam: "Product",
		createdBy: "atlas-exit-survey-registry",
	},
	{
		questionNumber: 7012,
		sourceExternalId: "cron:billing-v3:diagnostics",
		key: "product.billing_v3_experiment_diagnostics",
		name: "Billing V3 tier, top-up, cancellation, and renewal diagnostics",
		description:
			"Current Billing V3 diagnostics by persisted experiment arm and paid tier, with successful V3 top-ups, structured cancellations, renewal maturity, paid renewals, and unpaid invoices.",
		grain: FactGrain.DAY,
		source: {
			key: "atlas:billing-experiment",
			kind: DataSourceKind.ATLAS,
			label: "Billing experiment assignment and Stripe outcome adapter",
		},
		eventTimeField: "data_through",
		businessDefinition: {
			entity: "billing_v3_experiment_arm",
			assignmentSpine:
				"one persisted billing_v3_experiment signup assignment per eligible external organization",
			paidConverter:
				"first_subscribed_at occurs on or after assignment and no later than data_through",
			tierAssignment:
				"paid subscription-create invoice plan when available, otherwise the current organization plan",
			topups:
				"successful V3 Stripe top-up payments on or after the organization's paid conversion",
			cancellations:
				"first structured Stripe cancellation on or after paid conversion; pending cancel remains separate",
			renewal:
				"paid converters are eligible after 30 days and renewed when a paid subscription-cycle invoice exists",
			failedInvoices:
				"post-conversion invoices that are not paid and retain a positive amount remaining",
			privacyPolicy:
				"structured reason enums are published; raw comments and customer identifiers are excluded",
		},
		computation: {
			aggregate: "experiment_arm_tier_and_outcome_diagnostics",
			outputs: [
				"assigned",
				"paid_converters",
				"topup_users",
				"topup_revenue_usd",
				"repeat_topup_orgs",
				"canceled",
				"pending_cancel",
				"renewal_eligible",
				"renewed",
				"failed_invoice_count",
				"failed_invoice_amount_usd",
				"cancellation_reason_count",
			],
		},
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "assignment_spine_parity",
				reason:
					"The result must contain one v2 control and one v3 treatment summary, with paid converters nested inside assigned organizations.",
			},
			{
				name: "tier_mapping",
				reason:
					"Tier rows must exactly reconcile to assigned organizations and paid converters in each experiment arm.",
			},
			{
				name: "topup_and_collection_reconciliation",
				reason:
					"Top-ups must be a v3-only subset of paid converters, repeat users must be a subset of top-up users, and collection amounts must be non-negative.",
			},
			{
				name: "cancellation_population",
				reason:
					"Canceled and pending-cancel organizations must remain subsets of paid converters.",
			},
			{
				name: "renewal_maturity",
				reason:
					"Renewed organizations must remain a subset of the 30-day renewal-eligible paid population.",
			},
			{
				name: "cancellation_reason_coverage",
				reason:
					"Structured cancellation-reason rows must reconcile to canceled paid converters in each arm.",
			},
			{
				name: "customer_text_boundary",
				reason:
					"The governed result must exclude customer identifiers and raw cancellation comments.",
			},
			{
				name: "oldest_complete_watermark",
				reason: "All diagnostic rows must use one UTC data-through timestamp.",
			},
		],
		ownerTeam: "Product",
		createdBy: "atlas-billing-diagnostics-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 7013,
		sourceExternalId: "cron:abuse:operational-detail",
		key: "security.signup_abuse_ring_detail",
		name: "Signup abuse rings and blocked-attempt detail",
		description:
			"Rolling 24-hour blocked signup attempts by reason, thresholded domain ring, thresholded IP ring, and bot user agent. Customer and user identifiers are excluded.",
		grain: FactGrain.DAY,
		source: {
			key: "posthog:signup-protection",
			kind: DataSourceKind.POSTHOG,
			label: "PostHog signup protection events",
		},
		eventTimeField: "data_through",
		businessDefinition: {
			entity: "blocked_signup_attempt",
			window: "rolling 24 hours ending at data_through",
			ringThreshold: 5,
			domainPolicy:
				"exclude common mailbox providers before applying the domain-ring threshold",
			privacyPolicy:
				"publish thresholded domain, IP, and user-agent signals without customer, user, organization, or email identifiers",
		},
		computation: {
			aggregate: "blocked_attempt_detail_by_signal",
			outputs: ["blocked_attempts", "related_count", "headline_total"],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: [
			{
				name: "headline_reconciliation",
				reason:
					"Reason rows must sum to the same 24-hour blocked-attempt total as the summary row.",
			},
			{
				name: "ring_definition_review",
				reason:
					"Each published ring must meet the five-attempt threshold and the domain view must exclude common mailbox providers.",
			},
			{
				name: "sensitive_detail_boundary",
				reason:
					"The result must exclude customer, user, organization, and email identifiers.",
			},
			{
				name: "rolling_window_watermark",
				reason:
					"Every row must share one data-through timestamp for the same half-open rolling 24-hour window.",
			},
		],
		ownerTeam: "Security Operations",
		createdBy: "atlas-abuse-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 7040,
		sourceExternalId: "cron:abuse:enforcement-detail",
		key: "security.signup_abuse_enforcement_detail",
		name: "Signup abuse enforcement and fresh-ring diagnostics",
		description:
			"Rolling 24-hour learned blocks and bans, seven-day auto-bans, fresh IP-ring candidates and verdicts, and generation distribution for newly banned users. Email and customer identifiers are excluded.",
		grain: FactGrain.DAY,
		source: {
			key: "product:abuse-operations",
			kind: DataSourceKind.METABASE,
			label: "Product abuse enforcement tables",
		},
		eventTimeField: "data_through",
		businessDefinition: {
			entity: "abuse_enforcement_action",
			primaryWindow: "rolling 24 hours ending at data_through",
			contextWindow: "rolling 7 days ending at data_through",
			freshRingThresholds: {
				minimumSignups: 20,
				minimumDomains: 10,
				maximumBannedRatio: 0.8,
				minimumEarlyApiUsers: 10,
			},
			privacyPolicy:
				"publish operational domain, IP, and user-agent values without email, user, organization, or customer identifiers",
		},
		computation: {
			aggregate: "enforcement_and_fresh_ring_diagnostics",
			outputs: [
				"banned_users_24h",
				"autobans_7d",
				"new_domain_blocks",
				"new_ip_blocks",
				"fresh_ring_candidates",
				"fresh_ring_active",
			],
		},
		requiresCrossSourceEligibility: false,
		pendingChecks: [
			{
				name: "ban_action_parity",
				reason:
					"Ban-reason and learned-block detail must reconcile to the 24-hour enforcement summary.",
			},
			{
				name: "fresh_ring_definition",
				reason:
					"Fresh IP-ring rows must meet the approved account, domain, ban-ratio, and early-API-activity thresholds.",
			},
			{
				name: "sensitive_detail_boundary",
				reason:
					"The result must exclude email addresses and customer, user, and organization identifiers.",
			},
			{
				name: "rolling_window_watermark",
				reason:
					"Every row must share one data-through timestamp for the governed 24-hour and 7-day windows.",
			},
		],
		ownerTeam: "Security Operations",
		createdBy: "atlas-abuse-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 7020,
		sourceExternalId: "atlas:product:paid-generated-hours-by-surface",
		key: "product.paid_generated_hours_by_surface",
		name: "Paid-plan generated hours by surface",
		description:
			"Final generated media hours from completed paid-plan generations in the current UTC month, split between the product app, API, plugins, MCP, agent workflows, and other sources.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			entity: "completed_paid_plan_generation",
			periodAssignment: "generationEndedAt in UTC",
			valueBasis:
				"final outputMediaLength; a 30-second generated segment counts as 30 seconds even when its input is one hour",
			surfaceTaxonomy: {
				app: ["studio"],
				api: ["api"],
				plugins: ["premiere-plugin", "resolve-plugin", "*-plugin"],
				mcp: ["mcp", "mcp:*"],
				agent: ["agent"],
				other: ["unknown", "any source not listed above"],
			},
		},
		computation: {
			aggregate: "sum_output_duration_seconds_divided_by_3600",
			outputs: ["app", "api", "plugins", "mcp", "agent", "other"],
		},
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 7021,
		sourceExternalId: "atlas:product:paid-generated-hours-share-by-surface",
		key: "product.paid_generated_hours_share_by_surface",
		name: "Share of paid-plan generated hours by surface",
		description:
			"Each surface's share of final generated media hours from completed paid-plan generations in the current UTC month.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			entity: "completed_paid_plan_generation",
			periodAssignment: "generationEndedAt in UTC",
			numerator: "final generated media seconds for the surface",
			denominator: "final generated media seconds across all surfaces",
			surfaceTaxonomy: "same governed taxonomy as paid generated hours",
		},
		computation: {
			aggregate: "surface_share_percentage",
			outputs: ["app", "api", "plugins", "mcp", "agent", "other"],
		},
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 7022,
		sourceExternalId: "atlas:product:accrued-value-by-surface",
		key: "product.accrued_value_by_surface",
		name: "Paid usage accrued by surface",
		description:
			"Usage revenue incurred by completed paid-plan generations in the current UTC month, split between the product app, API, plugins, MCP, agent workflows, and other sources. Subscription revenue is not allocated to a surface.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			entity: "completed_paid_plan_generation",
			periodAssignment: "generationEndedAt in UTC",
			valueBasis: "generationCostMillicents divided by 100000",
			cashBasis: false,
			surfaceTaxonomy: "same governed taxonomy as paid generated hours",
		},
		computation: {
			aggregate: "sum_accrued_value_usd",
			outputs: ["app", "api", "plugins", "mcp", "agent", "other"],
		},
		requiresCrossSourceEligibility: true,
	},
	{
		questionNumber: 7023,
		sourceExternalId: "atlas:product:accrued-value-share-by-surface",
		key: "product.accrued_value_share_by_surface",
		name: "Share of paid usage accrued by surface",
		description:
			"Each surface's share of usage revenue incurred by completed paid-plan generations in the current UTC month. Subscription revenue is not allocated to a surface.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:usage",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird product usage",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			entity: "completed_paid_plan_generation",
			periodAssignment: "generationEndedAt in UTC",
			numerator: "accrued usage value for the surface",
			denominator: "accrued usage value across all surfaces",
			surfaceTaxonomy: "same governed taxonomy as paid generated hours",
		},
		computation: {
			aggregate: "surface_share_percentage",
			outputs: ["app", "api", "plugins", "mcp", "agent", "other"],
		},
		requiresCrossSourceEligibility: true,
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
		sourceExternalId: "revenue:paid-licensed-invoice-items-1255",
		key: "company.paid_licensed_invoice_items_by_creation_month",
		name: "Paid licensed invoice items by creation month",
		description:
			"Paid licensed Stripe invoice-item value grouped by the month when each invoice item was created. This reproduces Metabase question 1255. It is invoice-item history, not live subscription run-rate.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue-close",
			kind: DataSourceKind.TINYBIRD,
			label: "Metabase finance revenue model",
		},
		eventTimeField: "createdAt",
		businessDefinition: {
			entity: "stripe_invoice_item",
			priceType: "licensed",
			includedStatus: "paid",
			parentInvoiceRequirement: "amount paid is greater than zero",
			excludedCustomers: ["cus_S1GousK6vr6sck", "cus_T412vRZpb4RIVb"],
			classification: "invoice_item_history",
			notEquivalentTo: "live subscription run-rate",
		},
		computation: {
			aggregate: "monthly_sum",
			output: "paid_licensed_invoice_items",
		},
		requiresCrossSourceEligibility: false,
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
					"Atlas must compare the native SQL replacement with Metabase question 1256 for every overlapping month.",
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
			"Current self-serve subscription value, V2 postpaid usage pace, V3 top-up pace, total run-rate, annualized run-rate, and Stripe cash reconciliation at one UTC cutoff.",
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
				"latest active or past-due self-serve subscriptions at the recurring licensed Stripe item price and quantity stored in the subscription payload",
			newPlanHandling:
				"a non-empty plan that passes the governed sync.tools revenue-door policy is included without a code change",
			v2UsageActual:
				"V2 postpaid generation value grouped by generationEndedAt",
			v2UsagePace:
				"month-to-date V2 postpaid usage divided by exact elapsed UTC seconds and multiplied by seconds in the calendar month",
			v3TopUpsActual:
				"successful V3 one-time Stripe top-up payments grouped by payment createdAt",
			v3TopUpPace:
				"month-to-date successful V3 top-up payments divided by exact elapsed UTC seconds and multiplied by seconds in the calendar month",
			variableRevenueRunRate:
				"estimated month-end V2 postpaid usage plus estimated month-end V3 top-up payments",
			productRunRate:
				"licensed subscription base plus estimated month-end V2 usage plus estimated month-end V3 top-up payments",
			annualizedRunRate: "product run-rate multiplied by 12",
			excluded: [
				"enterprise plans",
				"program plans",
				"channel partners in the governed revenue-door registry",
			],
			channelPartnerRegistryStatus: "complete",
		},
		computation: {
			aggregate: "run_rate_reconstruction",
			outputs: [
				"licensed_subscription_base",
				"v2_usage_accrual_mtd",
				"projected_v2_usage_accrual",
				"v3_top_up_payments_mtd",
				"projected_v3_top_up_payments",
				"variable_revenue_run_rate",
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
		name: "Estimated self-serve month-end revenue",
		description:
			"Estimated self-serve month-end revenue at one UTC cutoff. It combines current subscription value with paced V2 postpaid usage and paced V3 top-up payments. This is an operating estimate, not booked revenue or cash collected.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			revenueDoor: "sync.tools",
			formula:
				"licensed_subscription_base + estimated_month_end_v2_usage + estimated_month_end_v3_top_ups",
			enterpriseCommitmentsIncluded: false,
			channelPartnersIncluded: false,
			channelPartnerRegistryStatus: "complete",
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
		name: "Self-serve revenue history and current-month pace",
		description:
			"Six months of self-serve subscription value, V2 postpaid usage, and V3 top-up payments. Completed months show actual values. The open month also shows an estimated month-end total from the shared UTC data-through time.",
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
			billingComponents: [
				"V2 postpaid usage",
				"V3 successful top-up payments",
				"V2 and V3 subscription value",
			],
			population:
				"self-serve organizations after governed revenue-door exclusions",
		},
		computation: {
			aggregate: "monthly_components_and_current_month_pace",
			outputs: [
				"subscription_value",
				"v2_usage_revenue",
				"v3_top_up_revenue",
				"total_revenue",
				"estimated_month_end_total",
			],
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
			"Latest active or past-due self-serve Stripe subscriptions multiplied by the current monthly plan price, grouped by V2 or V3 billing type and plan. Excludes enterprise and program plans, plus channel partners in the governed revenue-door registry. This is subscription run-rate, not cash collected.",
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
				V3: "every other non-empty self-serve plan allowed by the governed revenue-door policy",
			},
			includedStatuses: ["active", "past_due"],
			priceSource:
				"recurring licensed Stripe item unit_amount multiplied by quantity from the latest raw payload for each subscription",
			newPlanHandling:
				"new self-serve plans flow through automatically after the revenue-door policy accepts them",
			excludedPlans: ["enterprise", "program", "partner"],
		},
		computation: {
			aggregate: "sum_recurring_licensed_item_value",
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
		name: "Estimated self-serve V2 usage month-end",
		description:
			"Estimated month-end V2 postpaid usage compared with the previous complete month. This is one component of self-serve revenue, not the headline company booked-revenue measure.",
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
			billingVersion: "V2 postpaid usage only",
			currentMonth:
				"month-to-date accrual estimated over the full UTC calendar month using exact elapsed seconds",
			channelPartnersIncluded: false,
			channelPartnerRegistryStatus: "complete",
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
			"Current active or past-due self-serve subscriptions at each recurring licensed Stripe item price multiplied by quantity. Excludes enterprise and program plans, plus channel partners in the governed revenue-door registry. Historical point-in-time values require Atlas snapshots and are not inferred from today's subscription state.",
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
			valueBasis:
				"recurring licensed Stripe item unit_amount multiplied by quantity from the latest raw subscription payload",
			newPlanHandling:
				"new self-serve plans flow through automatically after the revenue-door policy accepts them",
			channelPartnersIncluded: false,
			channelPartnerRegistryStatus: "complete",
		},
		computation: {
			aggregate: "sum_recurring_licensed_item_value",
			output: "subscription_run_rate",
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1123,
		sourceExternalId: "weekly-revenue:subscription-reconciliation",
		key: "company.subscription_value_reconciliation",
		name: "Live subscription value vs paid licensed invoice items",
		description:
			"Compares today's self-serve recurring subscription value with paid licensed invoice items created this month and in the latest complete month. These measures answer different questions and are not expected to match.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird Stripe mirror",
		},
		eventTimeField: "current subscription state and invoice-item createdAt",
		businessDefinition: {
			revenueDoor: "sync.tools",
			liveValue:
				"active or past-due recurring licensed Stripe item unit amount multiplied by quantity",
			invoiceHistory:
				"paid licensed invoice-item amount grouped by invoice-item creation month",
			warning: "the two measures are reconciliations, not equivalent revenue",
		},
		computation: { aggregate: "reconciliation" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1124,
		sourceExternalId: "weekly-revenue:invoice-collection-by-type",
		key: "company.invoice_collection_by_revenue_type",
		name: "Invoice collection by revenue type",
		description:
			"Shows how much self-serve subscription and usage invoice value was due, paid, and still open for each invoice-creation month. The current month is still collecting, so an open invoice is not automatically a missed payment.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird Stripe mirror",
		},
		eventTimeField: "invoice createdAt",
		businessDefinition: {
			revenueDoor: "sync.tools",
			invoiceState: "one latest state per Stripe invoice id",
			lineState: "one latest state per Stripe invoice-item id",
			allocation:
				"invoice totals are split across subscription, usage, and other lines in proportion to line value",
		},
		computation: { aggregate: "monthly_collection_reconciliation" },
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "Finance Collection Timing Review",
				reason:
					"Confirm that invoice creation month is the intended cohort for collection reporting before this becomes a certified finance metric.",
			},
		],
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1125,
		sourceExternalId: "weekly-revenue:uncollected-invoices",
		key: "company.uncollected_invoices",
		name: "Uncollected invoices",
		description:
			"Lists self-serve invoices that still had money due when Atlas checked Stripe. Use it to review collection work. A recent open invoice is not automatically bad debt; Finance still needs to confirm the final aging rule.",
		grain: FactGrain.EVENT,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird Stripe mirror",
		},
		eventTimeField: "invoice createdAt",
		businessDefinition: {
			revenueDoor: "sync.tools",
			population:
				"latest invoice states with amount remaining greater than zero",
			includedStatuses: ["open", "past_due", "uncollectible"],
		},
		computation: { aggregate: "invoice_detail" },
		requiresCrossSourceEligibility: true,
		pendingChecks: [
			{
				name: "Finance Collection Timing Review",
				reason:
					"Confirm which invoice states and aging rule Finance wants Atlas to use for the final missed-collection report.",
			},
		],
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1117,
		sourceExternalId: "weekly-revenue:v3-top-up-run-rate",
		key: "company.self_serve_v3_top_up_run_rate",
		name: "Estimated self-serve V3 top-ups month-end",
		description:
			"Estimated month-end V3 credit top-up payments compared with the previous complete month. This is successful top-up payment volume, not V3 credit consumption or company cash flow.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird Stripe payment mirror",
		},
		eventTimeField: "createdAt",
		businessDefinition: {
			revenueDoor: "sync.tools",
			billingVersion: "V3",
			paymentStatus: "succeeded",
			valueBasis: "successful one-time Stripe top-up payment amount",
			timeField: "payment createdAt",
			currentMonth:
				"month-to-date successful top-up payments estimated over the full UTC calendar month using exact elapsed seconds",
			v3UsageConsumptionIncluded: false,
		},
		computation: {
			aggregate: "monthly_sum_or_current_month_pace",
			output: "v3_top_up_run_rate",
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1118,
		sourceExternalId: "weekly-revenue:variable-run-rate",
		key: "company.self_serve_variable_revenue_run_rate",
		name: "Estimated self-serve variable revenue month-end",
		description:
			"Estimated month-end V2 postpaid usage plus V3 top-up payments, compared with the previous complete month. This excludes recurring subscription value and V3 credit consumption.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe payment mirror",
		},
		eventTimeField: "generationEndedAt and payment createdAt",
		businessDefinition: {
			revenueDoor: "sync.tools",
			formula:
				"estimated month-end V2 usage plus estimated month-end V3 top-up payments",
			subscriptionValueIncluded: false,
			v3UsageConsumptionIncluded: false,
		},
		computation: {
			aggregate: "sum",
			output: "variable_revenue_run_rate",
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
			"Accrued usage from organizations in the governed sync.partners registry. The current month is estimated from the exact UTC data-through time and compared with the previous complete month.",
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
				"month-to-date accrual estimated over the full UTC calendar month using exact elapsed seconds",
			partnerRegistryStatus: "complete",
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
			"Monthly accrued usage for organizations resolved through the governed channel-partner registry. The current month is month to date.",
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
			partnerRegistryStatus: "complete",
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
			"Monthly partner usage incurred and Stripe invoices raised, shown together by partner. Invoices raised are the current booked-revenue view. Stripe cash collected is reference-only until DualEntry is ready. These views must not be added together.",
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
			bookedRevenueBasis:
				"Stripe invoice amount due, grouped by the time the invoice was raised",
			cashCollectedStatus:
				"reference only until cash flow is sourced from DualEntry",
			warning: "the three measures are reconciliations, not additive revenue",
		},
		computation: { aggregate: "monthly_sum_by_partner_and_basis" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1119,
		sourceExternalId: "weekly-revenue:enterprise-usage-run-rate",
		key: "company.enterprise_usage_run_rate",
		name: "Enterprise usage run-rate",
		description:
			"Accrued usage from enterprise-plan organizations after removing every organization in the governed channel-partner registry. The current month is estimated from the exact UTC data-through time and compared with the previous complete month. This is usage incurred, not an invoice, contract value, or cash collection.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt",
		businessDefinition: {
			revenueDoor: "sync.enterprise",
			included: "organizations on the enterprise plan",
			excluded: "organizations in the governed sync.partners registry",
			valueBasis: "generationCostMillicents divided by 100000",
			timeField: "generationEndedAt",
			currentMonth:
				"month-to-date accrued usage estimated over the full UTC calendar month using exact elapsed seconds",
		},
		computation: {
			aggregate: "monthly_sum_or_current_month_pace",
			output: "enterprise_usage_run_rate",
		},
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1120,
		sourceExternalId: "weekly-revenue:enterprise-invoices-raised",
		key: "company.enterprise_invoices_raised",
		name: "Enterprise invoices raised",
		description:
			"Stripe invoice amount due for enterprise-plan organizations after removing channel partners, counted once when each invoice was raised. The current month is compared with the same elapsed UTC window in the previous month. This is booked revenue in Stripe, not full contract value or cash collected.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "createdAt",
		businessDefinition: {
			revenueDoor: "sync.enterprise",
			entity: "stripe_invoice",
			included: "organizations on the enterprise plan",
			excluded: "organizations in the governed sync.partners registry",
			valueBasis: "amountDue",
			timeField: "invoice createdAt",
			deduplication: "one latest-state record per Stripe invoice id",
			comparison: "current MTD versus the same elapsed UTC window last month",
		},
		computation: { aggregate: "sum", output: "enterprise_invoices_raised" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1121,
		sourceExternalId: "weekly-revenue:enterprise-cash-collected",
		key: "company.enterprise_cash_collected",
		name: "Enterprise cash collected",
		description:
			"Stripe amount paid for enterprise-plan invoices after removing channel partners, grouped by the actual paid timestamp. The current month is compared with the same elapsed UTC window in the previous month. This is cash collected, not booked or recognized revenue.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "status_transitions.paid_at",
		businessDefinition: {
			revenueDoor: "sync.enterprise",
			entity: "paid_stripe_invoice",
			included: "organizations on the enterprise plan",
			excluded: "organizations in the governed sync.partners registry",
			valueBasis: "amountPaid",
			timeField: "status_transitions.paid_at",
			deduplication: "one paid result per Stripe invoice id",
			comparison: "current MTD versus the same elapsed UTC window last month",
		},
		computation: { aggregate: "sum", output: "enterprise_cash_collected" },
		requiresCrossSourceEligibility: true,
		ownerTeam: "Company",
		createdBy: "atlas-revenue-registry",
		cadenceMinutes: 8 * 60,
	},
	{
		questionNumber: 1122,
		sourceExternalId: "weekly-revenue:enterprise-reconciliation",
		key: "company.enterprise_revenue_reconciliation",
		name: "Enterprise revenue reconciliation",
		description:
			"Monthly enterprise usage incurred, Stripe invoices raised, and Stripe cash collected after removing channel partners. These are separate views of the same business activity and must not be added together. Contract value is not shown until Atlas has a governed contract source.",
		grain: FactGrain.MONTH,
		source: {
			key: "tinybird:revenue",
			kind: DataSourceKind.TINYBIRD,
			label: "TinyBird usage and Stripe mirror",
		},
		eventTimeField: "generationEndedAt and Stripe invoice timestamps",
		businessDefinition: {
			revenueDoor: "sync.enterprise",
			included: "organizations on the enterprise plan",
			excluded: "organizations in the governed sync.partners registry",
			measures: ["usage_incurred", "invoices_raised", "cash_collected"],
			contractValueStatus:
				"not available until Atlas has a governed contract or MSA source",
			warning: "the three measures are reconciliations, not additive revenue",
		},
		computation: { aggregate: "monthly_sum_by_basis" },
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
	requiresOwnerApproval = false,
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
	const ownerApprovalChecks =
		requiresOwnerApproval && !linkedMetric?.approvedAt
			? [
					{
						name: "approved_metric_definition",
						reason:
							"The query returns data, but the metric owner still needs to confirm the definition, population, and reporting period.",
					},
				]
			: [];
	const pendingChecks = [
		...ownerApprovalChecks,
		...marketingSourceCoverageChecks(input.question.sourceExternalId),
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
			`The governed result for ${input.question.name}.`,
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

export function marketingSourceCoverageChecks(
	sourceExternalId: string | null,
): Array<{ name: string; reason: string }> {
	if (sourceExternalId === "marketing:ga4:visitors") {
		return [
			{
				name: "shared_cross_site_visitor_identity",
				reason:
					"The approved Marketing scope spans several sites. The current GA4 property totals can count the same person more than once because the sites do not yet expose one stable shared visitor ID to Atlas.",
			},
		];
	}
	if (
		sourceExternalId === "marketing:posthog:visitor-signup" ||
		sourceExternalId === "marketing:posthog:visitor-signup-rate"
	) {
		return [
			{
				name: "complete_marketing_pageview_coverage",
				reason:
					"The 7-day conversion rule is approved, but the current PostHog page-view source does not yet show complete docs and blog coverage. Atlas must not certify a partial Marketing visitor population.",
			},
		];
	}
	if (
		sourceExternalId === "marketing:posthog:attribution-source" ||
		sourceExternalId === "marketing:posthog:first-touch-signups"
	) {
		return [
			{
				name: "first_touch_attribution_coverage",
				reason:
					"First touch is the approved headline model, but the current signup events do not carry a first-touch source for every person. Atlas must show the missing share and keep this result provisional until attribution coverage is complete enough for reporting.",
			},
		];
	}
	return [];
}

export function needsApprovedMetricDefinitionCheck(input: {
	linkedMetricApprovedAt?: Date | null;
	catalogReadiness?: MetricReadinessStatus | null;
}): boolean {
	return (
		input.catalogReadiness === MetricReadinessStatus.NEEDS_DEFINITION &&
		!input.linkedMetricApprovedAt
	);
}

function questionNeedsIdentityEligibility(input: PublishInput): boolean {
	if (input.question.connector === DataSourceKind.HUBSPOT) return false;
	const declaredPolicy = declaredQuestionIdentityPolicy(
		input.version.queryText,
	);
	if (declaredPolicy !== null) return declaredPolicy;
	const text =
		`${input.question.name}\n${input.version.queryText}`.toLowerCase();
	return (
		input.question.databaseExternalId === "166" ||
		/(?:user|organization|org\b|signup|generation|subscription|customer|revenue|usage|retention|churn|activation|professional)/.test(
			text,
		)
	);
}

export function declaredQuestionIdentityPolicy(
	queryText: string,
): boolean | null {
	try {
		const query = JSON.parse(queryText) as {
			source?: unknown;
			personPolicy?: unknown;
		};
		if (query.source === "ga4" || query.source === "search_console") {
			return false;
		}
		if (query.source === "posthog") {
			return query.personPolicy !== "all_events";
		}
	} catch {
		return null;
	}
	return null;
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
		const [linkedMetric, catalogEntry] = await Promise.all([
			!registeredSpec && input.question.metricVersionId
				? this.db.metricVersion.findUnique({
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
				: null,
			!registeredSpec
				? this.db.metricCatalogEntry.findFirst({
						where: {
							canonicalQuestionId: input.question.id,
							kind: MetricCatalogKind.KPI,
							missingAt: null,
						},
						orderBy: { updatedAt: "desc" },
						select: { readiness: true },
					})
				: null,
		]);
		const spec =
			registeredSpec ??
			buildQuestionMetricSpec(
				input,
				linkedMetric ?? undefined,
				needsApprovedMetricDefinitionCheck({
					linkedMetricApprovedAt: linkedMetric?.approvedAt,
					catalogReadiness: catalogEntry?.readiness,
				}),
			);
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
		const checkResults = new Map(
			(input.verificationChecks ?? []).map((check) => [check.name, check]),
		);
		const unresolvedDefinitionChecks = (spec.pendingChecks ?? []).filter(
			(check) =>
				checkResults.get(check.name)?.status !== VerificationStatus.PASSED,
		);
		const definitionVerified = unresolvedDefinitionChecks.length === 0;
		const definitionFailed = (spec.pendingChecks ?? []).some(
			(check) =>
				checkResults.get(check.name)?.status === VerificationStatus.FAILED,
		);
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
					approvedBy: definitionVerified ? "atlas-policy" : null,
					approvedAt: definitionVerified ? input.capturedAt : null,
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
		} else if (definitionVerified && !metricVersion.approvedAt) {
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

		const verificationHash = hash({
			eligibilityVerified,
			revenueDoorVerified,
			verificationChecks: input.verificationChecks ?? [],
		});
		const snapshotKey = `${metricVersion.id}:${window.reportingPeriod}:${outputHash}:${verificationHash}`;
		const existing = await this.db.metricSnapshot.findUnique({
			where: { idempotencyKey: snapshotKey },
			select: { id: true },
		});
		if (existing) return existing;

		const resultPresent = input.result.rows.length > 0;
		const trustStatus = metricTrustStatus({
			resultPresent,
			definitionFailed,
			governanceVerified,
			definitionVerified,
		});
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
					verificationChecks: input.verificationChecks ?? [],
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
						verificationChecks: input.verificationChecks ?? [],
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
	return ["banned", "@sync.so", "@sync.labs"].every((term) =>
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
	verificationChecks: PublishVerificationCheck[];
}) {
	const passed = {
		status: VerificationStatus.PASSED,
		verifiedBy: "atlas-policy",
		verifiedAt: input.capturedAt,
	};
	const eligibility = input.eligibility;
	const incompleteEligibilityReason =
		eligibility?.limitation === "BANNED_NEVER_SUBSCRIBED_JOIN_REQUIRED"
			? "This question includes people who have not subscribed. Atlas applied the small internal-user exclusion list. It will not copy the full identity table. The question still needs a bounded server-side join to exclude banned people who never subscribed."
			: eligibility && eligibility.complete === false
				? "Atlas did not approve a partial population check. It will use a bounded server-side join or a small exclusion set instead of downloading the full identity table."
				: "The query has not yet applied the shared Atlas population rule.";
	const eligibilityPassedReason =
		eligibility?.policy === "MONEY"
			? "Money policy: internal identities are excluded. A customer who subscribed or paid remains in historical money results even if the customer was later banned."
			: eligibility?.enforcement === "POSTGRES_LIVE_JOIN"
				? "Atlas joined the product activity to the live user and organization records before aggregation. Internal identities and banned people who never subscribed are excluded. Paying customers and disabled accounts remain visible."
				: "Product activity policy: internal identities and banned people who never subscribed are excluded. Paying customers and disabled accounts remain visible.";
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
			evidence: input.resultPresent
				? undefined
				: json({
						reason:
							"The query ran successfully but returned no rows for this period. Confirm whether zero rows are expected or make the query return an explicit zero.",
					}),
			status: input.resultPresent
				? VerificationStatus.PASSED
				: VerificationStatus.PENDING,
			verifiedBy: input.resultPresent ? "atlas-policy" : null,
			verifiedAt: input.resultPresent ? input.capturedAt : null,
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
								? input.revenueDoorPolicy.matchMode === "INCLUDE_ENTERPRISE"
									? "Enterprise-plan organizations are included and every organization in the governed channel-partner registry is excluded."
									: "The revenue-door registry is complete and was applied before aggregation."
								: input.revenueDoorPolicy?.matchMode === "INCLUDE_PARTNERS"
									? "Known channel partners are included, but the partner registry still needs a complete review."
									: input.revenueDoorPolicy?.matchMode === "INCLUDE_ENTERPRISE"
										? "Enterprise-plan organizations are included, but Atlas cannot yet prove that the channel-partner exclusion list is complete."
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
		...input.pendingChecks.map((check) => {
			const result = input.verificationChecks.find(
				(candidate) => candidate.name === check.name,
			);
			const status = result?.status ?? VerificationStatus.PENDING;
			return {
				name: check.name,
				referenceType: "source_equivalence",
				referenceValue: json(result?.referenceValue ?? { required: true }),
				actualValue: json(result?.actualValue ?? { matched: false }),
				evidence: json({ reason: result?.reason ?? check.reason }),
				status,
				verifiedBy:
					status === VerificationStatus.PENDING ? null : "atlas-policy",
				verifiedAt:
					status === VerificationStatus.PENDING ? null : input.capturedAt,
			};
		}),
	];
}

export function metricTrustStatus(input: {
	resultPresent: boolean;
	definitionFailed: boolean;
	governanceVerified: boolean;
	definitionVerified: boolean;
}): MetricTrustStatus {
	if (input.definitionFailed) return MetricTrustStatus.FAILED;
	if (!input.resultPresent) return MetricTrustStatus.PENDING;
	if (input.governanceVerified && input.definitionVerified) {
		return MetricTrustStatus.VERIFIED;
	}
	return MetricTrustStatus.PENDING;
}

function hash(value: unknown): string {
	return createHash("sha256")
		.update(typeof value === "string" ? value : JSON.stringify(value))
		.digest("hex");
}

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
