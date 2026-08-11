# Rudy Atlas client

Rudy reads governed Atlas metrics through the production read-only API. The runtime uses the `atlas-company-intelligence` skill before raw source skills for known KPIs and recurring reports.

The gateway receives two secrets through its systemd environment file:

- `ATLAS_API_URL`
- `ATLAS_QUERY_SECRET`

The values are managed in the Atlas Doppler production config. They are not stored in this repository. Install `hermes-gateway-atlas.conf` as a systemd drop-in, install `atlas-skill` under Rudy's Hermes skills directory, and restart the gateway after rotating either value.

The client supports catalog search and immutable question reads. It has no sync, preview, mutation, or save command.
