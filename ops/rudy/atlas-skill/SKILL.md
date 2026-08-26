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

## Creating recurring crons

Every new recurring cron requires an Atlas preflight. One-time reminders do not.

1. Call `atlas_cron_plan` with `action=search`. Describe the cron's purpose and output.
2. If a logical candidate is certified, verified, and fresh, use it. Attach this skill to the cron. Add the exact canonical `ATLAS_PLAN` marker returned by the tool to the prompt.
3. If the task is an operational check with no logical Atlas metric, add the exact `operational-direct` marker and a specific reason.
4. If an analytics report has no logical candidate, call `atlas_cron_plan` with `action=create_draft`. Include the business definition, decision use, owner, cadence, dimensions, source hints, and acceptance checks.
5. Do not create the cron after a draft is created. Wait until Atlas gives the question a governed query and marks it certified, verified, and fresh. Then run a new search preflight.

Never use a raw vendor query as the canonical headline of a new recurring report. Raw sources are valid for operational checks, detail rows, investigation, and explicit reconciliation.

## Trust policy

1. Query Atlas before raw sources for any known KPI or recurring report.
2. Treat `VERIFIED` governed snapshots as the canonical answer for the stated reporting period and data-through time.
3. State `dataThrough`, freshness, reporting period, metric version, and trust status with the answer.
4. Do not present `PENDING`, `STALE`, or `FAILED` results as certified. Explain the exact state.
5. If Atlas has no answer, use the relevant source skill and say that Atlas coverage is missing.
6. Use raw-source queries to investigate or verify Atlas, not to silently replace a verified Atlas answer.
7. Rudy's normal Atlas access is read-only. The `atlas_cron_plan` tool can propose a new draft through a separate broker. It cannot activate, certify, verify, refresh, or edit a question.

## Product policy

The canonical user population excludes banned, anonymous, and internal Sync users. Disabled or self-deleted users remain in historical KPI populations and are reported as a separate outcome signal. A Product metric that cannot enforce this rule across its inputs must remain pending. Calendar periods use UTC and half-open boundaries. Multi-source metrics use the oldest complete required-source watermark.

## Answer format

Lead with the value and period. Then state the data-through time, freshness or trust state, Atlas question number, and source evidence. Link to `https://atlas.pr.sync.so/questions/<number>` when the question exists.
