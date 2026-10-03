# Rudy Atlas client

Rudy reads governed Atlas metrics through the production read-only API. The runtime uses the `atlas-company-intelligence` skill before raw source skills for known KPIs and recurring reports.

The gateway receives two read-only values through its scoped Doppler runtime:

- `ATLAS_API_URL`
- `ATLAS_QUERY_SECRET`

The values are managed in Doppler. They are not stored in this repository. Install `atlas-skill` under Rudy's Hermes skills directory.

The client supports catalog search and immutable question reads. The optional `atlas-cron-governance` plugin makes an Atlas preflight mandatory before Rudy creates any recurring cron. It also exposes guarded question authoring.

## Direct Atlas MCP tools

`mcp/atlas_tools.py` adds deterministic Atlas reads to Rudy's existing FastMCP
server. It uses the same read-only API as the Hermes skill and does not invoke
Hermes, refresh sources, or change metrics.

Agents connect to `https://ip-10-0-3-200-1.tail8782ce.ts.net/mcp` from a runtime
that can reach the company Tailnet. The Atlas credential stays in the server's
protected environment. The existing Rudy server also exposes other tools; the
read-only guarantee here applies to the four `atlas_*` tools.

- `atlas_qbr_report(quarter, metric_ids?)` returns a compact report with exact
  observations and definitions. Pass one to ten metric IDs to retrieve their
  complete preparation and supporting evidence. Missing periods stay missing.
- `atlas_search_questions(query, limit=20)` searches the governed catalog.
- `atlas_question(number, reporting_period?, as_of?)` reads a saved question
  result with its definition, freshness, and provenance.
- `atlas_source_health()` reads connector health without refreshing anything.

For Q3, start with `atlas_qbr_report(quarter="2026-Q3")`. Inspect July, August,
September, and the authored quarter observations separately. For detailed
Enterprise NDR evidence, add `metric_ids=["enterprise_usage_retention"]`.

The optional `reporting_period` filter accepts `YYYY-Q1` through `YYYY-Q4`,
`YYYY-MM`, or `YYYY-MM-DD`. A quarter matches the saved snapshot's reporting
period; it does not trim or recompute its rows. `as_of` continues to limit
snapshots by their captured time.

Install `mcp/atlas_tools.py` next to the deployed Rudy MCP `server.py`, using the
existing Python runtime and MCP SDK. In `build_app()`, before creating the
Streamable HTTP app, add:

```python
from atlas_tools import register_atlas_tools
register_atlas_tools(mcp)
```

Provision `ATLAS_API_URL` and `ATLAS_QUERY_SECRET` in the MCP service's scoped
Doppler configuration, `rudy/prd_rudy_mcp`, by referencing their existing
`rudy/prd_core` values. Add both names to the service's `DOPPLER_ONLY_SECRETS`
allowlist, preserving its existing entries. Do not add the authoring credential.
Missing configuration
leaves these tools unregistered and does not prevent the existing MCP service
from starting. Back up the deployed files, verify registration with the installed
SDK, and restart `rudy-mcp` only when its health endpoint reports no active Hermes
runs. Keep the existing Tailscale Serve routes and Funnel configuration unchanged.

Verify initialization, tool discovery, and all four tool calls over the Tailnet
URL. Check that the QBR call returns the requested quarter and source links, an
invalid question/quarter returns an explicit error, and no response contains the
server credential. To roll back, restore the server and adapter backups and
restore the previous credential allowlist, then restart during an idle window.
Remove only Doppler keys added by this rollout.

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

An in-progress or failed source refresh is not a doctor failure while the API still serves a fresh, verified, certified snapshot. The source error remains visible in provenance. It becomes a report-readiness failure when the verified snapshot expires. Unavailable, stale, or unverified snapshots remain failures. The doctor must not report every Revenue question as broken during its normal refresh.

Q27 and Q43 remain provisional visitor-to-signup count and rate views with incomplete surface coverage. They share a separate conversion refresh source so their query timeouts do not invalidate unrelated canonical reports. Their queries, verification status, and errors stay unchanged and visible in Atlas. Do not substitute the trial single-scan rewrite: it did not match the existing result.
