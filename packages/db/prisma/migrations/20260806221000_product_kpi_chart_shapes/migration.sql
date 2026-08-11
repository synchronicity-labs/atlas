INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
)
VALUES
  (
    'atlas-product-version-billing-subscription-revenue-v2', 'atlas-product-question-billing-subscription-revenue', 2, 'SQL',
    $query$select
  toStartOfMonth("createdAt") as month,
  sumIf("amountPaid", plan not in ('starter', 'pro', 'team')) / 100.0 as v2_subscription_revenue_usd,
  sumIf("amountPaid", plan in ('starter', 'pro', 'team')) / 100.0 as v3_subscription_revenue_usd
from sync_prod.sync_stripe_invoices_paid
where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
  and "createdAt" < now()
group by month
order by month$query$,
    'line', '{}'::jsonb, '8056', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-billing-frames-v2', 'atlas-product-question-billing-frames', 2, 'SQL',
    $query$select
  toStartOfMonth(month_date) as month,
  sumIf(total_frames, ifNull(tier, '') not in ('starter', 'pro', 'team')) as v2_frames,
  sumIf(total_frames, ifNull(tier, '') in ('starter', 'pro', 'team')) as v3_frames
from sync_prod.usage_data_by_model_by_tier_by_month
where month_date >= addMonths(toStartOfMonth(today()), -6)
group by month
order by month$query$,
    'line', '{}'::jsonb, '8058', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-billing-dubbing-v2', 'atlas-product-question-billing-dubbing', 2, 'SQL',
    $query$select
  toStartOfMonth("createdAt") as month,
  sumIf("usageCostMillicents", ifNull("organizationPlanType", '') not in ('starter', 'pro', 'team')) / 100000.0 as v2_dubbing_cost_usd,
  sumIf("usageCostMillicents", ifNull("organizationPlanType", '') in ('starter', 'pro', 'team')) / 100000.0 as v3_dubbing_cost_usd
from sync_prod.sync_usage_integration_dubbing
where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
  and "createdAt" < now()
group by month
order by month$query$,
    'bar', '{}'::jsonb, '8059', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-billing-tts-v2', 'atlas-product-question-billing-tts', 2, 'SQL',
    $query$select
  toStartOfMonth("createdAt") as month,
  sumIf("usageCostMillicents", ifNull("organizationPlanType", '') not in ('starter', 'pro', 'team')) / 100000.0 as v2_tts_cost_usd,
  sumIf("usageCostMillicents", ifNull("organizationPlanType", '') in ('starter', 'pro', 'team')) / 100000.0 as v3_tts_cost_usd
from sync_prod.sync_usage_integration_tts
where "createdAt" >= addMonths(toStartOfMonth(today()), -6)
  and "createdAt" < now()
group by month
order by month$query$,
    'line', '{}'::jsonb, '8060', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-today-v2', 'atlas-product-question-success-today', 2, 'SQL',
    $query$select
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct
from public.generations
where created_at >= date_trunc('day', now())$query$,
    'smartscalar', '{}'::jsonb, '696', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-week-v2', 'atlas-product-question-success-week', 2, 'SQL',
    $query$select
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct
from public.generations
where created_at >= date_trunc('week', now())$query$,
    'smartscalar', '{}'::jsonb, '697', 'atlas', CURRENT_TIMESTAMP
  ),
  (
    'atlas-product-version-success-history-v2', 'atlas-product-question-success-history', 2, 'SQL',
    $query$select
  date_trunc('week', created_at)::date as week,
  round(
    100.0 * count(*) filter (where status <> 'FAILED' or status is null)
      / nullif(count(*), 0),
    2
  ) as success_rate_pct
from public.generations
where created_at >= date_trunc('week', now()) - interval '9 weeks'
group by 1
order by 1$query$,
    'line', '{}'::jsonb, '2676', 'atlas', CURRENT_TIMESTAMP
  );

UPDATE "dashboardCard"
SET "visualization" = 'BAR', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'atlas-product-card-v3-plan-mix';

UPDATE "dashboard"
SET "layoutVersion" = "layoutVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "number" = 1;
