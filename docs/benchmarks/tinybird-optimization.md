# Tinybird query optimization

The incident's 50 attribution requests come from Atlas `ProductEligibilityService.attributionRows`, used by question 6001 on dashboard 1. The SQL matches the September 9 incident byte for byte after substituting the six-month range and page offset. The dashboard's native refresh runs every 15 minutes. Metabase user 1355 appears in the incident query comments; the HTTP request that triggered that particular refresh has not been traced.

The service now exports the complete result through `/api/dataset/json` once. `/api/dataset` returned only 2,000 rows in a live probe even with larger `constraints`; the JSON export returned all 2,001 probe rows. Formatting is disabled to preserve raw values. The SQL retains the total result count and checks it against every returned row before proceeding. The request has a 75-second timeout and SQL limit of 1,000,000 rows. Exceeding that limit or Metabase's export limit fails the refresh instead of publishing a partial result.

The query groups the raw events once, then merges exact distinct-generation states across each organization/month. This preserves repeated generation IDs across days or principals. Costs still sum every event. Summing daily distinct counts would change the qualification rule.

## Evidence

`attribution-metabase-2026-09-09.json` records six serial, read-only requests against the real Metabase export endpoint. All six returned the same 49,288 ordered application rows and every field matched. SHA-256: `3a70c0c6defcdaa926b52112aecf314c2d4bbc67fb6d02ba04da3711a7552268`.

- Incident baseline: 50 paginated requests. New implementation: 1 request, a 98% reduction.
- Controlled full-export median: original SQL 3.562 seconds; new SQL 3.352 seconds. Both variants use a single full export for this measurement. This is not a comparison against the old complete 50-request refresh latency.
- Local ClickHouse evaluation: 34 input events, 10 output rows, exact ordered parity. Cases include duplicate IDs across days/principals, exact cost and day thresholds, null principals, plan exclusions, empty organization, date boundaries, large costs, and empty results.
- API tests cover 0, 1, 1,000, 2,001, and 49,288 rows, truncation, malformed counts/results, and rate limits.

Reproduce from the repository root:

```sh
doppler run --project atlas --config prd -- bun apps/api/scripts/benchmark-product-attribution.ts 2202861 docs/benchmarks/attribution-metabase-2026-09-09.json
python3 apps/api/scripts/eval-product-attribution.py --baseline 2202861 --clickhouse-url http://127.0.0.1:8123
python3 apps/api/scripts/eval-completion-revenue-migration.py --postgres-container <isolated-postgres-container>
bun run --cwd apps/api test
bun run --cwd apps/api check-types
```

## Required deployment order

This change also creates a new saved version of question 1102. It reads usage from `sync_prod.sync_usage_by_completion` and adds the same completion-time bounds already present in `sumIf`. Subscription and top-up expressions are unchanged. The existing subscription `argMax` can select tied events differently on repeated queries, so full live revenue-row equality cannot prove this usage-only change. The source-specific benchmark and exact eligibility-expression comparisons provide that evidence.

**Do not merge or deploy this Atlas migration until the Tinybird completion source is fully populated and verified.** The source is introduced by the companion sync-api-v2 work tracked in CRAFT-5785. It must preserve every raw event, including zero-frame events, raw generation cost, user, organization, plan, and exact completion timestamp. Compare historical counts and sums before switching. Atlas applies the same user, organization, plan, and subscription-history filters to both source names.

The PostgreSQL evaluation checks that the migration preserves the old version and all unrelated SQL/metadata, creates exactly one new version, is idempotent, and rejects an unexpected latest query. The migration was tested only in an isolated local PostgreSQL database. No production migration or deployment was run.

To roll back after deployment, create a newer question version from the previous SQL; do not edit historical versions. Keep the raw Tinybird source available during rollout.
