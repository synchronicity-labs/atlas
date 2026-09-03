# Model-feedback evidence schedule

The gBrain evidence job publishes the previous complete Monday-to-Monday UTC week. It must run after the week closes and before Atlas refreshes Product dashboard 1.

Install `rudy-gbrain-model-feedback-ingest.timer` at `/etc/systemd/system/rudy-gbrain-model-feedback-ingest.timer`. Reload systemd and restart only this timer. The Hermes gateway does not need a restart.

The intended sequence is:

- 00:05 UTC Monday: publish the completed gBrain evidence week.
- 00:15 UTC Monday: the existing Atlas Product dashboard refresh consumes it.

Run the oneshot service manually after installation. Its JSON result must show the latest completed week and `ok=true`.
