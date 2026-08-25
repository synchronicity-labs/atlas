INSERT INTO "dataSource" (
  id,
  key,
  kind,
  label,
  state,
  "createdAt",
  "updatedAt"
) VALUES (
  'atlas-cron-methodology-source',
  'atlas:cron-methodology',
  'ATLAS',
  'Governed recurring-report methodology',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO NOTHING;

WITH specs (
  id,
  number,
  name,
  description,
  external_id,
  dashboard_external_id,
  grain,
  required_sources,
  outputs,
  verification
) AS (
  VALUES
    (
      'atlas-cron-question-active-pilot-adoption',
      7001,
      'Active pilot registry and product adoption',
      'Daily active-pilot registry joined to account-level product use. A pilot is active only when the CRM or approved contract registry has an open pilot window. Usage is grouped by model and surface. The result uses the oldest complete required-source watermark.',
      'cron:active-pilots:adoption',
      'atlas:sales:pilots',
      'DAY',
      '["hubspot:deals","product:organizations","tinybird:usage"]'::jsonb,
      '["account","pilot_status","pilot_start","pilot_end","owner","model_usage","surface_usage","last_activity_at","data_through"]'::jsonb,
      '["active_registry_parity","account_identity_join","usage_population_exclusions","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-studio-period-pack',
      7002,
      'Studio delivery KPI period pack',
      'Weekly and monthly Studio delivery metrics for generated hours, new subscriptions, time to first successful generation, signup-to-subscription conversion, week-two retention, and net logo growth. Premiere-plugin activity is excluded. Cohorts are shown only after their full maturity window.',
      'cron:studio:period-kpis',
      'atlas:productions:studio',
      'WEEK',
      '["product:users","product:organizations","tinybird:usage","hubspot:deals"]'::jsonb,
      '["period_start","generated_hours","new_subscriptions","median_time_to_magic","signup_to_subscription_pct","week_two_retention_pct","new_logos","expansions","churned_logos","net_logo_growth","data_through"]'::jsonb,
      '["premiere_exclusion","cohort_maturity","subscription_parity","logo_movement_reconciliation","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-adobe-plugin-pack',
      7003,
      'Adobe plugin adoption, retention, and NPS',
      'Weekly Adobe plugin installs, activation, two-day activation, retained use, power-user retention, post-generation actions, and NPS. Each rate includes its numerator and denominator. NPS comments remain a separate restricted detail view.',
      'cron:adobe-plugin:weekly-kpis',
      'atlas:product:adobe-plugin',
      'WEEK',
      '["posthog:product-events","product:users","survey:nps"]'::jsonb,
      '["cohort_week","installs","activated_users","activation_pct","two_day_activation_pct","retained_users","retention_pct","power_retention_pct","post_generation_actions","nps_score","nps_responses","data_through"]'::jsonb,
      '["event_definition_review","clean_user_population","cohort_maturity","nps_response_parity","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-lipsync-funnel',
      7004,
      'Lipsync acquisition and conversion funnel',
      'Weekly and monthly lipsync.com acquisition and product conversion from search impression and site session through referral, signup, project start, and successful lipsync generation. Cross-source rates use the oldest complete source watermark.',
      'cron:lipsync:acquisition-funnel',
      'atlas:marketing:lipsync',
      'WEEK',
      '["gsc:lipsync","ga4:lipsync","posthog:product-events"]'::jsonb,
      '["period_start","search_impressions","search_clicks","users","sessions","engaged_sessions","referrals","signups","projects_started","successful_generations","step_rates","data_through"]'::jsonb,
      '["cross_site_identity_coverage","referral_definition","clean_user_population","funnel_ordering","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-product-page-funnel',
      7005,
      'Product-page acquisition and paid conversion',
      'Weekly per-page acquisition and conversion for approved Sync product pages. Traffic, signup, subscription, and paid conversion share one first-touch attribution model. Each page reports source coverage and the oldest complete watermark.',
      'cron:product-pages:weekly-funnel',
      'atlas:marketing:product-pages',
      'WEEK',
      '["ga4:marketing-properties","posthog:attribution","product:subscriptions"]'::jsonb,
      '["page","users","sessions","engagement_rate_pct","signups","subscriptions","paid_conversion_pct","attribution_coverage_pct","data_through"]'::jsonb,
      '["page_registry_review","first_touch_coverage","subscription_parity","cross_site_identity_coverage","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-weekly-active-pilots',
      7006,
      'Weekly active pilot count',
      'Weekly sales-operations count of active pilots from the approved pilot registry. The result includes additions, exits, owners, and account names so the total can be reconciled to the registry.',
      'cron:sales:weekly-active-pilots',
      'atlas:sales:weekly',
      'WEEK',
      '["hubspot:deals","contracts:pilot-registry"]'::jsonb,
      '["week_start","active_pilots","new_pilots","exited_pilots","pilot_accounts","owners","data_through"]'::jsonb,
      '["active_registry_parity","deal_stage_mapping","owner_coverage","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-exit-survey',
      7007,
      'Exit survey weekly reasons and themes',
      'Weekly exit-survey response rate, structured reason distribution, plan and tenure breakdowns, and de-identified themes. Raw comments remain a separate restricted view and are not copied into the headline metric.',
      'cron:exit-survey:weekly-summary',
      'atlas:customer-success:exit-survey',
      'WEEK',
      '["product:cancellations","survey:exit","pylon:customer-context"]'::jsonb,
      '["week_start","cancellations","responses","response_rate_pct","reason","reason_count","plan","tenure_bucket","theme","data_through"]'::jsonb,
      '["cancellation_denominator_parity","response_deduplication","reason_taxonomy_review","comment_privacy_boundary","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-api-adoption',
      7008,
      'API endpoint adoption and attributed revenue',
      'Weekly API endpoint use by eligible external organization with request volume, active organizations, successful jobs, accrued paid usage, and subscription value. Revenue follows the approved product revenue door and is not inferred from free traffic.',
      'cron:api-endpoints:adoption-revenue',
      'atlas:product:api',
      'WEEK',
      '["product:api-keys","tinybird:usage","product:subscriptions"]'::jsonb,
      '["week_start","endpoint","requests","successful_jobs","active_organizations","accrued_paid_usage","subscription_value","data_through"]'::jsonb,
      '["endpoint_registry_review","api_key_owner_join","clean_organization_population","revenue_door_policy","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-api-reliability',
      7009,
      'API endpoint reliability and error rate',
      'Weekly endpoint reliability with request count, error count, error rate, latency percentiles, and top classified errors. This question requires a read-only BetterStack adapter before it can produce a governed result.',
      'cron:api-endpoints:reliability',
      'atlas:engineering:api',
      'WEEK',
      '["betterstack:http-logs","product:endpoint-registry"]'::jsonb,
      '["week_start","endpoint","requests","errors","error_rate_pct","p50_latency_ms","p95_latency_ms","top_error_class","data_through"]'::jsonb,
      '["betterstack_adapter","endpoint_registry_review","bot_and_healthcheck_exclusion","error_taxonomy_review","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-activated-not-professional',
      7010,
      'Activated organizations not yet professional',
      'Latest and previous complete-month V2 self-serve organizations that meet the activation rule but not the professional rule. Results break down by plan, generation bucket, output-hour bucket, and model mix under the canonical Product population.',
      'cron:product:activated-not-professional',
      'atlas:product:scoreboard',
      'MONTH',
      '["tinybird:usage","product:users","product:organizations"]'::jsonb,
      '["month","plan","generation_bucket","output_hour_bucket","model","activated_organizations","professional_organizations","gap_organizations","data_through"]'::jsonb,
      '["canonical_population","activation_definition","professional_definition","complete_month_boundary","identity_eligibility"]'::jsonb
    ),
    (
      'atlas-cron-question-q3-gtm-funnel',
      7011,
      'Q3 enterprise inbound and lifecycle funnel',
      'Quarter-to-date enterprise inbound, MQL, PQL, SQL, signed paid SOW, net-new logo, and renewal counts. Each stage uses an approved CRM definition and exposes unmapped records instead of silently dropping them.',
      'cron:q3-gtm:lifecycle-funnel',
      'atlas:sales:q3-gtm',
      'WEEK',
      '["slack:inbound-forms","hubspot:contacts","hubspot:deals","contracts:sow-registry"]'::jsonb,
      '["week_start","enterprise_inbound","mql","pql","sql","signed_paid_sows","net_new_logos","renewals","unmapped_records","data_through"]'::jsonb,
      '["inbound_form_parity","lifecycle_stage_mapping","signed_contract_parity","logo_classification","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-billing-diagnostics',
      7012,
      'Billing V3 tier, top-up, cancellation, and renewal diagnostics',
      'Daily and weekly Billing V3 diagnostics by experiment arm and paid tier. It includes paid converters, top-up users and cash, repeat top-ups, cancellations, days to cancel, renewal maturity, failed invoices, and structured cancellation reasons.',
      'cron:billing-v3:diagnostics',
      'atlas:product:billing-v3',
      'DAY',
      '["product:billing-assignments","product:subscriptions","stripe:invoice-mirror","tinybird:paid-usage","product:cancellation-feedback"]'::jsonb,
      '["period_start","arm","tier","assigned","paid_converters","topup_users","topup_revenue","repeat_topups","canceled","pending_cancel","days_to_cancel_bucket","renewal_eligible","renewed","failed_invoice_count","failed_invoice_amount","cancellation_reason","data_through"]'::jsonb,
      '["assignment_spine_parity","paid_conversion_definition","revenue_door_policy","tier_mapping","renewal_maturity","cancellation_reason_coverage","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-abuse-detail',
      7013,
      'Signup abuse rings and enforcement detail',
      'Daily operational detail behind the governed signup-block headline. It groups blocked attempts by domain, IP, reason, and detected ring, and reconciles bans and auto-bans. Sensitive raw identifiers remain in a restricted detail view.',
      'cron:abuse:operational-detail',
      'atlas:abuse:operations',
      'DAY',
      '["posthog:signup-protection","product:users","product:abuse-rules"]'::jsonb,
      '["day","reason","domain","ip","ring","blocked_attempts","distinct_users","banned_users","auto_bans","new_domain_blocks","new_ip_blocks","data_through"]'::jsonb,
      '["headline_reconciliation","ban_action_parity","ring_definition_review","sensitive_detail_boundary","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-model-feedback',
      7014,
      'Model feedback and support quality coverage',
      'Weekly model feedback by product surface and model, joined to support-negative themes without exposing customer text. Product feedback and support evidence keep separate source watermarks and use the oldest complete watermark for combined rates.',
      'cron:model-feedback:weekly-coverage',
      'atlas:product:model-feedback',
      'WEEK',
      '["product:generation-feedback","tinybird:usage","gbrain:support-evidence","pylon:tickets"]'::jsonb,
      '["week_start","surface","model","rated_generations","positive_feedback","negative_feedback","negative_rate_pct","support_negative_tickets","support_theme","coverage_pct","data_through"]'::jsonb,
      '["feedback_denominator_parity","model_mapping","support_evidence_join","customer_text_boundary","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-studio-bookings',
      7015,
      'Studio booked revenue and delivery commitments',
      'Weekly and monthly Studio closed-won and in-delivery commitments. Booked revenue is separate from recognized product revenue and includes contract, delivery status, account, owner, and source coverage.',
      'cron:studio:bookings-pipeline',
      'atlas:productions:studio',
      'WEEK',
      '["hubspot:deals","contracts:studio","productions:delivery-registry"]'::jsonb,
      '["period_start","account","stage","closed_won_value","in_delivery_value","owner","contract_status","delivery_status","data_through"]'::jsonb,
      '["deal_contract_parity","delivery_registry_parity","currency_normalization","double_count_check","oldest_complete_watermark"]'::jsonb
    ),
    (
      'atlas-cron-question-enterprise-pipeline',
      7016,
      'Enterprise bookings and net-new pipeline',
      'Weekly and monthly enterprise bookings and net-new pipeline by stage. Commitments remain separate from product usage revenue. The result exposes stage movement, signed contracts, net-new logos, renewals, and unmapped deals.',
      'cron:enterprise:bookings-pipeline',
      'atlas:sales:enterprise',
      'WEEK',
      '["hubspot:deals","contracts:enterprise","product:organizations"]'::jsonb,
      '["period_start","stage","pipeline_created","booked_value","signed_contracts","net_new_logos","renewals","unmapped_deals","data_through"]'::jsonb,
      '["deal_stage_mapping","signed_contract_parity","logo_classification","currency_normalization","commit_usage_separation","oldest_complete_watermark"]'::jsonb
    )
)
INSERT INTO "question" (
  id,
  number,
  name,
  description,
  connector,
  "sourceId",
  "sourceExternalId",
  "sourceDashboardExternalId",
  status,
  purpose,
  "createdAt",
  "updatedAt"
)
SELECT
  specs.id,
  specs.number,
  specs.name,
  specs.description,
  'ATLAS',
  'atlas-cron-methodology-source',
  specs.external_id,
  specs.dashboard_external_id,
  'ACTIVE',
  'RECONCILIATION',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM specs
ON CONFLICT (id) DO NOTHING;

WITH specs (
  question_id,
  grain,
  required_sources,
  outputs,
  verification
) AS (
  VALUES
    ('atlas-cron-question-active-pilot-adoption', 'DAY', '["hubspot:deals","product:organizations","tinybird:usage"]'::jsonb, '["account","pilot_status","pilot_start","pilot_end","owner","model_usage","surface_usage","last_activity_at","data_through"]'::jsonb, '["active_registry_parity","account_identity_join","usage_population_exclusions","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-studio-period-pack', 'WEEK', '["product:users","product:organizations","tinybird:usage","hubspot:deals"]'::jsonb, '["period_start","generated_hours","new_subscriptions","median_time_to_magic","signup_to_subscription_pct","week_two_retention_pct","new_logos","expansions","churned_logos","net_logo_growth","data_through"]'::jsonb, '["premiere_exclusion","cohort_maturity","subscription_parity","logo_movement_reconciliation","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-adobe-plugin-pack', 'WEEK', '["posthog:product-events","product:users","survey:nps"]'::jsonb, '["cohort_week","installs","activated_users","activation_pct","two_day_activation_pct","retained_users","retention_pct","power_retention_pct","post_generation_actions","nps_score","nps_responses","data_through"]'::jsonb, '["event_definition_review","clean_user_population","cohort_maturity","nps_response_parity","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-lipsync-funnel', 'WEEK', '["gsc:lipsync","ga4:lipsync","posthog:product-events"]'::jsonb, '["period_start","search_impressions","search_clicks","users","sessions","engaged_sessions","referrals","signups","projects_started","successful_generations","step_rates","data_through"]'::jsonb, '["cross_site_identity_coverage","referral_definition","clean_user_population","funnel_ordering","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-product-page-funnel', 'WEEK', '["ga4:marketing-properties","posthog:attribution","product:subscriptions"]'::jsonb, '["page","users","sessions","engagement_rate_pct","signups","subscriptions","paid_conversion_pct","attribution_coverage_pct","data_through"]'::jsonb, '["page_registry_review","first_touch_coverage","subscription_parity","cross_site_identity_coverage","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-weekly-active-pilots', 'WEEK', '["hubspot:deals","contracts:pilot-registry"]'::jsonb, '["week_start","active_pilots","new_pilots","exited_pilots","pilot_accounts","owners","data_through"]'::jsonb, '["active_registry_parity","deal_stage_mapping","owner_coverage","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-exit-survey', 'WEEK', '["product:cancellations","survey:exit","pylon:customer-context"]'::jsonb, '["week_start","cancellations","responses","response_rate_pct","reason","reason_count","plan","tenure_bucket","theme","data_through"]'::jsonb, '["cancellation_denominator_parity","response_deduplication","reason_taxonomy_review","comment_privacy_boundary","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-api-adoption', 'WEEK', '["product:api-keys","tinybird:usage","product:subscriptions"]'::jsonb, '["week_start","endpoint","requests","successful_jobs","active_organizations","accrued_paid_usage","subscription_value","data_through"]'::jsonb, '["endpoint_registry_review","api_key_owner_join","clean_organization_population","revenue_door_policy","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-api-reliability', 'WEEK', '["betterstack:http-logs","product:endpoint-registry"]'::jsonb, '["week_start","endpoint","requests","errors","error_rate_pct","p50_latency_ms","p95_latency_ms","top_error_class","data_through"]'::jsonb, '["betterstack_adapter","endpoint_registry_review","bot_and_healthcheck_exclusion","error_taxonomy_review","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-activated-not-professional', 'MONTH', '["tinybird:usage","product:users","product:organizations"]'::jsonb, '["month","plan","generation_bucket","output_hour_bucket","model","activated_organizations","professional_organizations","gap_organizations","data_through"]'::jsonb, '["canonical_population","activation_definition","professional_definition","complete_month_boundary","identity_eligibility"]'::jsonb),
    ('atlas-cron-question-q3-gtm-funnel', 'WEEK', '["slack:inbound-forms","hubspot:contacts","hubspot:deals","contracts:sow-registry"]'::jsonb, '["week_start","enterprise_inbound","mql","pql","sql","signed_paid_sows","net_new_logos","renewals","unmapped_records","data_through"]'::jsonb, '["inbound_form_parity","lifecycle_stage_mapping","signed_contract_parity","logo_classification","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-billing-diagnostics', 'DAY', '["product:billing-assignments","product:subscriptions","stripe:invoice-mirror","tinybird:paid-usage","product:cancellation-feedback"]'::jsonb, '["period_start","arm","tier","assigned","paid_converters","topup_users","topup_revenue","repeat_topups","canceled","pending_cancel","days_to_cancel_bucket","renewal_eligible","renewed","failed_invoice_count","failed_invoice_amount","cancellation_reason","data_through"]'::jsonb, '["assignment_spine_parity","paid_conversion_definition","revenue_door_policy","tier_mapping","renewal_maturity","cancellation_reason_coverage","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-abuse-detail', 'DAY', '["posthog:signup-protection","product:users","product:abuse-rules"]'::jsonb, '["day","reason","domain","ip","ring","blocked_attempts","distinct_users","banned_users","auto_bans","new_domain_blocks","new_ip_blocks","data_through"]'::jsonb, '["headline_reconciliation","ban_action_parity","ring_definition_review","sensitive_detail_boundary","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-model-feedback', 'WEEK', '["product:generation-feedback","tinybird:usage","gbrain:support-evidence","pylon:tickets"]'::jsonb, '["week_start","surface","model","rated_generations","positive_feedback","negative_feedback","negative_rate_pct","support_negative_tickets","support_theme","coverage_pct","data_through"]'::jsonb, '["feedback_denominator_parity","model_mapping","support_evidence_join","customer_text_boundary","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-studio-bookings', 'WEEK', '["hubspot:deals","contracts:studio","productions:delivery-registry"]'::jsonb, '["period_start","account","stage","closed_won_value","in_delivery_value","owner","contract_status","delivery_status","data_through"]'::jsonb, '["deal_contract_parity","delivery_registry_parity","currency_normalization","double_count_check","oldest_complete_watermark"]'::jsonb),
    ('atlas-cron-question-enterprise-pipeline', 'WEEK', '["hubspot:deals","contracts:enterprise","product:organizations"]'::jsonb, '["period_start","stage","pipeline_created","booked_value","signed_contracts","net_new_logos","renewals","unmapped_deals","data_through"]'::jsonb, '["deal_stage_mapping","signed_contract_parity","logo_classification","currency_normalization","commit_usage_separation","oldest_complete_watermark"]'::jsonb)
)
INSERT INTO "questionVersion" (
  id,
  "questionId",
  version,
  "queryLanguage",
  "queryText",
  display,
  visualization,
  "createdBy",
  "createdAt"
)
SELECT
  specs.question_id || '-v1',
  specs.question_id,
  1,
  'API',
  jsonb_pretty(jsonb_build_object(
    'source', 'atlas-cron-methodology',
    'state', 'requires_source_adapter_and_parity',
    'grain', specs.grain,
    'timeZone', 'UTC',
    'periodBoundaries', 'half_open',
    'watermarkPolicy', 'oldest_complete_required_source',
    'requiredSources', specs.required_sources,
    'outputs', specs.outputs,
    'requiredVerification', specs.verification
  )),
  'table',
  '{}'::jsonb,
  'atlas-cron-migration',
  CURRENT_TIMESTAMP
FROM specs
ON CONFLICT (id) DO NOTHING;
