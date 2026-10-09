
INSERT INTO "question" (
  "id", "number", "name", "description", "connector", "sourceId",
  "sourceExternalId", "sourceDashboardExternalId", "databaseExternalId",
  "status", "purpose", "createdAt", "updatedAt"
) VALUES (
  'atlas-qbr-question-customer-revenue-retention-by-door', 7407,
  'Customer revenue retention by revenue door',
  'Fixed-cohort paid-invoice revenue retention for Q3 2025 and Q3 2026 by PLG, Enterprise, Channel, and Productions. The result keeps churned cohort members at zero and excludes new customers. Productions is explicitly unavailable until a production revenue ledger exists. The invoice mirror is a provisional historical basis and is not a Finance close.',
  'METABASE', 'atlas-revenue-source', 'customer-economics:qbr-revenue-retention-by-door',
  'atlas:customer-lifecycle:economics', '166', 'ACTIVE', 'RECONCILIATION',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("number") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "connector" = EXCLUDED."connector",
  "sourceId" = EXCLUDED."sourceId",
  "sourceExternalId" = EXCLUDED."sourceExternalId",
  "sourceDashboardExternalId" = EXCLUDED."sourceDashboardExternalId",
  "databaseExternalId" = EXCLUDED."databaseExternalId",
  "status" = EXCLUDED."status",
  "purpose" = EXCLUDED."purpose",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "questionVersion" (
  "id", "questionId", "version", "queryLanguage", "queryText", "display",
  "visualization", "sourceCardExternalId", "createdBy", "createdAt"
) VALUES (
  'atlas-qbr-customer-revenue-retention-by-door-v1',
  (SELECT "id" FROM "question" WHERE "number" = 7407),
  1, 'SQL',
  $query$with invoice_quarters as (
  select toStartOfQuarter(toTimeZone("createdAt", 'UTC')) as quarter_start,
    "customerId" as customer_id,
    argMax(lower(coalesce("plan", '')), tuple("createdAt", id)) as plan,
    argMax("organizationId", tuple("createdAt", id)) as organization_id,
    sumIf("amountPaid", "amountPaid" > 0) / 100.0 as revenue_usd
  from sync_prod.sync_stripe_invoices_paid
  where "createdAt" >= toDateTime('2025-04-01 00:00:00')
    and "createdAt" < toDateTime('2026-10-01 00:00:00')
    and "customerId" != ''
  group by quarter_start, customer_id
), pairs as (
  select base.quarter_start as base_quarter,
    base.customer_id,
    multiIf(
      base.organization_id in ('05a1d7e6-380e-454f-b153-e055ec95e825','6608b82f-ddeb-4401-8e26-7f26eac2feee','6850f5f1-3c35-491e-a94a-5a6ee727b743','700e8b88-e549-4823-a3c8-c10775530b22','896f3498-a14f-4926-af5a-c411d6b7b45b','9a5df4fa-2d8f-4e56-80bd-64dcfab677a2','f53205dd-3c9a-4bce-9527-f8354e055ca4','f81a9433-d5c0-4e36-a399-49859c8b5d7d'), 'Channel',
      base.organization_id in ('0150c016-0baa-440c-a2c5-2bfbb9e40a60','05a1d7e6-380e-454f-b153-e055ec95e825','065e465d-1317-4c12-9d78-31af9bc89d32','066bd01a-a73b-4047-aa76-5e98f8793f07','161dadee-06e0-40b8-9559-fb040b7f929e','16d082a5-87cd-4225-8f5d-90f12abe169c','1856658b-e1ae-45e1-a09f-8b1c1d5b2cb7','210277f2-12f3-4dba-ad84-44f3d8607806','27141749-d8f5-4c6e-b7d0-5350433f1147','283f4d0e-fb1a-4605-8461-681671025cc4','28c6f7f4-21e9-432e-b92d-94951daa328a','2f9a8e3c-d1b7-4e6a-9f8d-5c6a7b8d9e0f','36243675-1418-49a5-a8cf-846562fa9102','391c148c-f15b-46ea-a0d7-595655aa4896','3d59f17c-842e-478e-ac13-8ded6b4b988e','3e87ec38-2f47-49cb-9c72-2918678654f4','3fc3b84b-f4ce-48f9-89e1-132bdb0b7971','41045a46-c192-412a-975f-75bca3d04787','47c2d662-c513-450e-a03c-1798a7e1df66','4ba8feb0-b06e-4429-ac66-0577adc2b76c','51953a93-0110-4e8e-af25-b55405bd9612','5896af74-9511-480a-9258-ebf19d94a2ae','61bc036a-56a3-4eec-a62d-c54f0879e990','6608b82f-ddeb-4401-8e26-7f26eac2feee','6cc5d78a-a002-417f-b480-15d7f496be97','767aabfc-b834-42f5-9b0b-2e7e7ca4b310','7eccd58a-e970-46e8-81d8-a5ec96486074','826b4ad9-1e47-48c7-86c8-521bda349301','8915b830-5965-4650-8100-a2bac4fbea8e','896f3498-a14f-4926-af5a-c411d6b7b45b','8b051409-c8ec-4c66-9e2b-cc2549d76082','94330e1a-c9f3-4ae4-9b26-1c6380b19734','96134c8f-0341-449f-a152-2c6094f677bf','963281ef-bba3-4955-8677-dc7a9eff3cbd','9692384a-d29a-4887-b347-3617271896a3','9a5df4fa-2d8f-4e56-80bd-64dcfab677a2','a16881b5-d204-487f-805e-cdcbdb1ef586','b0597ab9-4c65-4d0d-8cda-89de748a63ec','bd4efe19-7cba-4a43-918d-e8f178e63e0c','c4f43274-f7c6-4815-a4a8-bfc33c1cd5e3','c9abcf01-a60e-4728-a1ee-3257d6d8317a','cd0776c4-4772-4a35-8078-a4dae6e65ab7','ce66a07c-8485-4c04-953a-7d3309ac8c62','d113b4b4-1a55-4339-b53f-fc17888d8c15','d508d51b-ac39-417c-a8ef-fde9741547da','dc1fb518-8e10-42b5-9aab-7de223cc28a8','dec8e27b-dc67-4abf-8629-cb48a54ab800','f1611c0a-414b-4206-8ad4-f8fda4bf2f08','f33908bb-7991-4085-80ee-147d26fa5e38','f53205dd-3c9a-4bce-9527-f8354e055ca4') or base.plan in ('enterprise', 'program'), 'Enterprise',
      'PLG'
    ) as door,
    base.revenue_usd as starting_revenue_usd,
    coalesce(current.revenue_usd, 0) as retained_revenue_usd
  from invoice_quarters base
  left join invoice_quarters current
    on current.customer_id = base.customer_id
    and current.quarter_start = addMonths(base.quarter_start, 3)
  where base.quarter_start in (toDate('2025-04-01'), toDate('2026-04-01'))
    and base.revenue_usd > 0
), aggregates as (
  select base_quarter, door, countDistinct(customer_id) as starting_customers,
    round(sum(pairs.starting_revenue_usd), 2) as starting_revenue_usd,
    round(sum(pairs.retained_revenue_usd), 2) as retained_revenue_usd,
    round(100.0 * sum(pairs.retained_revenue_usd) / nullIf(sum(pairs.starting_revenue_usd), 0), 2) as net_dollar_retention_pct,
    round(100.0 * sum(least(pairs.retained_revenue_usd, pairs.starting_revenue_usd)) / nullIf(sum(pairs.starting_revenue_usd), 0), 2) as gross_revenue_retention_pct
  from pairs group by base_quarter, door
), windows as (
  select toDate('2025-04-01') as base_quarter, '2025-Q3' as period
  union all select toDate('2026-04-01'), '2026-Q3'
), doors as (
  select 'PLG' as door
  union all select 'Enterprise'
  union all select 'Channel'
  union all select 'Productions'
)
select windows.period, doors.door,
  aggregates.starting_customers,
  if(isNull(aggregates.starting_customers) OR aggregates.starting_customers = 0, cast(null as Nullable(Float64)), aggregates.starting_revenue_usd) as starting_revenue_usd,
  if(isNull(aggregates.starting_customers) OR aggregates.starting_customers = 0, cast(null as Nullable(Float64)), aggregates.retained_revenue_usd) as retained_revenue_usd,
  if(isNull(aggregates.starting_customers) OR aggregates.starting_customers = 0, cast(null as Nullable(Float64)), aggregates.net_dollar_retention_pct) as net_dollar_retention_pct,
  if(isNull(aggregates.starting_customers) OR aggregates.starting_customers = 0, cast(null as Nullable(Float64)), aggregates.gross_revenue_retention_pct) as gross_revenue_retention_pct,
  if(isNull(aggregates.starting_customers) OR aggregates.starting_customers = 0, 'unavailable', 'provisional') as coverage_status
from windows cross join doors
left join aggregates on aggregates.base_quarter=windows.base_quarter and aggregates.door=doors.door
order by windows.period, doors.door$query$,
  'table', '{"x":"period","series":["door","net_dollar_retention_pct","gross_revenue_retention_pct"],"percentColumns":["net_dollar_retention_pct","gross_revenue_retention_pct"]}'::jsonb,
  NULL, 'atlas-qbr-customer-economics', CURRENT_TIMESTAMP
)
ON CONFLICT ("questionId", "version") DO UPDATE SET
  "queryLanguage" = EXCLUDED."queryLanguage",
  "queryText" = EXCLUDED."queryText",
  "display" = EXCLUDED."display",
  "visualization" = EXCLUDED."visualization",
  "createdBy" = EXCLUDED."createdBy";
