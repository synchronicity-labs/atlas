UPDATE "question"
SET
  "connector" = 'METABASE',
  "sourceId" = 'atlas-metabase-source',
  "databaseExternalId" = '34',
  "sourceDashboardExternalId" = NULL,
  "status" = 'ACTIVE',
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'atlas-product-analytics-organization-lifecycle',
  'atlas-product-analytics-generation-feedback',
  'atlas-product-analytics-failure-rejection',
  'atlas-product-analytics-attribution-outcome',
  'atlas-product-analytics-cohort-outcomes'
);

UPDATE "question"
SET
  "connector" = 'ATLAS',
  "sourceId" = 'atlas-billing-experiment-source',
  "databaseExternalId" = NULL,
  "sourceDashboardExternalId" = NULL,
  "status" = 'ACTIVE',
  "purpose" = 'RECONCILIATION',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-analytics-billing-scorecard';

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES
  (
    'atlas-product-analytics-organization-lifecycle-v2',
    'atlas-product-analytics-organization-lifecycle', 2, 'SQL',
    $q297$
WITH bounds AS (
  SELECT
    date_trunc('month', current_date) - interval '6 months' AS period_start,
    date_trunc('month', current_date) AS period_end
),
dirty_organizations AS (
  SELECT DISTINCT uo.organization_id
  FROM public.user_organizations uo
  JOIN auth.users u ON u.id = uo.user_id
  WHERE uo.role = 'owner'
    AND (
      coalesce(u.banned, false)
      OR coalesce(u.disabled, false)
      OR coalesce(u.is_anonymous, false)
      OR lower(coalesce(u.email, '')) LIKE '%@sync.so'
      OR lower(coalesce(u.email, '')) LIKE '%@sync.labs'
    )
),
product_organization_months AS (
  SELECT
    date_trunc('month', g.created_at)::date AS month,
    g.organization_id,
    coalesce(nullif(o.billing_version, ''), 'v2') AS billing_version,
    CASE
      WHEN bool_and(g.api_key_id IS NOT NULL OR lower(coalesce(g.source, '')) = 'api') THEN 'api'
      WHEN bool_and(g.api_key_id IS NULL AND lower(coalesce(g.source, '')) <> 'api') THEN 'app'
      ELSE 'mixed'
    END AS organization_segment
  FROM public.generations g
  CROSS JOIN bounds b
  LEFT JOIN public.organizations o ON o.id = g.organization_id
  WHERE g.organization_id IS NOT NULL
    AND g.deleted_at IS NULL
    AND g.status = 'COMPLETED'
    AND g.created_at >= b.period_start - interval '1 month'
    AND g.created_at < b.period_end + interval '1 month'
    AND NOT EXISTS (
      SELECT 1 FROM dirty_organizations d WHERE d.organization_id = g.organization_id
    )
  GROUP BY 1, 2, 3
),
product_classified AS (
  SELECT
    current_month.month,
    current_month.organization_id,
    current_month.organization_segment,
    current_month.billing_version,
    next_month.organization_id IS NOT NULL AS retained,
    previous_month.organization_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM product_organization_months history
        WHERE history.organization_id = current_month.organization_id
          AND history.month < current_month.month - interval '1 month'
      ) AS returned
  FROM product_organization_months current_month
  CROSS JOIN bounds b
  LEFT JOIN product_organization_months next_month
    ON next_month.organization_id = current_month.organization_id
    AND next_month.month = current_month.month + interval '1 month'
  LEFT JOIN product_organization_months previous_month
    ON previous_month.organization_id = current_month.organization_id
    AND previous_month.month = current_month.month - interval '1 month'
  WHERE current_month.month >= b.period_start
    AND current_month.month < b.period_end
),
product_rollup AS (
  SELECT
    month AS period_start,
    'product_usage'::text AS lifecycle_series,
    organization_segment,
    billing_version,
    'M1'::text AS horizon,
    count(*)::bigint AS starting_organizations,
    count(*) FILTER (WHERE retained)::bigint AS retained_organizations,
    round(100.0 * count(*) FILTER (WHERE retained) / nullif(count(*), 0), 2) AS retention_pct,
    count(*) FILTER (WHERE NOT retained)::bigint AS churned_organizations,
    round(100.0 * count(*) FILTER (WHERE NOT retained) / nullif(count(*), 0), 2) AS churn_pct,
    count(*) FILTER (WHERE returned)::bigint AS returned_organizations,
    round(100.0 * count(*) FILTER (WHERE returned) / nullif(count(*), 0), 2) AS return_pct,
    NULL::bigint AS requalified_organizations,
    NULL::numeric AS requalification_pct,
    NULL::bigint AS resubscribed_organizations,
    NULL::numeric AS resubscription_pct
  FROM product_classified
  GROUP BY 1, 2, 3, 4, 5
),
movement AS (
  SELECT
    m.month,
    m.organization_id,
    m.state,
    m.churn_type,
    coalesce(nullif(m.billing_version, ''), 'v2') AS billing_version,
    CASE
      WHEN m.state = 'churn' AND previous.billable_generations > 0 THEN
        CASE
          WHEN previous.api_generations = 0 THEN 'app'
          WHEN previous.api_generations >= previous.billable_generations THEN 'api'
          ELSE 'mixed'
        END
      WHEN m.api_generations = 0 THEN 'app'
      WHEN m.api_generations >= m.billable_generations THEN 'api'
      ELSE 'mixed'
    END AS organization_segment
  FROM public.org_movement_months m
  CROSS JOIN bounds b
  LEFT JOIN public.org_movement_months previous
    ON previous.organization_id = m.organization_id
    AND previous.month = m.month - interval '1 month'
  WHERE m.month >= b.period_start
    AND m.month < b.period_end
    AND m.is_clean
    AND NOT m.is_partial
),
professional_rollup AS (
  SELECT
    month AS period_start,
    'professional_qualification'::text AS lifecycle_series,
    organization_segment,
    billing_version,
    'M1'::text AS horizon,
    count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction', 'churn'))::bigint AS starting_organizations,
    count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction'))::bigint AS retained_organizations,
    round(
      100.0 * count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction'))
      / nullif(count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction', 'churn')), 0),
      2
    ) AS retention_pct,
    count(*) FILTER (WHERE state = 'churn')::bigint AS churned_organizations,
    round(
      100.0 * count(*) FILTER (WHERE state = 'churn')
      / nullif(count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction', 'churn')), 0),
      2
    ) AS churn_pct,
    count(*) FILTER (WHERE state = 'reactivation')::bigint AS returned_organizations,
    round(
      100.0 * count(*) FILTER (WHERE state = 'reactivation')
      / nullif(count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction', 'churn')), 0),
      2
    ) AS return_pct,
    count(*) FILTER (WHERE state = 'reactivation')::bigint AS requalified_organizations,
    round(
      100.0 * count(*) FILTER (WHERE state = 'reactivation')
      / nullif(count(*) FILTER (WHERE state IN ('expansion', 'flat', 'contraction', 'churn')), 0),
      2
    ) AS requalification_pct,
    NULL::bigint AS resubscribed_organizations,
    NULL::numeric AS resubscription_pct
  FROM movement
  GROUP BY 1, 2, 3, 4, 5
)
SELECT *, date_trunc('month', current_date)::date AS data_through
FROM product_rollup
UNION ALL
SELECT *, date_trunc('month', current_date)::date AS data_through
FROM professional_rollup
ORDER BY period_start, lifecycle_series, organization_segment, billing_version
    $q297$,
    'table', '{"columns":["period_start","lifecycle_series","organization_segment","billing_version","horizon","starting_organizations","retained_organizations","retention_pct","churned_organizations","churn_pct","returned_organizations","return_pct","requalified_organizations","requalification_pct","resubscribed_organizations","resubscription_pct","data_through"]}'::jsonb,
    NULL, 'atlas-product-analytics-materialization', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-generation-feedback-v2',
    'atlas-product-analytics-generation-feedback', 2, 'SQL',
    $q298$
WITH bounds AS (
  SELECT greatest(now() - interval '90 days', timestamptz '2026-06-03') AS period_start
),
dirty_users AS (
  SELECT id
  FROM auth.users
  WHERE coalesce(banned, false)
    OR coalesce(disabled, false)
    OR coalesce(is_anonymous, false)
    OR lower(coalesce(email, '')) LIKE '%@sync.so'
    OR lower(coalesce(email, '')) LIKE '%@sync.labs'
),
first_completed AS (
  SELECT DISTINCT ON (organization_id)
    organization_id,
    id AS generation_id
  FROM public.generations
  WHERE organization_id IS NOT NULL
    AND deleted_at IS NULL
    AND status = 'COMPLETED'
  ORDER BY organization_id, finished_at, id
),
eligible AS (
  SELECT
    g.id,
    g.organization_id,
    date_trunc('month', g.finished_at)::date AS period_start,
    coalesce(g.model_name, '(none)') AS model,
    CASE
      WHEN g.api_key_id IS NOT NULL OR lower(coalesce(g.source, '')) = 'api' THEN 'api'
      WHEN lower(coalesce(g.source, '')) LIKE 'studio%' THEN 'studio'
      WHEN lower(coalesce(g.source, '')) LIKE '%plugin%' THEN 'plugin'
      WHEN lower(coalesce(g.source, '')) LIKE 'mcp%' THEN 'mcp'
      WHEN lower(coalesce(g.source, '')) = 'agent' THEN 'agent'
      ELSE coalesce(nullif(lower(g.source), ''), 'other')
    END AS surface,
    coalesce(g.metadata->>'syncMode', g.metadata->>'sync_mode', '(unset)') AS app_mode,
    coalesce(g.metadata->>'workflow', g.metadata->>'workflowInferred', '(unstamped)') AS workflow,
    CASE WHEN first_completed.generation_id = g.id THEN 'first' ELSE 'repeat' END AS generation_position,
    coalesce(nullif(o.billing_version, ''), 'v2') AS billing_version
  FROM public.generations g
  CROSS JOIN bounds b
  LEFT JOIN first_completed ON first_completed.organization_id = g.organization_id
  LEFT JOIN public.organizations o ON o.id = g.organization_id
  WHERE g.deleted_at IS NULL
    AND g.status = 'COMPLETED'
    AND g.finished_at >= b.period_start
    AND g.user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dirty_users d WHERE d.id = g.user_id)
),
organization_segments AS (
  SELECT
    organization_id,
    period_start,
    CASE
      WHEN bool_and(surface = 'api') THEN 'api'
      WHEN bool_and(surface <> 'api') THEN 'app'
      ELSE 'mixed'
    END AS organization_segment
  FROM eligible
  WHERE organization_id IS NOT NULL
  GROUP BY 1, 2
),
ratings AS (
  SELECT
    generation_id,
    (feedback_type = 'upvote') AS is_positive
  FROM public.generation_feedback
  WHERE user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dirty_users d WHERE d.id = generation_feedback.user_id)
  UNION ALL
  SELECT
    generation_id,
    (score >= 4) AS is_positive
  FROM public.generation_score
  WHERE user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dirty_users d WHERE d.id = generation_score.user_id)
),
rating_by_generation AS (
  SELECT
    generation_id,
    count(*)::bigint AS rating_events,
    count(*) FILTER (WHERE is_positive)::bigint AS positive_ratings,
    count(*) FILTER (WHERE NOT is_positive)::bigint AS negative_ratings
  FROM ratings
  GROUP BY 1
)
SELECT
  e.period_start,
  e.model,
  e.surface,
  e.app_mode,
  e.workflow,
  e.generation_position,
  coalesce(s.organization_segment, CASE WHEN e.surface = 'api' THEN 'api' ELSE 'app' END) AS organization_segment,
  e.billing_version,
  count(*)::bigint AS eligible_completed_generations,
  NULL::bigint AS feedback_exposures,
  count(*) FILTER (WHERE r.generation_id IS NOT NULL)::bigint AS rated_generations,
  round(100.0 * count(*) FILTER (WHERE r.generation_id IS NOT NULL) / nullif(count(*), 0), 2) AS coverage_pct,
  coalesce(sum(r.positive_ratings), 0)::bigint AS positive_ratings,
  coalesce(sum(r.negative_ratings), 0)::bigint AS negative_ratings,
  round(100.0 * sum(r.positive_ratings) / nullif(sum(r.rating_events), 0), 2) AS upvote_pct,
  round(100.0 * sum(r.negative_ratings) / nullif(sum(r.rating_events), 0), 2) AS downvote_pct,
  NULL::numeric AS downvote_abandonment_pct,
  now() AS data_through
