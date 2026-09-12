# Atlas source reliability on Rudy

This runtime has two independent jobs. It does not use a Hermes conversation or
give Hermes the Atlas sync credential. The jobs are opt-in. A repository merge
does not enable them on a host.

| Job | UTC schedule | Authority |
| --- | --- | --- |
| Modal collector | 00:10, 06:10, 12:10, 18:10 | Read Modal billing; import aggregate Modal costs only |
| Source monitor | Every five minutes | Read Atlas source health; post to the configured Slack channel |

Economics refreshes at minute 53 every six hours. The Modal job has up to 300
seconds and runs before that refresh. Its existing 30-hour freshness allowance
is an operational margin, not the expected runtime or collection interval.

## Configuration and installation

Deploy the Atlas API change before enabling either timer. Keep all secrets in
the existing scoped Doppler configurations. Do not add package `.env` files,
copy secrets into this directory, or expose `CRON_SECRET` to Hermes.

| Location | Required values |
| --- | --- |
| Atlas API deployment | `ATLAS_MODAL_INGEST_SECRET`, at least 32 characters |
| Rudy `prd_core` | `ATLAS_API_URL`, `ATLAS_QUERY_SECRET` |
| Rudy `prd_ops` | The same `ATLAS_MODAL_INGEST_SECRET` |
| Rudy `prd_doctor` | `SLACK_BOT_TOKEN`, with permission to post in the chosen channel |
| `/etc/rudy/atlas-reliability.conf` | `ATLAS_ALERT_SLACK_CHANNEL`; optional `ATLAS_APP_URL` |

The host already needs `/usr/local/sbin/rudy-doppler-host-chain-exec`, its scoped
encrypted credentials, and `/usr/local/sbin/rudy-modal-billing`. The Modal reader
gets its vendor credential from `prd_integrations`; the import wrapper does not.
The monitor token can read but cannot invoke a sync. The Modal import token
cannot invoke the other sync routes.

Install from a reviewed checkout on Rudy:

```sh
sudo install -d -m 0755 /usr/local/lib/rudy-atlas-reliability
sudo install -m 0644 ops/rudy/source-reliability/atlas_http.py ops/rudy/source-reliability/atlas_source_monitor.py ops/rudy/source-reliability/modal_collector.py /usr/local/lib/rudy-atlas-reliability/
sudo install -m 0755 ops/rudy/source-reliability/rudy-atlas-source-monitor ops/rudy/source-reliability/rudy-atlas-modal-import /usr/local/sbin/
sudo install -m 0644 ops/rudy/source-reliability/rudy-atlas-source-monitor.service ops/rudy/source-reliability/rudy-atlas-source-monitor.timer ops/rudy/source-reliability/rudy-atlas-modal-import.service ops/rudy/source-reliability/rudy-atlas-modal-import.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/rudy-atlas-source-monitor.service /etc/systemd/system/rudy-atlas-source-monitor.timer /etc/systemd/system/rudy-atlas-modal-import.service /etc/systemd/system/rudy-atlas-modal-import.timer
```

Set the confirmed Slack channel in the root-owned configuration file. Then run
the read-only checks:

```sh
sudo /usr/local/sbin/rudy-atlas-modal-import --dry-run
sudo /usr/local/sbin/rudy-atlas-source-monitor --dry-run
```

Modal dry-run reads the vendor but does not import. Monitor dry-run reads Atlas
but does not write incident state or send Slack messages. Check the JSON output:
`disabled` or an `ERROR` for `__monitor__` is not a successful acceptance result,
even if the diagnostic command exits successfully.

After the channel and delivery are approved, start each job once, inspect its
result, and enable the timers:

```sh
sudo systemctl start rudy-atlas-modal-import.service
sudo systemctl start rudy-atlas-source-monitor.service
sudo systemctl enable --now rudy-atlas-modal-import.timer rudy-atlas-source-monitor.timer
sudo systemctl list-timers rudy-atlas-modal-import.timer rudy-atlas-source-monitor.timer
sudo journalctl -u rudy-atlas-modal-import.service -u rudy-atlas-source-monitor.service -n 50 --no-pager
```

