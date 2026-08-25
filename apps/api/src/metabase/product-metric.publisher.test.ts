import { describe, expect, test } from "bun:test";
import { MetricReadinessStatus, MetricTrustStatus } from "@crm/db";
import {
	declaredQuestionIdentityPolicy,
	marketingSourceCoverageChecks,
	metricTrustStatus,
	needsApprovedMetricDefinitionCheck,
	PRODUCT_METRIC_SPECS,
	preferredAtlasQuestionNumber,
	REVENUE_CLOSE_METRIC_SPECS,
	REVENUE_METRIC_SPECS,
} from "./product-metric.publisher";

describe("product feedback metric registry", () => {
	test("requests owner approval only for canonical KPIs that need a definition", () => {
		expect(
			needsApprovedMetricDefinitionCheck({
				catalogReadiness: MetricReadinessStatus.NEEDS_DEFINITION,
			}),
		).toBe(true);
		expect(
			needsApprovedMetricDefinitionCheck({
				catalogReadiness: MetricReadinessStatus.RECONCILING,
			}),
		).toBe(false);
		expect(needsApprovedMetricDefinitionCheck({})).toBe(false);
		expect(
			needsApprovedMetricDefinitionCheck({
				catalogReadiness: MetricReadinessStatus.NEEDS_DEFINITION,
				linkedMetricApprovedAt: new Date("2026-08-21T00:00:00.000Z"),
			}),
		).toBe(false);
	});

	test("does not apply a product-user filter to anonymous traffic sources", () => {
		expect(
			declaredQuestionIdentityPolicy(
				JSON.stringify({ source: "ga4", metrics: ["totalUsers"] }),
			),
		).toBe(false);
		expect(
			declaredQuestionIdentityPolicy(
				JSON.stringify({ source: "search_console", metrics: ["clicks"] }),
			),
		).toBe(false);
		expect(
			declaredQuestionIdentityPolicy(
				JSON.stringify({ source: "posthog", personPolicy: "all_events" }),
			),
		).toBe(false);
		expect(
			declaredQuestionIdentityPolicy(JSON.stringify({ source: "posthog" })),
		).toBe(true);
	});

	test("keeps cross-site Marketing metrics provisional until source coverage is complete", () => {
		expect(
			marketingSourceCoverageChecks("marketing:ga4:visitors").map(
				(check) => check.name,
			),
		).toEqual(["shared_cross_site_visitor_identity"]);
		expect(
			marketingSourceCoverageChecks(
				"marketing:posthog:visitor-signup-rate",
			).map((check) => check.name),
		).toEqual(["complete_marketing_pageview_coverage"]);
		expect(
			marketingSourceCoverageChecks("marketing:posthog:attribution-source").map(
				(check) => check.name,
			),
		).toEqual(["first_touch_attribution_coverage"]);
		expect(
			marketingSourceCoverageChecks(
				"marketing:posthog:first-touch-signups",
			).map((check) => check.name),
		).toEqual(["first_touch_attribution_coverage"]);
		expect(marketingSourceCoverageChecks("marketing:ga4:sessions")).toEqual([]);
	});

	test("maps the existing Metabase feedback cards to their Atlas questions", () => {
		expect(preferredAtlasQuestionNumber("8318")).toBe(42);
		expect(preferredAtlasQuestionNumber("8252")).toBe(39);
	});

	test("computes feedback metrics without silently approving their remaining definition decisions", () => {
		const checks = PRODUCT_METRIC_SPECS.filter((spec) =>
			[39, 42].includes(spec.questionNumber),
		).flatMap((spec) => spec.pendingChecks?.map((check) => check.name) ?? []);

		expect(checks).toEqual([
			"approved_feedback_instrument_rule",
			"approved_feedback_coverage_denominator",
		]);
	});

	test("registers the governed exit-survey cancellation contract", () => {
		const exitSurvey = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7007,
		);

		expect(exitSurvey?.sourceExternalId).toBe(
			"cron:exit-survey:weekly-summary",
		);
		expect(exitSurvey?.businessDefinition).toMatchObject({
			entity: "cancellation_request_week",
			periodCompleteness: "current partial UTC week excluded",
		});
		expect(exitSurvey?.pendingChecks?.map((check) => check.name)).toEqual([
			"cancellation_denominator_parity",
			"response_deduplication",
			"reason_taxonomy_review",
			"comment_privacy_boundary",
			"oldest_complete_watermark",
		]);
		expect(
			preferredAtlasQuestionNumber("cron:exit-survey:weekly-summary"),
		).toBe(7007);
	});

	test("registers the governed Lipsync-attributed product funnel", () => {
		const lipsync = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7004,
		);

		expect(lipsync?.sourceExternalId).toBe("cron:lipsync:product-funnel");
		expect(lipsync?.businessDefinition).toMatchObject({
			entity: "lipsync_attributed_signup_cohort",
			periodAssignment: "signup timestamp in UTC Monday weeks",
		});
		expect(lipsync?.pendingChecks?.map((check) => check.name)).toEqual([
			"lipsync_signup_cohort_population",
			"funnel_ordering",
			"referral_definition",
			"seven_day_cohort_maturity",
			"sensitive_detail_boundary",
			"oldest_complete_watermark",
		]);
		expect(preferredAtlasQuestionNumber("cron:lipsync:product-funnel")).toBe(
			7004,
		);
	});

	test("registers separate weekly and monthly Studio delivery contracts", () => {
		const studio = PRODUCT_METRIC_SPECS.filter((spec) =>
			[7002, 7041].includes(spec.questionNumber),
		);

		expect(studio.map((spec) => spec.sourceExternalId)).toEqual([
			"cron:studio:period-kpis",
			"cron:studio:monthly-period-kpis",
		]);
		expect(studio.map((spec) => spec.grain)).toEqual(["WEEK", "MONTH"]);
		expect(
			studio.map((spec) => spec.pendingChecks?.map((check) => check.name)),
		).toEqual(
			Array(2).fill([
				"period_population",
				"logo_movement_reconciliation",
				"organization_deduplication",
				"premiere_exclusion",
				"sensitive_detail_boundary",
				"complete_period_watermark",
			]),
		);
		expect(preferredAtlasQuestionNumber("cron:studio:period-kpis")).toBe(7002);
		expect(
			preferredAtlasQuestionNumber("cron:studio:monthly-period-kpis"),
		).toBe(7041);
	});

	test("registers the native Studio funnel and retention contracts", () => {
		const studioInsights = PRODUCT_METRIC_SPECS.filter((spec) =>
			[7042, 7043, 7044, 7045, 7046].includes(spec.questionNumber),
		);

		expect(studioInsights.map((spec) => spec.sourceExternalId)).toEqual([
			"cron:studio:insight-weekly-time-to-magic",
			"cron:studio:insight-monthly-time-to-magic",
			"cron:studio:insight-weekly-signup-conversion",
			"cron:studio:insight-monthly-signup-conversion",
			"cron:studio:insight-week-two-retention",
		]);
		expect(
			studioInsights.every(
				(spec) => spec.requiresCrossSourceEligibility === false,
			),
		).toBe(true);
		expect(
			studioInsights.map((spec) =>
				spec.pendingChecks?.map((check) => check.name),
			),
		).toEqual(
			Array(5).fill([
				"native_insight_definition",
				"period_population",
				"metric_reconciliation",
				"cohort_maturity",
				"sensitive_detail_boundary",
				"complete_period_watermark",
			]),
		);
		for (const spec of studioInsights) {
			expect(preferredAtlasQuestionNumber(spec.sourceExternalId)).toBe(
				spec.questionNumber,
			);
		}
	});

	test("registers separate governed abuse signal and enforcement contracts", () => {
		const abuseSpecs = PRODUCT_METRIC_SPECS.filter((spec) =>
			[7013, 7040].includes(spec.questionNumber),
		);

		expect(abuseSpecs.map((spec) => spec.sourceExternalId)).toEqual([
			"cron:abuse:operational-detail",
			"cron:abuse:enforcement-detail",
		]);
		expect(
			abuseSpecs.map(
				(spec) => spec.pendingChecks?.map((check) => check.name) ?? [],
			),
		).toEqual([
			[
				"headline_reconciliation",
				"ring_definition_review",
				"sensitive_detail_boundary",
				"rolling_window_watermark",
			],
			[
				"ban_action_parity",
				"fresh_ring_definition",
				"sensitive_detail_boundary",
				"rolling_window_watermark",
			],
		]);
	});

	test("records the confirmed Product KPI contract", () => {
		const professional = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 15,
		);
		const completion = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 8,
		);
		const m3 = PRODUCT_METRIC_SPECS.find((spec) => spec.questionNumber === 17);

		expect(professional?.eventTimeField).toBe("generationCreatedAt");
		expect(professional?.businessDefinition).toMatchObject({
			periodAssignment: "generationCreatedAt in UTC",
			professional: {
				completedStatus: "COMPLETED",
				billableDefinition:
					"generation started while its organization was on a non-free plan",
				sourcePlanSnapshot:
					"Product Generations.organizationPlan is captured when the generation starts; V2 TinyBird organizationPlanType is derived from that admission snapshot",
			},
		});
		expect(professional?.pendingChecks).toBeUndefined();
		expect(completion?.businessDefinition).toMatchObject({
			completedStatus: "COMPLETED",
			denominator: "all_non_deleted_generations",
		});
		expect(m3?.businessDefinition).toMatchObject({
			requalificationMonthOffset: 2,
		});
	});

	test("registers the supporting Product views that reuse approved KPI definitions", () => {
		const supporting = PRODUCT_METRIC_SPECS.filter((spec) =>
			[119, 120, 160].includes(spec.questionNumber),
		);

		expect(supporting.map((spec) => spec.sourceExternalId)).toEqual([
			"8168",
			"8174",
			"atlas:product:qualified-then-deleted",
		]);
		expect(supporting.every((spec) => !spec.pendingChecks?.length)).toBe(true);
		expect(preferredAtlasQuestionNumber("8168")).toBe(119);
		expect(preferredAtlasQuestionNumber("8174")).toBe(120);
	});

	test("registers the self-serve subscription, V2 usage, V3 top-up, variable, and total run-rate metrics", () => {
		const revenueMetrics = REVENUE_METRIC_SPECS.filter((spec) =>
			[1102, 1110, 1111, 1117, 1118].includes(spec.questionNumber),
		).map((spec) => spec.name);

		expect(revenueMetrics).toEqual([
			"Estimated self-serve month-end revenue",
			"Estimated self-serve V2 usage month-end",
			"Self-serve subscription run-rate",
			"Estimated self-serve V3 top-ups month-end",
			"Estimated self-serve variable revenue month-end",
		]);
	});

	test("reads subscription prices from Stripe and accepts new self-serve plans", () => {
		const overview = REVENUE_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 1101,
		);
		const byPlan = REVENUE_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 1104,
		);
		const subscriptionRunRate = REVENUE_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 1111,
		);

		expect(overview?.businessDefinition).toMatchObject({
			newPlanHandling: expect.stringContaining("without a code change"),
		});
		expect(byPlan?.businessDefinition).toMatchObject({
			billingType: {
				V2: ["hobbyist", "creator", "growth", "scale"],
				V3: expect.stringContaining("every other non-empty self-serve plan"),
			},
			priceSource: expect.stringContaining("Stripe item unit_amount"),
		});
		expect(subscriptionRunRate?.businessDefinition).toMatchObject({
			valueBasis: expect.stringContaining("Stripe item unit_amount"),
			newPlanHandling: expect.stringContaining("flow through automatically"),
		});
	});

	test("registers every Revenue close question in the governed metric layer", () => {
		expect(
			REVENUE_CLOSE_METRIC_SPECS.map((spec) => spec.questionNumber),
		).toEqual(Array.from({ length: 14 }, (_, index) => 1001 + index));
		expect(preferredAtlasQuestionNumber("revenue:usage-spend-ndr")).toBe(1007);
	});

	test("requires a live saved-question equivalence check", () => {
		const paidCustomerRevenue = REVENUE_CLOSE_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 1004,
		);

		expect(paidCustomerRevenue?.pendingChecks?.[0]?.name).toBe(
			"saved_question_equivalence",
		);
		expect(paidCustomerRevenue?.pendingChecks?.[0]?.reason).toContain(
			"compare the native SQL replacement",
		);
	});

	test("registers the partner usage, invoice, cash, breakdown, and reconciliation metrics", () => {
		const partnerMetrics = REVENUE_METRIC_SPECS.filter((spec) =>
			[1112, 1113, 1114, 1115, 1116].includes(spec.questionNumber),
		).map((spec) => spec.name);

		expect(partnerMetrics).toEqual([
			"Channel-partner usage run-rate",
			"Channel-partner invoices raised",
			"Channel-partner cash collected",
			"Channel-partner usage by partner",
			"Channel-partner revenue reconciliation",
		]);
	});

	test("registers the enterprise usage, invoice, cash, and reconciliation metrics", () => {
		const enterpriseMetrics = REVENUE_METRIC_SPECS.filter((spec) =>
			[1119, 1120, 1121, 1122].includes(spec.questionNumber),
		).map((spec) => spec.name);

		expect(enterpriseMetrics).toEqual([
			"Enterprise usage run-rate",
			"Enterprise invoices raised",
			"Enterprise cash collected",
			"Enterprise revenue reconciliation",
		]);
	});

	test("registers live subscription and invoice collection reconciliation", () => {
		const metrics = REVENUE_METRIC_SPECS.filter((spec) =>
			[1123, 1124, 1125].includes(spec.questionNumber),
		).map((spec) => spec.name);

		expect(metrics).toEqual([
			"Live subscription value vs paid licensed invoice items",
			"Invoice collection by revenue type",
			"Uncollected invoices",
		]);
	});

	test("keeps successful empty results in review instead of marking them failed", () => {
		expect(
			metricTrustStatus({
				resultPresent: false,
				definitionFailed: false,
				governanceVerified: true,
				definitionVerified: true,
			}),
		).toBe(MetricTrustStatus.PENDING);
	});

	test("keeps failed definition checks red", () => {
		expect(
			metricTrustStatus({
				resultPresent: true,
				definitionFailed: true,
				governanceVerified: true,
				definitionVerified: true,
			}),
		).toBe(MetricTrustStatus.FAILED);
	});
});