FROM eligible e
LEFT JOIN organization_segments s
  ON s.organization_id = e.organization_id
  AND s.period_start = e.period_start
LEFT JOIN rating_by_generation r ON r.generation_id = e.id
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
HAVING count(*) >= 20
ORDER BY period_start, model, surface, workflow, generation_position
    $q298$,
    'table', '{"columns":["period_start","model","surface","app_mode","workflow","generation_position","organization_segment","billing_version","eligible_completed_generations","feedback_exposures","rated_generations","coverage_pct","positive_ratings","negative_ratings","upvote_pct","downvote_pct","downvote_abandonment_pct","data_through"]}'::jsonb,
    NULL, 'atlas-product-analytics-materialization', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-failure-rejection-v2',
    'atlas-product-analytics-failure-rejection', 2, 'SQL',
    $q299$
WITH dirty_users AS (
  SELECT id
  FROM auth.users
  WHERE coalesce(banned, false)
    OR coalesce(disabled, false)
    OR coalesce(is_anonymous, false)
    OR lower(coalesce(email, '')) LIKE '%@sync.so'
    OR lower(coalesce(email, '')) LIKE '%@sync.labs'
),
first_attempt AS (
  SELECT DISTINCT ON (organization_id)
    organization_id,
    id AS generation_id
  FROM public.generations
  WHERE organization_id IS NOT NULL
    AND deleted_at IS NULL
  ORDER BY organization_id, created_at, id
),
attempts AS (
  SELECT
    g.id,
    g.organization_id,
    date_trunc('month', g.created_at)::date AS period_start,
    g.status,
    coalesce(g.model_name, '(none)') AS model,
    CASE
      WHEN g.api_key_id IS NOT NULL OR lower(coalesce(g.source, '')) = 'api' THEN 'api'
      WHEN lower(coalesce(g.source, '')) LIKE 'studio%' THEN 'studio'
      WHEN lower(coalesce(g.source, '')) LIKE '%plugin%' THEN 'plugin'
      WHEN lower(coalesce(g.source, '')) LIKE 'mcp%' THEN 'mcp'
      WHEN lower(coalesce(g.source, '')) = 'agent' THEN 'agent'
      ELSE coalesce(nullif(lower(g.source), ''), 'other')
    END AS surface,
    coalesce(g.metadata->>'syncMode', g.metadata->>'sync_mode', '(unset)') AS app_mode,
    coalesce(g.metadata->>'workflow', g.metadata->>'workflowInferred', '(unstamped)') AS workflow,
    CASE WHEN first_attempt.generation_id = g.id THEN 'first' ELSE 'repeat' END AS generation_position,
    coalesce(nullif(o.billing_version, ''), 'v2') AS billing_version,
    CASE
      WHEN g.status = 'COMPLETED' THEN 'completed'
      ELSE coalesce(
        nullif(g.potential_error->>'code', ''),
        nullif(g.potential_error->>'errorCode', ''),
        nullif(g.potential_error->>'type', ''),
        nullif(g.potential_error->>'name', ''),
        'missing_reason'
      )
    END AS reason_code
  FROM public.generations g
  LEFT JOIN first_attempt ON first_attempt.organization_id = g.organization_id
  LEFT JOIN public.organizations o ON o.id = g.organization_id
  WHERE g.deleted_at IS NULL
    AND g.status IN ('COMPLETED', 'FAILED', 'REJECTED')
    AND g.created_at >= now() - interval '90 days'
    AND (
      g.user_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM dirty_users d WHERE d.id = g.user_id)
    )
),
organization_segments AS (
  SELECT
    organization_id,
    period_start,
    CASE
      WHEN bool_and(surface = 'api') THEN 'api'
      WHEN bool_and(surface <> 'api') THEN 'app'
      ELSE 'mixed'
    END AS organization_segment
  FROM attempts
  WHERE organization_id IS NOT NULL
  GROUP BY 1, 2
),
grouped AS (
  SELECT
    a.period_start,
    a.model,
    a.surface,
    a.app_mode,
    a.workflow,
    a.generation_position,
    coalesce(s.organization_segment, CASE WHEN a.surface = 'api' THEN 'api' ELSE 'app' END) AS organization_segment,
    a.billing_version,
    a.status,
    a.reason_code,
    CASE
      WHEN a.status = 'COMPLETED' THEN 'not_applicable'
      WHEN a.reason_code IN ('generation_infra_service_unavailable', 'generation_pipeline_failed') THEN 'retryable'
      WHEN a.reason_code LIKE 'generation_input_%' THEN 'non_retryable'
      ELSE 'unknown'
    END AS retryability,
    count(*)::bigint AS reason_count
  FROM attempts a
  LEFT JOIN organization_segments s
    ON s.organization_id = a.organization_id
    AND s.period_start = a.period_start
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
  HAVING count(*) >= 5
),
scored AS (
  SELECT
    *,
    sum(reason_count) OVER population AS attempts,
    sum(reason_count) FILTER (WHERE status = 'COMPLETED') OVER population AS completed_attempts,
    sum(reason_count) FILTER (WHERE status = 'FAILED') OVER population AS failed_attempts,
    sum(reason_count) FILTER (WHERE status = 'REJECTED') OVER population AS rejected_attempts,
    sum(reason_count) FILTER (WHERE status IN ('FAILED', 'REJECTED') AND reason_code <> 'missing_reason') OVER population AS structured_reason_attempts,
    sum(reason_count) FILTER (WHERE status IN ('FAILED', 'REJECTED')) OVER population AS terminal_error_attempts
  FROM grouped
  WINDOW population AS (
    PARTITION BY period_start, model, surface, app_mode, workflow, generation_position, organization_segment, billing_version
  )
)
SELECT
  period_start,
  model,
  surface,
  app_mode,
  workflow,
  generation_position,
  organization_segment,
  billing_version,
  status,
  reason_code,
  retryability,
  attempts,
  completed_attempts,
  failed_attempts,
  rejected_attempts,
  round(100.0 * completed_attempts / nullif(attempts, 0), 2) AS completion_pct,
  round(100.0 * failed_attempts / nullif(attempts, 0), 2) AS failure_pct,
  round(100.0 * rejected_attempts / nullif(attempts, 0), 2) AS rejection_pct,
  reason_count,
  round(100.0 * reason_count / nullif(attempts, 0), 2) AS reason_share_pct,
  round(100.0 * structured_reason_attempts / nullif(terminal_error_attempts, 0), 2) AS structured_reason_coverage_pct,
  now() AS data_through