Confirm a successful import and fresh `modal:billing` source. Confirm repeated
checks do not resend an unchanged incident. Exercise a test incident and recovery
in a test channel before claiming end-to-end Slack acceptance. Do not change a
production metric's trust state to test monitoring.

## Data and incident behavior

The collector reads the previous month and current month through the start of
today in UTC. It sends only month, model, and aggregate cost. It does not claim
to have today's complete cost or create precise per-generation costs. Empty,
invalid, negative, or out-of-window vendor responses fail instead of becoming
zero. A real zero-cost row is valid. The first day of a month skips the empty
current-month interval. This is a rolling refresh, not a historical backfill.

Atlas keeps result snapshots immutable and deduplicated. A transactional import
cursor records the last checked content hash and timestamp. An unchanged import
refreshes its check without rewriting history. If corrected vendor data returns
to an earlier hash, economics selects that checked result, not an intervening
snapshot. Older imports without this cursor retain snapshot-based freshness.
Imports reject invalid timestamps and clock skew above five minutes. The source
timestamp advances through an atomic conditional update in the same transaction
as the snapshot and cursor. Older or equal timestamps return `ignored: true`
without changing shared state, including when import requests overlap.

The monitor reads every registered source independently of ingestion. The metric
catalog and Rudy question-authoring namespaces are metadata, not ingestion jobs;
they do not have freshness deadlines and are excluded from operational alerts.
Other sources are required if configured or referenced by an active question. An unconfigured
source without an active question is skipped. Expired deadlines become stale
even if the stored state is healthy or syncing. A sync in progress does not
invalidate a still-fresh previous success. Missing freshness evidence is
unavailable, never healthy.
When a previously required source becomes non-required, its incident is marked
inactive without a Slack recovery message. This local state change still happens
during Slack backoff. Re-enabling the source starts a new incident lifecycle.

Recovery alerts contain the source label, last successful sync in readable UTC,
and one dashboard link (or this runbook if no dashboard exists). Failure alerts
also include the freshness deadline, a safe error summary when available, and
this runbook. Run IDs, full source details, and additional dashboard links remain
available through `/internal/atlas/sources`; incident tracking is in
[OPS-30](https://linear.app/sync-labs/issue/OPS-30). Recovery describes source
health, not metric certification. Raw vendor errors and customer data stay out
of Slack. An unavailable or malformed health
endpoint produces a separate monitor incident; it does not recover old source
incidents.

Delivery state lives in `/var/lib/rudy-atlas-source-monitor`, with a file lock and
atomic private state files. Successful delivery is saved after each alert. Failed
delivery stays retryable. Slack `Retry-After` survives timer restarts. An unchanged
status is suppressed; a changed failure status sends an update, and a fresh
healthy check sends recovery after the current refresh has finished. A retry
starting (`SYNCING` or latest run `RUNNING`) is not recovery evidence and does not
clear the previous incident, even while its older snapshot is still fresh. An
expired deadline still alerts during a retry. An abrupt crash after Slack accepts a message but
before state is saved can duplicate that message. Delivery is not exactly once.

If Slack cannot receive messages, the service fails and journals the transport
failure. Slack cannot alert about its own complete outage. Keep host-level timer
and service checks in the existing Rudy operations monitoring. Do not delete
incident state as a routine retry: that resets suppression and may resend alerts.

To pause safely, disable the two timers and retain state:

```sh
sudo systemctl disable --now rudy-atlas-modal-import.timer rudy-atlas-source-monitor.timer
```

## Tests

```sh
python3 -B -m unittest discover -s ops/rudy/source-reliability
cd apps/api
bun test src/atlas-query/source-health.test.ts src/economics/economics-sync.controller.test.ts src/economics/modal-freshness.test.ts
```

These tests cover authentication separation, safe error output, deadline checks,
state transitions, failed delivery, restart-safe rate limits, immutable import
selection, month boundaries, and invalid billing responses. They do not send
Slack messages or write production data.
