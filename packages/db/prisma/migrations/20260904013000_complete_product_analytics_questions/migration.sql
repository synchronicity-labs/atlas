INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-product-analytics-source',
  'atlas:product-analytics',
  'ATLAS',
  'Atlas product analytics',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "kind" = EXCLUDED."kind",
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "dataSource" (
  "id", "key", "kind", "label", "state", "createdAt", "updatedAt"
) VALUES (
  'atlas-product-analytics-metabase-source',
  'metabase:product-analytics',
  'METABASE',
  'Product analytics Postgres reports',
  'UNCONFIGURED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "kind" = EXCLUDED."kind",
  "label" = EXCLUDED."label",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "question"
SET
  "connector" = 'METABASE',
  "sourceId" = 'atlas-product-analytics-metabase-source',
  "databaseExternalId" = '34',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'atlas-product-analytics-generation-feedback',
  'atlas-product-analytics-failure-rejection',
  'atlas-product-analytics-attribution-outcome',
  'atlas-product-analytics-cohort-outcomes'
);

UPDATE "question"
SET
  "connector" = 'ATLAS',
  "sourceId" = 'atlas-product-analytics-source',
  "sourceExternalId" = 'atlas:product-analytics:organization-lifecycle',
  "sourceDashboardExternalId" = 'atlas:product-analytics',
  "databaseExternalId" = NULL,
  "description" = 'Monthly organization lifecycle with separate product-use, professional-qualification, and subscription series. It includes retained, churned, returned, requalified, and resubscribed organization counts. Product and professional return-rate denominators remain null until a persistent lapsed-population mart is available. Filters include organization segment, billing version, signup cohort, plan, period, and horizon.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-analytics-organization-lifecycle';

UPDATE "question"
SET
  "description" = 'First-touch acquisition cohorts joined to signup, first completed generation, activation, professional qualification, paid conversion, W1 and W2 generation retention, M1 and M3 professional retention, and three-month accrued and paid revenue per organization. It exposes source, UTM, referring-domain, landing-subdomain, first-touch date, first model, surface, workflow, organization segment, billing version, unknown coverage, and a complete UTC watermark.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-analytics-attribution-outcome';

UPDATE "question"
SET
  "description" = 'Matched Billing V2 control and V3 treatment scorecard. Summary rows include eligible and paid organizations, conversion, cash per paid-organization month, 30-day and 60-day subscription retention and churn, implied cash LTV, top-ups, cancellations, renewal maturity and rate, and failed-invoice counts and amounts. Tier and cancellation-reason rows reconcile to each experiment arm.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-analytics-billing-scorecard';

UPDATE "question"
SET
  "description" = 'Signup cohorts joined to first product exposure, first model, surface, workflow, organization segment, billing version, first-generation completion, W1, W2, M1, and M3 generation retention, M1 and M3 professional retention, professional qualification, paid conversion, and three-month accrued and paid revenue per organization. Every rate uses an explicit mature-cohort denominator and one complete UTC watermark.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-analytics-cohort-outcomes';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-product-analytics-organization-lifecycle-v4',
  'atlas-product-analytics-organization-lifecycle', 4, 'API',
  '{"source":"product_analytics","report":"organization-lifecycle","version":1}',
  'table', '{"columns":["period_start","lifecycle_series","organization_segment","billing_version","signup_cohort","plan","horizon","starting_organizations","retained_organizations","retention_pct","churned_organizations","churn_pct","returned_organizations","return_pct","requalified_organizations","requalification_pct","resubscription_eligible_organizations","resubscribed_organizations","resubscription_pct","new_organizations","went_dark_organizations","below_gate_organizations","converted_organizations","closing_accrued_value_usd","closing_paid_value_usd","data_through"]}'::jsonb,
  NULL, 'atlas-product-analytics-completion', CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-product-analytics-billing-scorecard-v3',
  'atlas-product-analytics-billing-scorecard', 3, 'API',
  '{"source":"billing_experiment","report":"live-scorecard"}',
  'table', '{}'::jsonb,
  NULL, 'atlas-product-analytics-completion', CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-product-analytics-attribution-outcome-v4',
  'atlas-product-analytics-attribution-outcome', 4, 'SQL',
  $q300_complete$
