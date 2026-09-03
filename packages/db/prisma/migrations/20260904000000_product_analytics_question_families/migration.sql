INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-product-analytics-coverage-source',
  'atlas:product-analytics-coverage',
  'ATLAS',
  'Atlas product analytics coverage plan',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "kind" = EXCLUDED."kind",
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "status", "purpose",
  "createdAt", "updatedAt"
) VALUES
  (
    'atlas-product-analytics-organization-lifecycle', 7520,
    'Organization lifecycle matrix',
    'Reusable organization lifecycle view. It keeps product retention, professional requalification, subscription retention, usage churn, subscription churn, return, requalification, and resubscription as separate series. Filters cover organization segment, billing version, signup cohort, timeframe, and horizon. Status: Draft. It needs mutually exclusive API, app, and mixed classification, approved headline horizons, and an organization-period model whose segment totals reconcile.',
    'ATLAS', 'atlas-product-analytics-coverage-source',
    'atlas:product-analytics-coverage:organization-lifecycle',
    'atlas:product-analytics-coverage', 'DRAFT', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-generation-feedback', 7521,
    'Generation feedback matrix',
    'Reusable generation feedback view by model, surface, app mode, workflow, first versus non-first generation, organization segment, billing version, and timeframe. It returns eligible completed generations, feedback exposures, rated generations, coverage, positive and negative ratings, upvote rate, and downvote abandonment. Status: Draft. Governed coverage uses distinct eligible completed generations; exposure and abandonment remain separate instrumented measures.',
    'ATLAS', 'atlas-product-analytics-coverage-source',
    'atlas:product-analytics-coverage:generation-feedback',
    'atlas:product-analytics-coverage', 'DRAFT', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-failure-rejection', 7522,
    'Generation failure and rejection matrix',
    'Reusable all-attempt quality view with completed, failed, and rejected counts and rates, reason counts and shares, and retryable versus non-retryable rates. Filters match the generation feedback matrix. Status: Draft. It is blocked until every attempt has a governed structured failure or rejection code and event-time dimensions.',
    'ATLAS', 'atlas-product-analytics-coverage-source',
    'atlas:product-analytics-coverage:failure-rejection',
    'atlas:product-analytics-coverage', 'DRAFT', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-attribution-outcome', 7523,
    'Attribution to product and revenue outcomes',
    'Reusable first-touch attribution view joined to signup, first generation, activation, professional qualification, paid conversion, W1, W2, M1, and M3 retention, and the selected revenue basis. Filters cover model, surface, workflow, organization segment, and timeframe. Status: Draft. It must preserve attribution provenance, expose unknown coverage, and use one shared identity bridge.',
    'ATLAS', 'atlas-product-analytics-coverage-source',
    'atlas:product-analytics-coverage:attribution-outcome',
    'atlas:product-analytics-coverage', 'DRAFT', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-billing-scorecard', 7524,
    'Matched Billing V2 and V3 scorecard',
    'Matched Billing V2 and V3 scorecard with eligible organizations, paid conversion, revenue per selected denominator, product and subscription retention, churn, return, requalification, resubscription, renewal maturity, and failed-invoice counts and amounts. Status: Draft. It needs an approved revenue-per-organization denominator, matched populations, and mature-cohort labeling.',
    'ATLAS', 'atlas-product-analytics-coverage-source',
    'atlas:product-analytics-coverage:billing-scorecard',
    'atlas:product-analytics-coverage', 'DRAFT', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-cohort-outcomes', 7525,
    'Signup cohort product outcomes',
    'Reusable cohort view anchored to signup and first product exposure. It returns cohort size, first-generation completion, workflow and model adoption, W1, W2, M1, and M3 generation retention, professional qualification, paid conversion, and revenue per organization. Filters cover organization segment, model, surface, workflow, billing version, and signup timeframe. Status: Draft. It needs the canonical generation fact, organization-period model, and mature-cohort rules.',
    'ATLAS', 'atlas-product-analytics-coverage-source',
    'atlas:product-analytics-coverage:cohort-outcomes',
    'atlas:product-analytics-coverage', 'DRAFT', 'RECONCILIATION',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "connector" = EXCLUDED."connector",
  "sourceId" = EXCLUDED."sourceId",
  "sourceExternalId" = EXCLUDED."sourceExternalId",
  "sourceDashboardExternalId" = EXCLUDED."sourceDashboardExternalId",
  "status" = EXCLUDED."status",
  "purpose" = EXCLUDED."purpose",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-product-analytics-organization-lifecycle-v1',
    'atlas-product-analytics-organization-lifecycle', 1, 'API',
    $json${"source":"atlas-product-analytics-coverage","state":"requires_organization_period_model_and_owner_decisions","grains":["WEEK","MONTH"],"dimensions":["organization_segment","billing_version","signup_cohort","timeframe","horizon"],"outputs":["starting_organizations","retained_organizations","retention_pct","churned_organizations","churn_pct","returned_organizations","return_pct","requalified_organizations","requalification_pct","resubscribed_organizations","resubscription_pct"],"requiredVerification":["population_exclusivity","lifecycle_series_separation","segment_reconciliation","mature_cohort_count","oldest_complete_watermark"]}$json$,
    'table', '{}'::jsonb, NULL, 'atlas-product-analytics-coverage-plan',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-generation-feedback-v1',
    'atlas-product-analytics-generation-feedback', 1, 'API',
    $json${"source":"atlas-product-analytics-coverage","state":"requires_feedback_instrumentation_and_shared_generation_fact","grains":["DAY","WEEK","MONTH"],"dimensions":["model","surface","app_mode","workflow","first_generation","organization_segment","billing_version","timeframe"],"outputs":["eligible_completed_generations","feedback_exposures","rated_generations","coverage_pct","positive_ratings","negative_ratings","upvote_pct","downvote_abandonment_pct"],"requiredVerification":["completed_generation_denominator","feedback_event_deduplication","first_generation_history","exposure_coverage","unknown_dimension_coverage"]}$json$,
    'table', '{}'::jsonb, NULL, 'atlas-product-analytics-coverage-plan',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-failure-rejection-v1',
    'atlas-product-analytics-failure-rejection', 1, 'API',
    $json${"source":"atlas-product-analytics-coverage","state":"requires_structured_attempt_reason_taxonomy","grains":["HOUR","DAY","WEEK","MONTH"],"dimensions":["model","surface","app_mode","workflow","first_generation","organization_segment","billing_version","timeframe","reason_code","retryability"],"outputs":["attempts","completed_attempts","failed_attempts","rejected_attempts","completion_pct","failure_pct","rejection_pct","reason_count","reason_share_pct","retryable_pct"],"requiredVerification":["all_attempt_denominator","terminal_state_reconciliation","structured_reason_coverage","retryability_mapping","unknown_dimension_coverage"]}$json$,
    'table', '{}'::jsonb, NULL, 'atlas-product-analytics-coverage-plan',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-attribution-outcome-v1',
    'atlas-product-analytics-attribution-outcome', 1, 'API',
    $json${"source":"atlas-product-analytics-coverage","state":"requires_attribution_identity_bridge","grains":["WEEK","MONTH"],"dimensions":["first_touch_source","campaign","model","surface","workflow","organization_segment","timeframe"],"outputs":["signups","first_generations","activated_organizations","professional_organizations","paid_conversions","w1_retention_pct","w2_retention_pct","m1_retention_pct","m3_retention_pct","revenue_per_organization","unknown_attribution_pct"],"requiredVerification":["first_touch_provenance","identity_join_coverage","unknown_attribution_coverage","outcome_denominator_parity","oldest_complete_watermark"]}$json$,
    'table', '{}'::jsonb, NULL, 'atlas-product-analytics-coverage-plan',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-billing-scorecard-v1',
    'atlas-product-analytics-billing-scorecard', 1, 'API',
    $json${"source":"atlas-product-analytics-coverage","state":"requires_matched_billing_population_and_revenue_denominator","grains":["MONTH"],"dimensions":["billing_version","organization_segment","signup_cohort","plan","timeframe","horizon"],"outputs":["eligible_organizations","paid_conversion_pct","revenue_per_organization","product_retention_pct","subscription_retention_pct","churn_pct","return_pct","requalification_pct","resubscription_pct","renewal_maturity_pct","renewal_pct","failed_invoice_count","failed_invoice_amount_usd"],"requiredVerification":["matched_population","revenue_basis_approval","billing_event_reconciliation","mature_cohort_count","oldest_complete_watermark"]}$json$,
    'table', '{}'::jsonb, NULL, 'atlas-product-analytics-coverage-plan',
    CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-cohort-outcomes-v1',
    'atlas-product-analytics-cohort-outcomes', 1, 'API',
    $json${"source":"atlas-product-analytics-coverage","state":"requires_canonical_generation_and_organization_period_models","grains":["WEEK","MONTH"],"dimensions":["signup_cohort","first_product_exposure","organization_segment","model","surface","workflow","billing_version","timeframe"],"outputs":["cohort_size","first_generation_completion_pct","workflow_adoption_pct","model_adoption_pct","w1_generation_retention_pct","w2_generation_retention_pct","m1_generation_retention_pct","m3_generation_retention_pct","professional_qualification_pct","paid_conversion_pct","revenue_per_organization"],"requiredVerification":["cohort_anchor_parity","first_generation_history","mature_cohort_count","segment_reconciliation","revenue_basis_approval"]}$json$,
    'table', '{}'::jsonb, NULL, 'atlas-product-analytics-coverage-plan',
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

SELECT setval(
  '"public"."question_publicNumber_seq"',
  (SELECT max("publicNumber") FROM "question"),
  true
);
