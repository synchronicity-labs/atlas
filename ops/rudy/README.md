# Rudy Atlas client

Rudy reads governed Atlas metrics through the production read-only API. The runtime uses the `atlas-company-intelligence` skill before raw source skills for known KPIs and recurring reports.

The gateway receives two read-only values through its scoped Doppler runtime:

- `ATLAS_API_URL`
- `ATLAS_QUERY_SECRET`

The values are managed in Doppler. They are not stored in this repository. Install `atlas-skill` under Rudy's Hermes skills directory.

The client supports catalog search and immutable question reads. The optional `atlas-cron-governance` plugin makes an Atlas preflight mandatory before Rudy creates any recurring cron. It also exposes guarded question authoring.

The authoring credential is isolated in the `rudy/prd_atlas_authoring` Doppler config. It is not loaded into the Hermes gateway. `/usr/local/sbin/rudy-atlas-question-draft` injects it only into the fixed root-owned broker. The broker can create drafts and publish a reviewed recipe ID. It cannot submit query text or set question status, purpose, certification, or trust state. Atlas owns those actions and activates a question only after the recipe result passes every required check.

Install the plugin under `/root/.hermes/plugins/atlas-cron-governance`, install the broker files under `/usr/local`, and add this exact sudo rule:

```text
rudy ALL=(root) NOPASSWD: /usr/local/sbin/rudy-atlas-question-draft
```

The plugin must be enabled and the gateway must be restarted once during an idle window. Existing cron execution is unchanged.

## Automated Monday Linear update

`publish_weekly_metrics.sh` reads Atlas questions 15, 1102, and 1105, then creates one idempotent project update per UTC week in the North Star Metrics Linear project. It reports each snapshot's period, data-through time, and trust state. Pending or stale metrics make the update at risk instead of being presented as certified.

Install both publisher files under `/root/.hermes/scripts/`, then schedule the no-agent job after the Monday source refreshes:

```bash
hermes cron create '15 17 * * 1' \
  --name atlas-monday-metrics-linear-update \
  --script publish_weekly_metrics.sh \
  --no-agent \
  --deliver local
```

The deployed wrapper uses scoped Doppler injection for Atlas and Linear credentials. It never prints them. Run `publish_weekly_metrics.sh --dry-run` to verify the rendered update without writing to Linear.

## Final report migration acceptance

`report-runtime` holds the live report guards, final migration helper, and doctor canary. `report-skills` holds the eight corrected active skills. These files are loaded by new report processes; installing them does not require a gateway restart.

After deploying the dedicated Lipsync source migration, refresh Marketing and obtain its allocated public question number. Run `apply_final_migrations.py --traffic-question NUMBER` as the Rudy user with the Hermes runtime on PYTHONPATH and HERMES_HOME set. Review the dry-run result, then add `--apply`. The helper holds Hermes's jobs lock, makes a private backup, and changes only prompts and five known Slack delivery targets. Schedules, run counts, models, and the exit-survey job's existing local destination stay unchanged.

Install the Python runtime files root-owned in `/usr/local/lib/rudy-hermes-crons`, except `atlas_report_controls.py`, which belongs in `/usr/local/lib/rudy-atlas-runtime`. Install the skills under `/root/.hermes/skills/sync-reports`. Keep backups and use atomic replacement. Run `rudy-atlas-cron-canary` and the GEO, Product Pages, and Lipsync funnel no-delivery checks before recording acceptance.

The doctor checks question purpose, trust, freshness, source health, Lipsync's exact source populations and weekly calendars, governed arithmetic, active skill versions, and gateway-owned delivery. An exit-survey local archive is not evidence of a Slack post. Never infer an unknown channel or spend one of a finite cron's runs just to test it.

An in-progress source refresh is not a doctor failure when the API still serves a fresh, verified, certified snapshot. Error or unavailable snapshots remain failures. The doctor must not report every Revenue question as broken during its normal refresh.

Q43 remains a provisional visitor-to-signup metric with incomplete surface coverage. It has a separate refresh source so its query timeout does not invalidate unrelated canonical reports. Its query, verification status, and error stay unchanged and visible in Atlas. Do not substitute the trial single-scan rewrite: it did not match the existing result.