WITH cohort AS (
  SELECT
    o.id,
    o.created_at AS signup_at,
    date_trunc('month', o.created_at)::date AS signup_cohort,
    coalesce(nullif(o.attribution->>'source', ''), 'unknown') AS first_touch_source,
    coalesce(nullif(o.attribution->>'utm_source', ''), '(none)') AS utm_source,
    coalesce(nullif(o.attribution->>'utm_medium', ''), '(none)') AS utm_medium,
    coalesce(nullif(o.attribution->>'utm_campaign', ''), '(none)') AS campaign,
    coalesce(nullif(o.attribution->>'landing_subdomain', ''), '(none)') AS landing_subdomain,
    coalesce(nullif(o.attribution->>'referring_domain', ''), '(none)') AS referring_domain,
    CASE
      WHEN nullif(o.attribution->>'first_touch_at', '') IS NULL THEN NULL
      ELSE (o.attribution->>'first_touch_at')::timestamptz::date
    END AS first_touch_date,
    coalesce(nullif(o.billing_version, ''), 'v2') AS billing_version,
    o.first_subscribed_at
  FROM public.organizations o
  WHERE o.created_at >= date_trunc('month', current_date) - interval '6 months'
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_organizations uo
      JOIN auth.users u ON u.id = uo.user_id
      WHERE uo.organization_id = o.id
        AND uo.role = 'owner'
        AND (
          coalesce(u.banned, false)
          OR coalesce(u.disabled, false)
          OR coalesce(u.is_anonymous, false)
          OR lower(coalesce(u.email, '')) LIKE '%@sync.so'
          OR lower(coalesce(u.email, '')) LIKE '%@sync.labs'
        )
    )
),
generation_outcomes AS (
  SELECT
    g.organization_id,
    min(g.finished_at) AS first_generation_at,
    (array_agg(coalesce(nullif(g.model_name, ''), '(none)') ORDER BY g.finished_at, g.id))[1] AS first_model,
    (array_agg(
      CASE
        WHEN g.api_key_id IS NOT NULL OR lower(coalesce(g.source, '')) = 'api' THEN 'api'
        WHEN lower(coalesce(g.source, '')) LIKE 'studio%' THEN 'studio'
        WHEN lower(coalesce(g.source, '')) LIKE '%plugin%' THEN 'plugin'
        WHEN lower(coalesce(g.source, '')) LIKE 'mcp%' THEN 'mcp'
        WHEN lower(coalesce(g.source, '')) = 'agent' THEN 'agent'
        ELSE coalesce(nullif(lower(g.source), ''), '(none)')
      END
      ORDER BY g.finished_at, g.id
    ))[1] AS first_surface,
    (array_agg(
      coalesce(g.metadata->>'workflow', g.metadata->>'workflowInferred', '(unstamped)')
      ORDER BY g.finished_at, g.id
    ))[1] AS first_workflow,
    count(*) FILTER (WHERE g.created_at < c.signup_at + interval '30 days') AS completed_first_30d,
    count(DISTINCT g.created_at::date) FILTER (WHERE g.created_at < c.signup_at + interval '30 days') AS active_days_first_30d,
    bool_or(g.created_at >= c.signup_at + interval '7 days' AND g.created_at < c.signup_at + interval '14 days') AS retained_w1,
    bool_or(g.created_at >= c.signup_at + interval '14 days' AND g.created_at < c.signup_at + interval '21 days') AS retained_w2,
    count(*) FILTER (WHERE g.api_key_id IS NOT NULL OR lower(coalesce(g.source, '')) = 'api') AS api_generations,
    count(*) FILTER (WHERE g.api_key_id IS NULL AND lower(coalesce(g.source, '')) <> 'api') AS app_generations
  FROM public.generations g
  JOIN cohort c ON c.id = g.organization_id
  WHERE g.deleted_at IS NULL
    AND g.status = 'COMPLETED'
    AND g.created_at >= date_trunc('month', current_date) - interval '6 months'
  GROUP BY g.organization_id
),
professional_outcomes AS (
  SELECT
    m.organization_id,
    min(m.month) FILTER (WHERE m.state IN ('new', 'expansion', 'flat', 'contraction', 'reactivation')) AS first_professional_month,
    bool_or(
      m.state IN ('new', 'expansion', 'flat', 'contraction', 'reactivation')
      AND m.month = date_trunc('month', c.signup_at) + interval '1 month'
    ) AS retained_m1,
    bool_or(
      m.state IN ('new', 'expansion', 'flat', 'contraction', 'reactivation')
      AND m.month = date_trunc('month', c.signup_at) + interval '3 months'
    ) AS retained_m3,
    sum(m.accrued_usd) FILTER (
      WHERE m.month >= date_trunc('month', c.signup_at)
        AND m.month < date_trunc('month', c.signup_at) + interval '3 months'
    ) AS accrued_revenue_usd,
    sum(m.paid_usd) FILTER (
      WHERE m.month >= date_trunc('month', c.signup_at)
        AND m.month < date_trunc('month', c.signup_at) + interval '3 months'
    ) AS paid_revenue_usd
  FROM public.org_movement_months m
  JOIN cohort c ON c.id = m.organization_id
  WHERE m.is_clean
  GROUP BY m.organization_id
),
base AS (
  SELECT
    c.*,
    g.first_generation_at,
    coalesce(g.first_model, '(none)') AS first_model,
    coalesce(g.first_surface, '(none)') AS first_surface,
    coalesce(g.first_workflow, '(unstamped)') AS first_workflow,
    CASE
      WHEN g.api_generations > 0 AND g.app_generations > 0 THEN 'mixed'
      WHEN g.api_generations > 0 THEN 'api'
      WHEN g.app_generations > 0 THEN 'app'
      ELSE 'no_completed_generation'
    END AS organization_segment,
    g.completed_first_30d,
    g.active_days_first_30d,
    g.retained_w1,
    g.retained_w2,
    p.first_professional_month,
    p.retained_m1,
    p.retained_m3,
    coalesce(p.accrued_revenue_usd, 0) AS accrued_revenue_usd,
    coalesce(p.paid_revenue_usd, 0) AS paid_revenue_usd
  FROM cohort c
  LEFT JOIN generation_outcomes g ON g.organization_id = c.id
  LEFT JOIN professional_outcomes p ON p.organization_id = c.id
)
SELECT
  signup_cohort,
  first_touch_source,
  utm_source,
  utm_medium,
  campaign,
  landing_subdomain,
  referring_domain,
  first_touch_date,
  first_model,
  first_surface,
  first_workflow,
  organization_segment,
  billing_version,
  count(*)::bigint AS signups,
  count(*) FILTER (WHERE first_generation_at IS NOT NULL)::bigint AS first_generations,
  round(100.0 * count(*) FILTER (WHERE first_generation_at IS NOT NULL) / nullif(count(*), 0), 2) AS first_generation_pct,
  count(*) FILTER (WHERE completed_first_30d >= 3 AND active_days_first_30d >= 2)::bigint AS activated_organizations,
  round(100.0 * count(*) FILTER (WHERE completed_first_30d >= 3 AND active_days_first_30d >= 2) / nullif(count(*), 0), 2) AS activation_pct,
  count(*) FILTER (WHERE first_professional_month IS NOT NULL)::bigint AS professional_organizations,
  round(100.0 * count(*) FILTER (WHERE first_professional_month IS NOT NULL) / nullif(count(*), 0), 2) AS professional_pct,
  count(*) FILTER (WHERE first_subscribed_at IS NOT NULL)::bigint AS paid_conversions,
  round(100.0 * count(*) FILTER (WHERE first_subscribed_at IS NOT NULL) / nullif(count(*), 0), 2) AS paid_conversion_pct,
  round(100.0 * count(*) FILTER (WHERE retained_w1 AND signup_at <= now() - interval '14 days') / nullif(count(*) FILTER (WHERE signup_at <= now() - interval '14 days'), 0), 2) AS w1_generation_retention_pct,
  round(100.0 * count(*) FILTER (WHERE retained_w2 AND signup_at <= now() - interval '21 days') / nullif(count(*) FILTER (WHERE signup_at <= now() - interval '21 days'), 0), 2) AS w2_generation_retention_pct,
  round(100.0 * count(*) FILTER (WHERE retained_m1 AND date_trunc('month', signup_at) + interval '2 months' <= date_trunc('month', current_date)) / nullif(count(*) FILTER (WHERE date_trunc('month', signup_at) + interval '2 months' <= date_trunc('month', current_date)), 0), 2) AS m1_professional_retention_pct,
  round(100.0 * count(*) FILTER (WHERE retained_m3 AND date_trunc('month', signup_at) + interval '4 months' <= date_trunc('month', current_date)) / nullif(count(*) FILTER (WHERE date_trunc('month', signup_at) + interval '4 months' <= date_trunc('month', current_date)), 0), 2) AS m3_professional_retention_pct,
  round(sum(accrued_revenue_usd) / nullif(count(*), 0), 2) AS accrued_revenue_per_organization_usd,
  round(sum(paid_revenue_usd) / nullif(count(*), 0), 2) AS paid_revenue_per_organization_usd,
  count(*) FILTER (WHERE first_touch_source = 'unknown')::bigint AS unknown_attribution_organizations,
  round(100.0 * count(*) FILTER (WHERE first_touch_source = 'unknown') / nullif(count(*), 0), 2) AS unknown_attribution_pct,
  date_trunc('month', current_date)::date AS data_through