FROM scored
ORDER BY period_start, model, surface, workflow, status, reason_count DESC
    $q299$,
    'table', '{"columns":["period_start","model","surface","app_mode","workflow","generation_position","organization_segment","billing_version","status","reason_code","retryability","attempts","completed_attempts","failed_attempts","rejected_attempts","completion_pct","failure_pct","rejection_pct","reason_count","reason_share_pct","structured_reason_coverage_pct","data_through"]}'::jsonb,
    NULL, 'atlas-product-analytics-materialization', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-attribution-outcome-v2',
    'atlas-product-analytics-attribution-outcome', 2, 'SQL',
    $q300$
WITH cohort AS (
  SELECT
    o.id,
    o.created_at AS signup_at,
    date_trunc('month', o.created_at)::date AS signup_cohort,
    coalesce(nullif(o.attribution->>'source', ''), 'unknown') AS first_touch_source,
    coalesce(nullif(o.attribution->>'utm_campaign', ''), '(none)') AS campaign,
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
    c.id AS organization_id,
    count(g.id) FILTER (WHERE g.status = 'COMPLETED') AS completed_generations,
    count(g.id) FILTER (
      WHERE g.status = 'COMPLETED' AND g.created_at < c.signup_at + interval '30 days'
    ) AS completed_first_30d,
    count(DISTINCT g.created_at::date) FILTER (
      WHERE g.status = 'COMPLETED' AND g.created_at < c.signup_at + interval '30 days'
    ) AS active_days_first_30d,
    bool_or(g.status = 'COMPLETED' AND g.created_at >= c.signup_at + interval '7 days' AND g.created_at < c.signup_at + interval '14 days') AS retained_w1,
    bool_or(g.status = 'COMPLETED' AND g.created_at >= c.signup_at + interval '14 days' AND g.created_at < c.signup_at + interval '21 days') AS retained_w2,
    bool_or(g.status = 'COMPLETED' AND g.created_at >= c.signup_at + interval '30 days' AND g.created_at < c.signup_at + interval '60 days') AS retained_m1,
    bool_or(g.status = 'COMPLETED' AND g.created_at >= c.signup_at + interval '60 days' AND g.created_at < c.signup_at + interval '90 days') AS retained_m3,
    count(g.id) FILTER (
      WHERE g.status = 'COMPLETED'
        AND g.created_at < c.signup_at + interval '30 days'
        AND (g.api_key_id IS NOT NULL OR lower(coalesce(g.source, '')) = 'api')
    ) AS api_generations_first_30d,
    count(g.id) FILTER (
      WHERE g.status = 'COMPLETED'
        AND g.created_at < c.signup_at + interval '30 days'
        AND g.api_key_id IS NULL
        AND lower(coalesce(g.source, '')) <> 'api'
    ) AS app_generations_first_30d
  FROM cohort c
  LEFT JOIN public.generations g
    ON g.organization_id = c.id
    AND g.deleted_at IS NULL
    AND g.created_at >= c.signup_at
  GROUP BY c.id
),
first_generation AS (
  SELECT DISTINCT ON (g.organization_id)
    g.organization_id,
    g.model_name,
    g.source,
    g.api_key_id,
    g.metadata
  FROM public.generations g
  JOIN cohort c ON c.id = g.organization_id
  WHERE g.deleted_at IS NULL
    AND g.status = 'COMPLETED'
  ORDER BY g.organization_id, g.finished_at, g.id
),
professional AS (
  SELECT
    m.organization_id,
    min(m.month) AS first_professional_month
  FROM public.org_movement_months m
  JOIN cohort c ON c.id = m.organization_id
  WHERE m.is_clean
    AND m.state IN ('new', 'expansion', 'flat', 'contraction', 'reactivation')
  GROUP BY 1
),
revenue AS (
  SELECT
    m.organization_id,
    sum(m.accrued_usd) AS accrued_revenue_usd,
    sum(m.paid_usd) AS paid_revenue_usd
  FROM public.org_movement_months m
  JOIN cohort c ON c.id = m.organization_id
  WHERE m.is_clean
    AND m.month >= date_trunc('month', c.signup_at)
    AND m.month < date_trunc('month', c.signup_at) + interval '3 months'
  GROUP BY 1
),
base AS (
  SELECT
    c.*,
    coalesce(f.model_name, '(none)') AS model,
    CASE
      WHEN f.api_key_id IS NOT NULL OR lower(coalesce(f.source, '')) = 'api' THEN 'api'
      WHEN lower(coalesce(f.source, '')) LIKE 'studio%' THEN 'studio'
      WHEN lower(coalesce(f.source, '')) LIKE '%plugin%' THEN 'plugin'
      WHEN lower(coalesce(f.source, '')) LIKE 'mcp%' THEN 'mcp'
      WHEN lower(coalesce(f.source, '')) = 'agent' THEN 'agent'
      ELSE coalesce(nullif(lower(f.source), ''), '(none)')
    END AS surface,
    coalesce(f.metadata->>'workflow', f.metadata->>'workflowInferred', '(unstamped)') AS workflow,
    CASE
      WHEN go.api_generations_first_30d > 0 AND go.app_generations_first_30d > 0 THEN 'mixed'
      WHEN go.api_generations_first_30d > 0 THEN 'api'
      WHEN go.app_generations_first_30d > 0 THEN 'app'
      ELSE 'no_completed_generation'
    END AS organization_segment,
    go.*,
    p.first_professional_month,
    coalesce(r.accrued_revenue_usd, 0) AS accrued_revenue_usd,
    coalesce(r.paid_revenue_usd, 0) AS paid_revenue_usd
  FROM cohort c
  LEFT JOIN generation_outcomes go ON go.organization_id = c.id
  LEFT JOIN first_generation f ON f.organization_id = c.id
  LEFT JOIN professional p ON p.organization_id = c.id
  LEFT JOIN revenue r ON r.organization_id = c.id
)
SELECT
  signup_cohort,
  first_touch_source,
  campaign,
  model,
  surface,
  workflow,
  organization_segment,
  billing_version,
  count(*)::bigint AS signups,
  count(*) FILTER (WHERE completed_generations > 0)::bigint AS first_generations,
  count(*) FILTER (WHERE completed_first_30d >= 3 AND active_days_first_30d >= 2)::bigint AS activated_organizations,
  round(100.0 * count(*) FILTER (WHERE completed_first_30d >= 3 AND active_days_first_30d >= 2) / nullif(count(*), 0), 2) AS activation_pct,
  count(*) FILTER (WHERE first_professional_month IS NOT NULL)::bigint AS professional_organizations,
  round(100.0 * count(*) FILTER (WHERE first_professional_month IS NOT NULL) / nullif(count(*), 0), 2) AS professional_pct,
  count(*) FILTER (WHERE first_subscribed_at IS NOT NULL)::bigint AS paid_conversions,
  round(100.0 * count(*) FILTER (WHERE first_subscribed_at IS NOT NULL) / nullif(count(*), 0), 2) AS paid_conversion_pct,
  round(100.0 * count(*) FILTER (WHERE retained_w1) / nullif(count(*) FILTER (WHERE signup_at <= now() - interval '14 days'), 0), 2) AS w1_retention_pct,
  round(100.0 * count(*) FILTER (WHERE retained_w2) / nullif(count(*) FILTER (WHERE signup_at <= now() - interval '21 days'), 0), 2) AS w2_retention_pct,
  round(100.0 * count(*) FILTER (WHERE retained_m1) / nullif(count(*) FILTER (WHERE signup_at <= now() - interval '60 days'), 0), 2) AS m1_retention_pct,
  round(100.0 * count(*) FILTER (WHERE retained_m3) / nullif(count(*) FILTER (WHERE signup_at <= now() - interval '90 days'), 0), 2) AS m3_retention_pct,
  round(sum(accrued_revenue_usd) / nullif(count(*), 0), 2) AS accrued_revenue_per_organization_usd,
  round(sum(paid_revenue_usd) / nullif(count(*), 0), 2) AS paid_revenue_per_organization_usd,
  count(*) FILTER (WHERE first_touch_source = 'unknown')::bigint AS unknown_attribution_organizations,
  round(100.0 * count(*) FILTER (WHERE first_touch_source = 'unknown') / nullif(count(*), 0), 2) AS unknown_attribution_pct,
  now() AS data_through
