# Rudy Atlas client

Rudy reads governed Atlas metrics through the production read-only API. The runtime uses the `atlas-company-intelligence` skill before raw source skills for known KPIs and recurring reports.

The gateway receives two secrets through its systemd environment file:

- `ATLAS_API_URL`
- `ATLAS_QUERY_SECRET`

The values are managed in the Atlas Doppler production config. They are not stored in this repository. Install `hermes-gateway-atlas.conf` as a systemd drop-in, install `atlas-skill` under Rudy's Hermes skills directory, and restart the gateway after rotating either value.

The client supports catalog search and immutable question reads. It has no sync, preview, mutation, or save command.

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