FROM base
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
HAVING count(*) >= 5
ORDER BY signup_cohort, signups DESC
  $q300_complete$,
  'table', '{"columns":["signup_cohort","first_touch_source","utm_source","utm_medium","campaign","landing_subdomain","referring_domain","first_touch_date","first_model","first_surface","first_workflow","organization_segment","billing_version","signups","first_generations","first_generation_pct","activated_organizations","activation_pct","professional_organizations","professional_pct","paid_conversions","paid_conversion_pct","w1_generation_retention_pct","w2_generation_retention_pct","m1_professional_retention_pct","m3_professional_retention_pct","accrued_revenue_per_organization_usd","paid_revenue_per_organization_usd","unknown_attribution_organizations","unknown_attribution_pct","data_through"]}'::jsonb,
  NULL, 'atlas-product-analytics-completion', CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-product-analytics-cohort-outcomes-v4',
  'atlas-product-analytics-cohort-outcomes', 4, 'SQL',
  $q302_complete$
WITH cohort AS (
  SELECT
    o.id,
    o.created_at AS signup_at,
    date_trunc('month', o.created_at)::date AS signup_cohort,
    o.first_subscribed_at,
    coalesce(nullif(o.billing_version, ''), 'v2') AS billing_version
  FROM public.organizations o
  WHERE o.created_at >= date_trunc('month', current_date) - interval '6 months'
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_organizations uo
      JOIN auth.users u ON u.id = uo.user_id
      WHERE uo.organization_id = o.id
        AND uo.role = 'owner'
        AND (
          coalesce(u.banned, false)
          OR coalesce(u.disabled, false)
          OR coalesce(u.is_anonymous, false)
          OR lower(coalesce(u.email, '')) LIKE '%@sync.so'
          OR lower(coalesce(u.email, '')) LIKE '%@sync.labs'
        )
    )
),
generation_outcomes AS (
  SELECT
    g.organization_id,
    min(g.created_at) AS first_product_exposure,
    (array_agg(coalesce(nullif(g.model_name, ''), '(none)') ORDER BY g.finished_at, g.id))[1] AS first_model,
    (array_agg(
      CASE
        WHEN g.api_key_id IS NOT NULL OR lower(coalesce(g.source, '')) = 'api' THEN 'api'
        WHEN lower(coalesce(g.source, '')) LIKE 'studio%' THEN 'studio'
        WHEN lower(coalesce(g.source, '')) LIKE '%plugin%' THEN 'plugin'
        WHEN lower(coalesce(g.source, '')) LIKE 'mcp%' THEN 'mcp'
        WHEN lower(coalesce(g.source, '')) = 'agent' THEN 'agent'
        ELSE coalesce(nullif(lower(g.source), ''), '(none)')
      END
      ORDER BY g.finished_at, g.id
    ))[1] AS first_surface,
    (array_agg(
      coalesce(g.metadata->>'workflow', g.metadata->>'workflowInferred', '(unstamped)')
      ORDER BY g.finished_at, g.id
    ))[1] AS first_workflow,
    count(*) AS completed_generations,
    count(*) FILTER (WHERE g.api_key_id IS NOT NULL OR lower(coalesce(g.source, '')) = 'api') AS api_generations,
    count(*) FILTER (WHERE g.api_key_id IS NULL AND lower(coalesce(g.source, '')) <> 'api') AS app_generations,
    bool_or(g.created_at >= c.signup_at + interval '7 days' AND g.created_at < c.signup_at + interval '14 days') AS retained_w1,
    bool_or(g.created_at >= c.signup_at + interval '14 days' AND g.created_at < c.signup_at + interval '21 days') AS retained_w2,
    bool_or(g.created_at >= c.signup_at + interval '30 days' AND g.created_at < c.signup_at + interval '60 days') AS retained_m1,
    bool_or(g.created_at >= c.signup_at + interval '90 days' AND g.created_at < c.signup_at + interval '120 days') AS retained_m3
  FROM public.generations g
  JOIN cohort c ON c.id = g.organization_id
  WHERE g.deleted_at IS NULL
    AND g.status = 'COMPLETED'
    AND g.created_at >= date_trunc('month', current_date) - interval '6 months'
  GROUP BY g.organization_id
),
movement_outcomes AS (
  SELECT
    m.organization_id,
    min(m.month) FILTER (WHERE m.state IN ('new', 'expansion', 'flat', 'contraction', 'reactivation')) AS first_professional_month,
    bool_or(
      m.state IN ('new', 'expansion', 'flat', 'contraction', 'reactivation')
      AND m.month = date_trunc('month', c.signup_at) + interval '1 month'
    ) AS retained_professional_m1,
    bool_or(
      m.state IN ('new', 'expansion', 'flat', 'contraction', 'reactivation')
      AND m.month = date_trunc('month', c.signup_at) + interval '3 months'
    ) AS retained_professional_m3,
    sum(m.accrued_usd) FILTER (
      WHERE m.month >= date_trunc('month', c.signup_at)
        AND m.month < date_trunc('month', c.signup_at) + interval '3 months'
    ) AS accrued_revenue_usd,
    sum(m.paid_usd) FILTER (
      WHERE m.month >= date_trunc('month', c.signup_at)
        AND m.month < date_trunc('month', c.signup_at) + interval '3 months'
    ) AS paid_revenue_usd
  FROM public.org_movement_months m
  JOIN cohort c ON c.id = m.organization_id
  WHERE m.is_clean
  GROUP BY m.organization_id
),
base AS (
  SELECT
    c.*,
    g.first_product_exposure,
    coalesce(g.first_model, '(none)') AS model,
    coalesce(g.first_surface, '(none)') AS surface,
    coalesce(g.first_workflow, '(unstamped)') AS workflow,
    CASE
      WHEN g.api_generations > 0 AND g.app_generations > 0 THEN 'mixed'
      WHEN g.api_generations > 0 THEN 'api'
      WHEN g.app_generations > 0 THEN 'app'
      ELSE 'no_completed_generation'
    END AS organization_segment,
    coalesce(g.completed_generations, 0) AS completed_generations,
    coalesce(g.retained_w1, false) AS retained_w1,
    coalesce(g.retained_w2, false) AS retained_w2,
    coalesce(g.retained_m1, false) AS retained_m1,
    coalesce(g.retained_m3, false) AS retained_m3,
    m.first_professional_month,
    coalesce(m.retained_professional_m1, false) AS retained_professional_m1,
    coalesce(m.retained_professional_m3, false) AS retained_professional_m3,
    coalesce(m.accrued_revenue_usd, 0) AS accrued_revenue_usd,
    coalesce(m.paid_revenue_usd, 0) AS paid_revenue_usd
  FROM cohort c
  LEFT JOIN generation_outcomes g ON g.organization_id = c.id
  LEFT JOIN movement_outcomes m ON m.organization_id = c.id
),
grouped AS (
  SELECT
    signup_cohort,
    date_trunc('month', first_product_exposure)::date AS first_product_exposure,
    organization_segment,
    model,
    surface,
    workflow,
    billing_version,
    count(*)::bigint AS cohort_size,
    count(*) FILTER (WHERE completed_generations > 0)::bigint AS first_generation_organizations,
    count(*) FILTER (WHERE retained_w1 AND signup_at <= now() - interval '14 days')::bigint AS retained_w1,
    count(*) FILTER (WHERE retained_w2 AND signup_at <= now() - interval '21 days')::bigint AS retained_w2,
    count(*) FILTER (WHERE retained_m1 AND signup_at <= now() - interval '60 days')::bigint AS retained_m1,
    count(*) FILTER (WHERE retained_m3 AND signup_at <= now() - interval '120 days')::bigint AS retained_m3,
    count(*) FILTER (WHERE signup_at <= now() - interval '14 days')::bigint AS mature_w1,
    count(*) FILTER (WHERE signup_at <= now() - interval '21 days')::bigint AS mature_w2,
    count(*) FILTER (WHERE signup_at <= now() - interval '60 days')::bigint AS mature_m1,
    count(*) FILTER (WHERE signup_at <= now() - interval '120 days')::bigint AS mature_m3,
    count(*) FILTER (WHERE first_professional_month IS NOT NULL)::bigint AS professional_organizations,
    count(*) FILTER (WHERE retained_professional_m1 AND date_trunc('month', signup_at) + interval '2 months' <= date_trunc('month', current_date))::bigint AS retained_professional_m1,
    count(*) FILTER (WHERE retained_professional_m3 AND date_trunc('month', signup_at) + interval '4 months' <= date_trunc('month', current_date))::bigint AS retained_professional_m3,
    count(*) FILTER (WHERE date_trunc('month', signup_at) + interval '2 months' <= date_trunc('month', current_date))::bigint AS mature_professional_m1,
    count(*) FILTER (WHERE date_trunc('month', signup_at) + interval '4 months' <= date_trunc('month', current_date))::bigint AS mature_professional_m3,
    count(*) FILTER (WHERE first_subscribed_at IS NOT NULL)::bigint AS paid_conversions,
    sum(accrued_revenue_usd) AS accrued_revenue_usd,
    sum(paid_revenue_usd) AS paid_revenue_usd
  FROM base
  GROUP BY 1, 2, 3, 4, 5, 6, 7
)
SELECT
  signup_cohort,
  first_product_exposure,
  organization_segment,
  model,
  surface,
  workflow,
  billing_version,
  cohort_size,
  round(100.0 * first_generation_organizations / nullif(cohort_size, 0), 2) AS first_generation_completion_pct,
  round(
    100.0 * cohort_size
    / nullif(sum(cohort_size) OVER (PARTITION BY signup_cohort, organization_segment, billing_version), 0),
    2
  ) AS model_workflow_adoption_pct,
  round(100.0 * retained_w1 / nullif(mature_w1, 0), 2) AS w1_generation_retention_pct,
  round(100.0 * retained_w2 / nullif(mature_w2, 0), 2) AS w2_generation_retention_pct,
  round(100.0 * retained_m1 / nullif(mature_m1, 0), 2) AS m1_generation_retention_pct,
  round(100.0 * retained_m3 / nullif(mature_m3, 0), 2) AS m3_generation_retention_pct,
  round(100.0 * retained_professional_m1 / nullif(mature_professional_m1, 0), 2) AS m1_professional_retention_pct,
  round(100.0 * retained_professional_m3 / nullif(mature_professional_m3, 0), 2) AS m3_professional_retention_pct,
  round(100.0 * professional_organizations / nullif(cohort_size, 0), 2) AS professional_qualification_pct,
  round(100.0 * paid_conversions / nullif(cohort_size, 0), 2) AS paid_conversion_pct,
  round(accrued_revenue_usd / nullif(cohort_size, 0), 2) AS accrued_revenue_per_organization_usd,
  round(paid_revenue_usd / nullif(cohort_size, 0), 2) AS paid_revenue_per_organization_usd,
  mature_w1,
  mature_w2,
  mature_m1,
  mature_m3,
  mature_professional_m1,
  mature_professional_m3,
  date_trunc('month', current_date)::date AS data_through
