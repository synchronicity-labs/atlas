# Rudy Atlas client

Rudy reads governed Atlas metrics through the production read-only API. The runtime uses the `atlas-company-intelligence` skill before raw source skills for known KPIs and recurring reports.

The gateway receives two read-only values through its scoped Doppler runtime:

- `ATLAS_API_URL`
- `ATLAS_QUERY_SECRET`

The values are managed in Doppler. They are not stored in this repository. Install `atlas-skill` under Rudy's Hermes skills directory.

The client supports catalog search and immutable question reads. The optional `atlas-cron-governance` plugin makes an Atlas preflight mandatory before Rudy creates any recurring cron. It also exposes a draft-only question authoring tool.

The authoring credential is isolated in the `rudy/prd_atlas_authoring` Doppler config. It is not loaded into the Hermes gateway. `/usr/local/sbin/rudy-atlas-question-draft` injects it only into the fixed root-owned broker. The broker can call only the draft question route. Atlas rejects attempts to set question status, purpose, certification, or trust state.

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

The wrapper reads Atlas and Linear credentials from their existing Hermes secret files. It never prints them. Run `publish_weekly_metrics.sh --dry-run` to verify the rendered update without writing to Linear.
