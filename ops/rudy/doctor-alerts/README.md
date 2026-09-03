# Doctor alert semantics

`rudy_doctor.patch` is the narrow patch for the separately managed host file `/opt/rudy/ops/rudy_doctor.py`. It does not include credentials or the rest of the host's configuration.

- Paid fallback use is a `WARN` in manual and JSON output, not a failed service check. It is excluded from Slack alerts. A quiet window does not claim that the primary route was tested.
- A newer gBrain release is a `WARN` maintenance item. It stays visible in manual and JSON output, but it does not create a Slack service-failure alert.
- Invalid routing configuration, OAuth failures, and subscription-limit failures remain `FAIL` checks. Paid fallback still costs money, so it remains visible during manual diagnosis.
- Atlas report readiness has its own `atlas` category. Stale, unavailable, unverified, or failed-source answers still fail. Error summaries retain their beginning and report truncation explicitly.
- Recovery messages say that the current checks pass, not that a permanent repair occurred.

Copy the live Doctor to a private staging directory. Apply the patch there with `patch --fuzz=0 --forward`, then run:

```sh
RUDY_DOCTOR_SOURCE=/path/to/staged/rudy_doctor.py python3 -m unittest discover -s ops/rudy/doctor-alerts
python3 -m unittest discover -s ops/rudy/report-runtime
```

The Doctor tests use fake logs, configuration, database rows, and Slack functions. They do not contact a model or post messages. They require the actual staged host file and skip when `RUDY_DOCTOR_SOURCE` is absent.

Before deployment, check that the live file still matches the hash captured before staging. Keep a root-only backup and atomically replace the file with its original owner and mode. Also install the updated `report-runtime/rudy_atlas_cron_canary.py`. Do not overwrite concurrent changes. Doctor reads these files on each invocation; the Hermes gateway does not need a restart.

Verify with Doctor's routing scope without `--alert` or `--repair`, and with the Atlas canary. Do not clear old cron errors manually: the next successful real run is what clears them.