FROM grouped
WHERE cohort_size >= 5
ORDER BY signup_cohort, cohort_size DESC
  $q302_complete$,
  'table', '{"columns":["signup_cohort","first_product_exposure","organization_segment","model","surface","workflow","billing_version","cohort_size","first_generation_completion_pct","model_workflow_adoption_pct","w1_generation_retention_pct","w2_generation_retention_pct","m1_generation_retention_pct","m3_generation_retention_pct","m1_professional_retention_pct","m3_professional_retention_pct","professional_qualification_pct","paid_conversion_pct","accrued_revenue_per_organization_usd","paid_revenue_per_organization_usd","mature_w1","mature_w2","mature_m1","mature_m3","mature_professional_m1","mature_professional_m3","data_through"]}'::jsonb,
  NULL, 'atlas-product-analytics-completion', CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO NOTHING;

INSERT INTO "dashboardTab" (
  "id", "dashboardId", "number", "name", "position", "sourceExternalId"
)
SELECT
  'atlas-product-tab-analytics-coverage',
  "id",
  11,
  'Analytics coverage',
  10,
  'atlas:product-analytics'
FROM "dashboard"
WHERE "number" = 1
ON CONFLICT ("dashboardId", "number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "sourceExternalId" = EXCLUDED."sourceExternalId";

INSERT INTO "dashboardCard" (
  "id", "dashboardId", "tabId", "questionId", "position", "x", "y",
  "width", "height", "visualization", "displaySettings", "createdAt", "updatedAt"
)
SELECT
  values."id",
  dashboard."id",
  tab."id",
  values."questionId",
  values."position",
  values."x",
  values."y",
  values."width",
  values."height",
  'TABLE'::"VisualizationType",
  '{}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    ('atlas-product-card-organization-lifecycle', 'atlas-product-analytics-organization-lifecycle', 0, 0, 0, 24, 10),
    ('atlas-product-card-generation-feedback', 'atlas-product-analytics-generation-feedback', 1, 0, 10, 12, 10),
    ('atlas-product-card-failure-rejection', 'atlas-product-analytics-failure-rejection', 2, 12, 10, 12, 10),
    ('atlas-product-card-attribution-outcome', 'atlas-product-analytics-attribution-outcome', 3, 0, 20, 24, 10),
    ('atlas-product-card-billing-scorecard', 'atlas-product-analytics-billing-scorecard', 4, 0, 30, 24, 10),
    ('atlas-product-card-cohort-outcomes', 'atlas-product-analytics-cohort-outcomes', 5, 0, 40, 24, 10)
) AS values("id", "questionId", "position", "x", "y", "width", "height")
CROSS JOIN "dashboard" dashboard
JOIN "dashboardTab" tab
  ON tab."dashboardId" = dashboard."id" AND tab."number" = 11
WHERE dashboard."number" = 1
ON CONFLICT ("id") DO UPDATE SET
  "tabId" = EXCLUDED."tabId",
  "position" = EXCLUDED."position",
  "x" = EXCLUDED."x",
  "y" = EXCLUDED."y",
  "width" = EXCLUDED."width",
  "height" = EXCLUDED."height",
  "visualization" = EXCLUDED."visualization",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1;