FROM base
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
HAVING count(*) >= 5
ORDER BY signup_cohort, signups DESC
    $q300$,
    'table', '{"columns":["signup_cohort","first_touch_source","campaign","model","surface","workflow","organization_segment","billing_version","signups","first_generations","activated_organizations","activation_pct","professional_organizations","professional_pct","paid_conversions","paid_conversion_pct","w1_retention_pct","w2_retention_pct","m1_retention_pct","m3_retention_pct","accrued_revenue_per_organization_usd","paid_revenue_per_organization_usd","unknown_attribution_organizations","unknown_attribution_pct","data_through"]}'::jsonb,
    NULL, 'atlas-product-analytics-materialization', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-billing-scorecard-v2',
    'atlas-product-analytics-billing-scorecard', 2, 'API',
    '{"source":"billing_experiment","report":"live-readout"}',
    'table', '{}'::jsonb,
    NULL, 'atlas-product-analytics-materialization', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-analytics-cohort-outcomes-v2',
    'atlas-product-analytics-cohort-outcomes', 2, 'SQL',
    $q302$
WITH cohort AS (
  SELECT
    o.id,
    o.created_at AS signup_at,
    date_trunc('month', o.created_at)::date AS signup_cohort,
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
    c.id AS organization_id,
    min(g.created_at) FILTER (WHERE g.status = 'COMPLETED') AS first_product_exposure,
    count(g.id) FILTER (WHERE g.status = 'COMPLETED') AS completed_generations,
    bool_or(g.status = 'COMPLETED' AND g.created_at >= c.signup_at + interval '7 days' AND g.created_at < c.signup_at + interval '14 days') AS retained_w1,
    bool_or(g.status = 'COMPLETED' AND g.created_at >= c.signup_at + interval '14 days' AND g.created_at < c.signup_at + interval '21 days') AS retained_w2,
    bool_or(g.status = 'COMPLETED' AND g.created_at >= c.signup_at + interval '30 days' AND g.created_at < c.signup_at + interval '60 days') AS retained_m1,
    bool_or(g.status = 'COMPLETED' AND g.created_at >= c.signup_at + interval '60 days' AND g.created_at < c.signup_at + interval '90 days') AS retained_m3,
    count(g.id) FILTER (
      WHERE g.status = 'COMPLETED' AND (g.api_key_id IS NOT NULL OR lower(coalesce(g.source, '')) = 'api')
    ) AS api_generations,
    count(g.id) FILTER (
      WHERE g.status = 'COMPLETED' AND g.api_key_id IS NULL AND lower(coalesce(g.source, '')) <> 'api'
    ) AS app_generations
  FROM cohort c
  LEFT JOIN public.generations g
    ON g.organization_id = c.id
    AND g.deleted_at IS NULL
    AND g.created_at >= c.signup_at
  GROUP BY c.id
),
first_generation AS (
  SELECT DISTINCT ON (g.organization_id)
    g.organization_id,
    coalesce(g.model_name, '(none)') AS model,
    CASE
      WHEN g.api_key_id IS NOT NULL OR lower(coalesce(g.source, '')) = 'api' THEN 'api'
      WHEN lower(coalesce(g.source, '')) LIKE 'studio%' THEN 'studio'
      WHEN lower(coalesce(g.source, '')) LIKE '%plugin%' THEN 'plugin'
      WHEN lower(coalesce(g.source, '')) LIKE 'mcp%' THEN 'mcp'
      WHEN lower(coalesce(g.source, '')) = 'agent' THEN 'agent'
      ELSE coalesce(nullif(lower(g.source), ''), '(none)')
    END AS surface,
    coalesce(g.metadata->>'workflow', g.metadata->>'workflowInferred', '(unstamped)') AS workflow
  FROM public.generations g
  JOIN cohort c ON c.id = g.organization_id
  WHERE g.deleted_at IS NULL
    AND g.status = 'COMPLETED'
  ORDER BY g.organization_id, g.finished_at, g.id
),
professional AS (
  SELECT
    m.organization_id,
    min(m.month) AS first_professional_month
  FROM public.org_movement_months m
  JOIN cohort c ON c.id = m.organization_id
  WHERE m.is_clean
    AND m.state IN ('new', 'expansion', 'flat', 'contraction', 'reactivation')
  GROUP BY 1
),
revenue AS (
  SELECT
    m.organization_id,
    sum(m.accrued_usd) AS accrued_revenue_usd,
    sum(m.paid_usd) AS paid_revenue_usd
  FROM public.org_movement_months m
  JOIN cohort c ON c.id = m.organization_id
  WHERE m.is_clean
    AND m.month >= date_trunc('month', c.signup_at)
    AND m.month < date_trunc('month', c.signup_at) + interval '3 months'
  GROUP BY 1
),
base AS (
  SELECT
    c.*,
    go.first_product_exposure,
    go.completed_generations,
    go.retained_w1,
    go.retained_w2,
    go.retained_m1,
    go.retained_m3,
    coalesce(f.model, '(none)') AS model,
    coalesce(f.surface, '(none)') AS surface,
    coalesce(f.workflow, '(unstamped)') AS workflow,
    CASE
      WHEN go.api_generations > 0 AND go.app_generations > 0 THEN 'mixed'
      WHEN go.api_generations > 0 THEN 'api'
      WHEN go.app_generations > 0 THEN 'app'
      ELSE 'no_completed_generation'
    END AS organization_segment,
    p.first_professional_month,
    coalesce(r.accrued_revenue_usd, 0) AS accrued_revenue_usd,
    coalesce(r.paid_revenue_usd, 0) AS paid_revenue_usd
  FROM cohort c
  LEFT JOIN generation_outcomes go ON go.organization_id = c.id
  LEFT JOIN first_generation f ON f.organization_id = c.id
  LEFT JOIN professional p ON p.organization_id = c.id
  LEFT JOIN revenue r ON r.organization_id = c.id
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
    count(*) FILTER (WHERE retained_w1)::bigint AS retained_w1,
    count(*) FILTER (WHERE retained_w2)::bigint AS retained_w2,
    count(*) FILTER (WHERE retained_m1)::bigint AS retained_m1,
    count(*) FILTER (WHERE retained_m3)::bigint AS retained_m3,
    count(*) FILTER (WHERE signup_at <= now() - interval '14 days')::bigint AS mature_w1,
    count(*) FILTER (WHERE signup_at <= now() - interval '21 days')::bigint AS mature_w2,
    count(*) FILTER (WHERE signup_at <= now() - interval '60 days')::bigint AS mature_m1,
    count(*) FILTER (WHERE signup_at <= now() - interval '90 days')::bigint AS mature_m3,
    count(*) FILTER (WHERE first_professional_month IS NOT NULL)::bigint AS professional_organizations,
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
  round(100.0 * professional_organizations / nullif(cohort_size, 0), 2) AS professional_qualification_pct,
  round(100.0 * paid_conversions / nullif(cohort_size, 0), 2) AS paid_conversion_pct,
  round(accrued_revenue_usd / nullif(cohort_size, 0), 2) AS accrued_revenue_per_organization_usd,
  round(paid_revenue_usd / nullif(cohort_size, 0), 2) AS paid_revenue_per_organization_usd,
  mature_w1,
  mature_w2,
  mature_m1,
  mature_m3,
  now() AS data_through
FROM grouped
WHERE cohort_size >= 5
ORDER BY signup_cohort, cohort_size DESC
    $q302$,
    'table', '{"columns":["signup_cohort","first_product_exposure","organization_segment","model","surface","workflow","billing_version","cohort_size","first_generation_completion_pct","model_workflow_adoption_pct","w1_generation_retention_pct","w2_generation_retention_pct","m1_generation_retention_pct","m3_generation_retention_pct","professional_qualification_pct","paid_conversion_pct","accrued_revenue_per_organization_usd","paid_revenue_per_organization_usd","mature_w1","mature_w2","mature_m1","mature_m3","data_through"]}'::jsonb,
    NULL, 'atlas-product-analytics-materialization', CURRENT_TIMESTAMP
  )
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-product-analytics-cohort-outcomes-v3',
  'atlas-product-analytics-cohort-outcomes', 3, 'SQL',
  $q302_fast$
