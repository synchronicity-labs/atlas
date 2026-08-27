import { describe, expect, test } from "bun:test";
import { MetricReadinessStatus, MetricTrustStatus } from "@crm/db";
import {
	CUSTOMER_ECONOMICS_METRIC_SPECS,
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
	test("keeps only the unmatched customer economics tables in reconciliation", () => {
		const paidInvoiceRevenue = CUSTOMER_ECONOMICS_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7400,
		);
		const winBacks = CUSTOMER_ECONOMICS_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7405,
		);
		const scopeBridge = CUSTOMER_ECONOMICS_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7406,
		);
		const unmatchedReferences = CUSTOMER_ECONOMICS_METRIC_SPECS.filter(
			(spec) => ![7400, 7405, 7406].includes(spec.questionNumber),
		);

		expect(paidInvoiceRevenue?.pendingChecks).toBeUndefined();
		expect(winBacks?.pendingChecks).toBeUndefined();
		expect(scopeBridge?.pendingChecks).toBeUndefined();
		expect(unmatchedReferences).toHaveLength(5);
		expect(
			unmatchedReferences.every(
				(spec) => (spec.pendingChecks?.length ?? 0) === 1,
			),
		).toBe(true);
	});

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

	test("registers the governed Adobe plugin report contract", () => {
		const adobe = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7003,
		);

		expect(adobe?.sourceExternalId).toBe("cron:adobe-plugin:weekly-kpis");
		expect(adobe?.businessDefinition).toMatchObject({
			entity: "adobe_plugin_weekly_report",
			periodAssignment: "complete Monday-Sunday UTC weeks",
		});
		expect(adobe?.requiresCrossSourceEligibility).toBe(false);
		expect(adobe?.pendingChecks?.map((check) => check.name)).toEqual([
			"event_definition_review",
			"report_population",
			"metric_reconciliation",
			"cohort_maturity",
			"nps_response_parity",
			"sensitive_detail_boundary",
			"oldest_complete_watermark",
		]);
		expect(preferredAtlasQuestionNumber("cron:adobe-plugin:weekly-kpis")).toBe(
			7003,
		);
	});

	test("registers the governed product-page funnel contract", () => {
		const productPages = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7005,
		);

		expect(productPages?.sourceExternalId).toBe(
			"cron:product-pages:weekly-funnel",
		);
		expect(productPages?.businessDefinition).toMatchObject({
			entity: "product_page_week",
			periodAssignment: "complete Monday-Sunday UTC week",
			paidOrganizations:
				"first-touch organizations with at least one subscription whose first positive paid invoice occurs at or after the attributed signup and before the week ends",
		});
		expect(productPages?.requiresCrossSourceEligibility).toBe(false);
		expect(productPages?.pendingChecks?.map((check) => check.name)).toEqual([
			"page_registry_review",
			"page_population",
			"first_touch_coverage",
			"subscription_parity",
			"first_touch_identity",
			"sensitive_detail_boundary",
			"oldest_complete_watermark",
		]);
		expect(
			preferredAtlasQuestionNumber("cron:product-pages:weekly-funnel"),
		).toBe(7005);
	});

	test("registers the governed public API adoption contract", () => {
		const apiAdoption = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7008,
		);

		expect(apiAdoption?.sourceExternalId).toBe(
			"cron:api-endpoints:adoption-revenue",
		);
		expect(apiAdoption?.businessDefinition).toMatchObject({
			entity: "api_endpoint_week",
			revenueBasis:
				"usageCostMillicents or generationCostMillicents divided by 100000; this is accrued usage value, not Stripe cash, invoices, or subscription value",
		});
		expect(apiAdoption?.pendingChecks?.map((check) => check.name)).toEqual([
			"endpoint_registry_review",
			"api_key_owner_join",
			"clean_organization_population",
			"usage_revenue_basis",
			"source_count_reconciliation",
			"sensitive_detail_boundary",
			"oldest_complete_watermark",
		]);
		expect(
			preferredAtlasQuestionNumber("cron:api-endpoints:adoption-revenue"),
		).toBe(7008);
	});

	test("registers the governed public API reliability contract", () => {
		const apiReliability = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7009,
		);

		expect(apiReliability?.sourceExternalId).toBe(
			"cron:api-endpoints:reliability",
		);
		expect(apiReliability?.businessDefinition).toMatchObject({
			entity: "api_endpoint_traffic_scope_week",
			errorDefinition:
				"4xx client, documentation, or authentication errors remain separate from 5xx application errors",
		});
		expect(apiReliability?.pendingChecks?.map((check) => check.name)).toEqual([
			"betterstack_adapter",
			"endpoint_registry_review",
			"bot_and_healthcheck_exclusion",
			"error_taxonomy_review",
			"latency_population_review",
			"oldest_complete_watermark",
		]);
		expect(preferredAtlasQuestionNumber("cron:api-endpoints:reliability")).toBe(
			7009,
		);
	});

	test("registers the governed model feedback contract", () => {
		const modelFeedback = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7014,
		);

		expect(modelFeedback?.sourceExternalId).toBe(
			"cron:model-feedback:weekly-coverage",
		);
		expect(modelFeedback?.source.key).toBe("atlas:model-feedback-composite");
		expect(modelFeedback?.businessDefinition).toMatchObject({
			entity: "model_feedback_surface_week",
			separationPolicy:
				"support-negative counts remain separate from the product feedback denominator and never change the product negative rate",
		});
		expect(modelFeedback?.pendingChecks?.map((check) => check.name)).toEqual([
			"feedback_denominator_parity",
			"model_mapping",
			"support_evidence_join",
			"customer_text_boundary",
			"oldest_complete_watermark",
		]);
		expect(
			preferredAtlasQuestionNumber("cron:model-feedback:weekly-coverage"),
		).toBe(7014);
	});

	test("registers the governed Q3 enterprise lifecycle contract", () => {
		const q3 = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7011,
		);

		expect(q3?.sourceExternalId).toBe("cron:q3-gtm:lifecycle-funnel");
		expect(q3?.source.key).toBe("atlas:q3-gtm-composite");
		expect(q3?.businessDefinition).toMatchObject({
			entity: "q3_enterprise_lifecycle_event_week",
			signatureBoundary:
				"signed_paid_sows remains unavailable because the contract parser does not capture signature evidence",
		});
		expect(q3?.pendingChecks?.map((check) => check.name)).toEqual([
			"inbound_form_parity",
			"lifecycle_stage_mapping",
			"signed_contract_boundary",
			"logo_classification",
			"unmapped_deal_visibility",
			"sensitive_detail_boundary",
			"oldest_complete_watermark",
		]);
		expect(preferredAtlasQuestionNumber("cron:q3-gtm:lifecycle-funnel")).toBe(
			7011,
		);
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

	test("registers the dedicated Lipsync weekly traffic contract", () => {
		const traffic = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7100,
		);
		expect(traffic?.sourceExternalId).toBe("cron:lipsync:weekly-traffic");
		expect(traffic?.registerByQuestion).toBe(false);
		expect(traffic?.pendingChecks?.map((check) => check.name)).toEqual([
			"lipsync_source_scope",
			"complete_source_weeks",
			"weekly_population",
			"metric_reconciliation",
			"aggregate_privacy",
		]);
		expect(preferredAtlasQuestionNumber("cron:lipsync:weekly-traffic")).toBe(
			7100,
		);
	});

	test("registers the governed GEO-attributed product funnel", () => {
		const geo = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7017,
		);

		expect(geo?.sourceExternalId).toBe("cron:geo:weekly-conversion");
		expect(geo?.businessDefinition).toMatchObject({
			entity: "geo_attributed_signup_cohort",
			periodAssignment: "signup timestamp in UTC Monday weeks",
		});
		expect(geo?.pendingChecks?.map((check) => check.name)).toEqual([
			"cohort_population",
			"cohort_reconciliation",
			"ai_referrer_registry",
			"seven_day_cohort_maturity",
			"sensitive_detail_boundary",
			"oldest_complete_watermark",
		]);
		expect(preferredAtlasQuestionNumber("cron:geo:weekly-conversion")).toBe(
			7017,
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

	test("registers the governed Billing V3 diagnostic pack", () => {
		const diagnostics = PRODUCT_METRIC_SPECS.find(
			(spec) => spec.questionNumber === 7012,
		);

		expect(diagnostics?.sourceExternalId).toBe("cron:billing-v3:diagnostics");
		expect(diagnostics?.businessDefinition).toMatchObject({
			entity: "billing_v3_experiment_arm",
		});
		expect(diagnostics?.pendingChecks?.map((check) => check.name)).toEqual([
			"assignment_spine_parity",
			"tier_mapping",
			"topup_and_collection_reconciliation",
			"cancellation_population",
			"renewal_maturity",
			"cancellation_reason_coverage",
			"customer_text_boundary",
			"oldest_complete_watermark",
		]);
		expect(preferredAtlasQuestionNumber("cron:billing-v3:diagnostics")).toBe(
			7012,
		);
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
