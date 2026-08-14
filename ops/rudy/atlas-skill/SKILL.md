---
name: atlas-company-intelligence
description: Read deterministic Sync company and Product metrics from Atlas. Use this before querying Metabase, TinyBird, PostHog, Stripe, HubSpot, or other raw sources for a KPI, scorecard, dashboard, Atlas question, recurring report, metric definition, freshness check, or historical result.
---

# Atlas company intelligence

Atlas is the first read for governed company metrics. It stores the definition, query version, source freshness, immutable result snapshot, and verification state together.

## Commands

```bash
python3 {baseDir}/scripts/atlas_query.py catalog
python3 {baseDir}/scripts/atlas_query.py question <atlas-question-number>
python3 {baseDir}/scripts/atlas_query.py question <atlas-question-number> --period YYYY-MM
python3 {baseDir}/scripts/atlas_query.py search '<metric or question text>'
```

The gateway loads `ATLAS_API_URL` and `ATLAS_QUERY_SECRET`. Never print either value.

## Trust policy

1. Query Atlas before raw sources for any known KPI or recurring report.
2. Treat `VERIFIED` governed snapshots as the canonical answer for the stated reporting period and data-through time.
3. State `dataThrough`, freshness, reporting period, metric version, and trust status with the answer.
4. Do not present `PENDING`, `STALE`, or `FAILED` results as certified. Explain the exact state.
5. If Atlas has no answer, use the relevant source skill and say that Atlas coverage is missing.
6. Use raw-source queries to investigate or verify Atlas, not to silently replace a verified Atlas answer.
7. Atlas is read-only from Rudy. Do not call sync, mutation, preview, or save endpoints.

## Product policy

The canonical user population excludes banned, anonymous, and internal Sync users. Disabled or self-deleted users remain in historical KPI populations and are reported as a separate outcome signal. A Product metric that cannot enforce this rule across its inputs must remain pending. Calendar periods use UTC and half-open boundaries. Multi-source metrics use the oldest complete required-source watermark.

## Answer format

Lead with the value and period. Then state the data-through time, freshness or trust state, Atlas question number, and source evidence. Link to `https://atlas.pr.sync.so/questions/<number>` when the question exists.