WITH cohort AS (
  SELECT
    o.id,
    o.created_at AS signup_at,
    date_trunc('month', o.created_at)::date AS signup_cohort,
    o.first_generation_created_at,
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
movement_outcomes AS (
  SELECT
    m.organization_id,
    min(m.month) FILTER (WHERE m.state IN ('new', 'expansion', 'flat', 'contraction', 'reactivation')) AS first_professional_month,
    (array_agg(m.top_models[1] ORDER BY m.month) FILTER (WHERE m.top_models[1] IS NOT NULL))[1] AS first_top_model,
    sum(m.api_generations) AS api_generations,
    sum(m.billable_generations) AS billable_generations,
    bool_or(
      m.state IN ('new', 'expansion', 'flat', 'contraction', 'reactivation')
      AND m.month = date_trunc('month', c.signup_at) + interval '1 month'
    ) AS retained_m1,
    bool_or(
      m.state IN ('new', 'expansion', 'flat', 'contraction', 'reactivation')
      AND m.month = date_trunc('month', c.signup_at) + interval '2 months'
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
    CASE
      WHEN m.billable_generations > 0 AND m.api_generations = m.billable_generations THEN 'api'
      WHEN m.api_generations = 0 THEN 'app'
      WHEN m.api_generations > 0 THEN 'mixed'
      ELSE 'no_professional_activity'
    END AS organization_segment,
    coalesce(m.first_top_model, '(none)') AS model,
    CASE
      WHEN m.billable_generations > 0 AND m.api_generations = m.billable_generations THEN 'api'
      WHEN m.api_generations = 0 THEN 'app'
      WHEN m.api_generations > 0 THEN 'mixed'
      ELSE '(none)'
    END AS surface,
    m.first_professional_month,
    m.retained_m1,
    m.retained_m3,
    coalesce(m.accrued_revenue_usd, 0) AS accrued_revenue_usd,
    coalesce(m.paid_revenue_usd, 0) AS paid_revenue_usd
  FROM cohort c
  LEFT JOIN movement_outcomes m ON m.organization_id = c.id
),
grouped AS (
  SELECT
    signup_cohort,
    date_trunc('month', first_generation_created_at)::date AS first_product_exposure,
    organization_segment,
    model,
    surface,
    '(unavailable)'::text AS workflow,
    billing_version,
    count(*)::bigint AS cohort_size,
    count(*) FILTER (WHERE first_generation_created_at IS NOT NULL)::bigint AS first_generation_organizations,
    count(*) FILTER (WHERE first_professional_month IS NOT NULL)::bigint AS professional_organizations,
    count(*) FILTER (WHERE first_subscribed_at IS NOT NULL)::bigint AS paid_conversions,
    count(*) FILTER (WHERE retained_m1)::bigint AS retained_m1,
    count(*) FILTER (WHERE retained_m3)::bigint AS retained_m3,
    count(*) FILTER (WHERE signup_at <= now() - interval '2 months')::bigint AS mature_m1,
    count(*) FILTER (WHERE signup_at <= now() - interval '3 months')::bigint AS mature_m3,
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
  ) AS model_adoption_pct,
  NULL::numeric AS w1_generation_retention_pct,
  NULL::numeric AS w2_generation_retention_pct,
  round(100.0 * retained_m1 / nullif(mature_m1, 0), 2) AS m1_professional_retention_pct,
  round(100.0 * retained_m3 / nullif(mature_m3, 0), 2) AS m3_professional_retention_pct,
  round(100.0 * professional_organizations / nullif(cohort_size, 0), 2) AS professional_qualification_pct,
  round(100.0 * paid_conversions / nullif(cohort_size, 0), 2) AS paid_conversion_pct,
  round(accrued_revenue_usd / nullif(cohort_size, 0), 2) AS accrued_revenue_per_organization_usd,
  round(paid_revenue_usd / nullif(cohort_size, 0), 2) AS paid_revenue_per_organization_usd,
  mature_m1,
  mature_m3,
  now() AS data_through
FROM grouped
WHERE cohort_size >= 5
ORDER BY signup_cohort, cohort_size DESC
  $q302_fast$,
  'table', '{"columns":["signup_cohort","first_product_exposure","organization_segment","model","surface","workflow","billing_version","cohort_size","first_generation_completion_pct","model_adoption_pct","w1_generation_retention_pct","w2_generation_retention_pct","m1_professional_retention_pct","m3_professional_retention_pct","professional_qualification_pct","paid_conversion_pct","accrued_revenue_per_organization_usd","paid_revenue_per_organization_usd","mature_m1","mature_m3","data_through"]}'::jsonb,
  NULL, 'atlas-product-analytics-materialization', CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-product-analytics-attribution-outcome-v3',
  'atlas-product-analytics-attribution-outcome', 3, 'SQL',
  $q300_fast$
WITH cohort AS (
  SELECT
    o.id,
    o.created_at AS signup_at,
    date_trunc('month', o.created_at)::date AS signup_cohort,
    coalesce(nullif(o.attribution->>'source', ''), 'unknown') AS first_touch_source,
    coalesce(nullif(o.attribution->>'utm_campaign', ''), '(none)') AS campaign,
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
    count(*) FILTER (WHERE g.created_at < c.signup_at + interval '30 days') AS completed_first_30d,
    count(DISTINCT g.created_at::date) FILTER (WHERE g.created_at < c.signup_at + interval '30 days') AS active_days_first_30d,
    bool_or(g.created_at >= c.signup_at + interval '7 days' AND g.created_at < c.signup_at + interval '14 days') AS retained_w1,
    bool_or(g.created_at >= c.signup_at + interval '14 days' AND g.created_at < c.signup_at + interval '21 days') AS retained_w2
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
      AND m.month = date_trunc('month', c.signup_at) + interval '2 months'
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
)
SELECT
  c.signup_cohort,
  c.first_touch_source,
  c.campaign,
  c.billing_version,
  count(*)::bigint AS signups,
  count(*) FILTER (WHERE g.first_generation_at IS NOT NULL)::bigint AS first_generations,
  round(100.0 * count(*) FILTER (WHERE g.first_generation_at IS NOT NULL) / nullif(count(*), 0), 2) AS first_generation_pct,
  count(*) FILTER (WHERE g.completed_first_30d >= 3 AND g.active_days_first_30d >= 2)::bigint AS activated_organizations,
  round(100.0 * count(*) FILTER (WHERE g.completed_first_30d >= 3 AND g.active_days_first_30d >= 2) / nullif(count(*), 0), 2) AS activation_pct,
  count(*) FILTER (WHERE p.first_professional_month IS NOT NULL)::bigint AS professional_organizations,
  round(100.0 * count(*) FILTER (WHERE p.first_professional_month IS NOT NULL) / nullif(count(*), 0), 2) AS professional_pct,
  count(*) FILTER (WHERE c.first_subscribed_at IS NOT NULL)::bigint AS paid_conversions,
  round(100.0 * count(*) FILTER (WHERE c.first_subscribed_at IS NOT NULL) / nullif(count(*), 0), 2) AS paid_conversion_pct,
  round(100.0 * count(*) FILTER (WHERE g.retained_w1) / nullif(count(*) FILTER (WHERE c.signup_at <= now() - interval '14 days'), 0), 2) AS w1_generation_retention_pct,
  round(100.0 * count(*) FILTER (WHERE g.retained_w2) / nullif(count(*) FILTER (WHERE c.signup_at <= now() - interval '21 days'), 0), 2) AS w2_generation_retention_pct,
  round(100.0 * count(*) FILTER (WHERE p.retained_m1) / nullif(count(*) FILTER (WHERE c.signup_at <= now() - interval '2 months'), 0), 2) AS m1_professional_retention_pct,
  round(100.0 * count(*) FILTER (WHERE p.retained_m3) / nullif(count(*) FILTER (WHERE c.signup_at <= now() - interval '3 months'), 0), 2) AS m3_professional_retention_pct,
  round(sum(coalesce(p.accrued_revenue_usd, 0)) / nullif(count(*), 0), 2) AS accrued_revenue_per_organization_usd,
  round(sum(coalesce(p.paid_revenue_usd, 0)) / nullif(count(*), 0), 2) AS paid_revenue_per_organization_usd,
  count(*) FILTER (WHERE c.first_touch_source = 'unknown')::bigint AS unknown_attribution_organizations,
  round(100.0 * count(*) FILTER (WHERE c.first_touch_source = 'unknown') / nullif(count(*), 0), 2) AS unknown_attribution_pct,
  now() AS data_through
FROM cohort c
LEFT JOIN generation_outcomes g ON g.organization_id = c.id
LEFT JOIN professional_outcomes p ON p.organization_id = c.id
GROUP BY 1, 2, 3, 4
HAVING count(*) >= 5
ORDER BY signup_cohort, signups DESC
  $q300_fast$,
  'table', '{"columns":["signup_cohort","first_touch_source","campaign","billing_version","signups","first_generations","first_generation_pct","activated_organizations","activation_pct","professional_organizations","professional_pct","paid_conversions","paid_conversion_pct","w1_generation_retention_pct","w2_generation_retention_pct","m1_professional_retention_pct","m3_professional_retention_pct","accrued_revenue_per_organization_usd","paid_revenue_per_organization_usd","unknown_attribution_organizations","unknown_attribution_pct","data_through"]}'::jsonb,
  NULL, 'atlas-product-analytics-materialization', CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-product-analytics-organization-lifecycle-v3',
  'atlas-product-analytics-organization-lifecycle', 3, 'SQL',
  $q297_fast$
WITH bounds AS (
  SELECT
    date_trunc('month', current_date) - interval '6 months' AS period_start,
    date_trunc('month', current_date) AS period_end
),
movement AS (
  SELECT
    m.month,
    m.organization_id,
    m.state,
    m.churn_type,
    coalesce(nullif(m.billing_version, ''), 'v2') AS billing_version,
    CASE
      WHEN m.state = 'churn' AND previous.billable_generations > 0 THEN
        CASE
          WHEN previous.api_generations = 0 THEN 'app'
          WHEN previous.api_generations >= previous.billable_generations THEN 'api'
          ELSE 'mixed'
        END
      WHEN m.api_generations = 0 THEN 'app'
      WHEN m.api_generations >= m.billable_generations THEN 'api'
      ELSE 'mixed'
    END AS organization_segment
  FROM public.org_movement_months m
  CROSS JOIN bounds b
  LEFT JOIN public.org_movement_months previous
    ON previous.organization_id = m.organization_id
    AND previous.month = m.month - interval '1 month'
  WHERE m.month >= b.period_start
    AND m.month < b.period_end
    AND m.is_clean
    AND NOT m.is_partial
),
rollup AS (
  SELECT
    movement.month AS period_start,
    'professional_qualification'::text AS lifecycle_series,
    movement.organization_segment,
    movement.billing_version,
    'M1'::text AS horizon,
    count(*) FILTER (WHERE movement.state IN ('expansion', 'flat', 'contraction', 'churn'))::bigint AS starting_organizations,
    count(*) FILTER (WHERE movement.state IN ('expansion', 'flat', 'contraction'))::bigint AS retained_organizations,
    count(*) FILTER (WHERE movement.state = 'churn')::bigint AS churned_organizations,
    count(*) FILTER (WHERE movement.state = 'reactivation')::bigint AS returned_organizations,
    count(*) FILTER (WHERE movement.state = 'reactivation')::bigint AS requalified_organizations,
    count(*) FILTER (WHERE movement.state = 'new')::bigint AS new_professional_organizations,
    count(*) FILTER (WHERE movement.churn_type = 'went_dark')::bigint AS went_dark_organizations,
    count(*) FILTER (WHERE movement.churn_type = 'below_gate')::bigint AS below_gate_organizations,
    count(*) FILTER (WHERE movement.churn_type = 'converted')::bigint AS converted_organizations,
    sum(source.accrued_usd) FILTER (WHERE movement.state <> 'churn') AS closing_accrued_value_usd,
    sum(source.paid_usd) FILTER (WHERE movement.state <> 'churn') AS closing_paid_value_usd
  FROM movement
  JOIN public.org_movement_months source
    ON source.organization_id = movement.organization_id
    AND source.month = movement.month
  GROUP BY 1, 2, 3, 4, 5
)
SELECT
  period_start,
  lifecycle_series,
  organization_segment,
  billing_version,
  horizon,
  starting_organizations,
  retained_organizations,
  round(100.0 * retained_organizations / nullif(starting_organizations, 0), 2) AS retention_pct,
  churned_organizations,
  round(100.0 * churned_organizations / nullif(starting_organizations, 0), 2) AS churn_pct,
  returned_organizations,
  round(100.0 * returned_organizations / nullif(starting_organizations, 0), 2) AS return_pct,
  requalified_organizations,
  round(100.0 * requalified_organizations / nullif(starting_organizations, 0), 2) AS requalification_pct,
  new_professional_organizations,
  went_dark_organizations,
  below_gate_organizations,
  converted_organizations,
  closing_accrued_value_usd,
  closing_paid_value_usd,
  date_trunc('month', current_date)::date AS data_through
FROM rollup
ORDER BY period_start, organization_segment, billing_version
  $q297_fast$,
  'table', '{"columns":["period_start","lifecycle_series","organization_segment","billing_version","horizon","starting_organizations","retained_organizations","retention_pct","churned_organizations","churn_pct","returned_organizations","return_pct","requalified_organizations","requalification_pct","new_professional_organizations","went_dark_organizations","below_gate_organizations","converted_organizations","closing_accrued_value_usd","closing_paid_value_usd","data_through"]}'::jsonb,
  NULL, 'atlas-product-analytics-materialization', CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";
