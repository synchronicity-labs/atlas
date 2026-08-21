WITH latest AS (
  SELECT DISTINCT ON (q.id)
    q.id AS "questionId",
    q.number,
    v.version,
    v."queryLanguage",
    v."queryText",
    v.display,
    v.visualization,
    v."sourceCardExternalId"
  FROM question q
  JOIN "questionVersion" v ON v."questionId" = q.id
  WHERE q.number IN (1101, 1102, 1103, 1104, 1111)
  ORDER BY q.id, v.version DESC
), with_prices AS (
  SELECT
    latest.*,
    replace(
      latest."queryText",
      $needle$), subscription_states as ($needle$,
      $replacement$), plan_payloads as (
  select
    orgPlan as plan,
    argMax(payload, createdAt) as payload
  from sync_prod.sync_stripe_subscriptions
  where length(orgPlan) > 0
  group by orgPlan
), plan_prices as (
  select
    plan,
    arraySum(arrayMap(
      item -> if(
        JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed',
        JSONExtractFloat(item, 'price', 'unit_amount')
          * greatest(JSONExtractInt(item, 'quantity'), 1)
          / 100.0,
        0
      ),
      JSONExtractArrayRaw(payload, 'items', 'data')
    )) as monthly_price
  from plan_payloads
), subscription_states as ($replacement$
    ) AS "queryTextWithPrices"
  FROM latest
), with_dynamic_sums AS (
  SELECT
    with_prices.*,
    replace(
      "queryTextWithPrices",
      $needle$sum(multiIf(
      current_plan = 'hobbyist', 6,
      current_plan = 'creator', 20,
      current_plan = 'growth', 50,
      current_plan = 'scale', 250,
      current_plan = 'starter', 12,
      current_plan = 'pro', 29,
      current_plan = 'team', 99,
      0
    ))$needle$,
      $replacement$sum(ifNull(plan_prices.monthly_price, 0))$replacement$
    ) AS "queryTextWithDynamicSums"
  FROM with_prices
), with_price_joins AS (
  SELECT
    with_dynamic_sums.*,
    replace(
      "queryTextWithDynamicSums",
      E'from subscription_states\n',
      E'from subscription_states\n  inner join plan_prices on plan_prices.plan = current_plan\n'
    ) AS "queryTextWithPriceJoins"
  FROM with_dynamic_sums
), with_dynamic_plans AS (
  SELECT
    with_price_joins.*,
    replace(
      "queryTextWithPriceJoins",
      $needle$and current_plan in ('hobbyist', 'creator', 'growth', 'scale', 'starter', 'pro', 'team')$needle$,
      $replacement$and length(current_plan) > 0$replacement$
    ) AS "queryTextWithDynamicPlans"
  FROM with_price_joins
), transformed AS (
  SELECT
    with_dynamic_plans.*,
    CASE
      WHEN number = 1104 THEN replace(
        "queryTextWithDynamicPlans",
        $needle$multiIf(
    current_plan in ('hobbyist', 'creator', 'growth', 'scale'), 'V2',
    current_plan in ('starter', 'pro', 'team'), 'V3',
    'Other'
  ) as billing_type$needle$,
        $replacement$if(
    current_plan in ('hobbyist', 'creator', 'growth', 'scale'),
    'V2',
    'V3'
  ) as billing_type$replacement$
      )
      ELSE "queryTextWithDynamicPlans"
    END AS "nextQueryText"
  FROM with_dynamic_plans
)
INSERT INTO "questionVersion" (
  id,
  "questionId",
  version,
  "queryLanguage",
  "queryText",
  display,
  visualization,
  "sourceCardExternalId",
  "createdBy",
  "createdAt"
)
SELECT
  'atlas-tair-self-serve-contract-' || number,
  "questionId",
  version + 1,
  "queryLanguage",
  "nextQueryText",
  display,
  visualization,
  "sourceCardExternalId",
  'atlas-tair-product-contract',
  CURRENT_TIMESTAMP
FROM transformed
WHERE "queryText" <> "nextQueryText"
ON CONFLICT ("questionId", version) DO NOTHING;

UPDATE question
SET
  description = CASE number
    WHEN 1101 THEN 'Current self-serve subscription value, V2 postpaid usage pace, V3 top-up pace, total month-end estimate, annualized estimate, and Stripe cash reconciliation at one UTC cutoff.'
    WHEN 1102 THEN 'Estimated self-serve month-end revenue at one UTC cutoff. It combines current V2 and V3 subscription value with paced V2 postpaid usage and paced V3 top-up payments. This is an operating estimate, not booked revenue or cash collected.'
    WHEN 1103 THEN 'Six months of self-serve subscription value, V2 postpaid usage, and V3 top-up payments. Complete months show actual values. Only the open month shows an estimated month-end total.'
    WHEN 1104 THEN 'Current active or past-due self-serve subscriptions at the recurring licensed Stripe item price and quantity, grouped by V2 or V3 billing type and plan. New self-serve plans flow through after the governed revenue-door policy accepts them.'
    WHEN 1111 THEN 'Active or past-due V2 and V3 self-serve subscriptions at the recurring licensed Stripe item price and quantity, compared with the previous month-end.'
    ELSE description
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE number IN (1101, 1102, 1103, 1104, 1111);
