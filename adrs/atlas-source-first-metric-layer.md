# Source-first governed metric layer

Atlas started as a Metabase scoreboard mirror. That proved the dashboard and question experience, but a mirrored card does not define the business meaning, source window, normalization rule, or verification evidence for a company KPI.

We will keep Atlas as one repository and one product with separate ingestion, API, and frontend runtime boundaries. Governed metrics read the physical sources directly. TinyBird or ClickHouse remains the high-volume event compute plane. Postgres stores source dataset contracts, normalized facts at useful reporting grains, metric definitions, runs, watermarks, verification evidence, and immutable published snapshots. Metabase remains available for discovery and reconciliation, not as the canonical extraction path.

Questions are views of data rather than the definition of truth. A certified question references an approved metric version. Exploratory questions can change without changing a canonical metric. Reconciliation questions compare Atlas with legacy reports. A certified question never falls back to an unverified legacy snapshot.

All calendar boundaries use UTC. A multi-source metric uses the oldest complete watermark across its required inputs, so every input covers the same window. A run cannot publish until the required watermarks are complete and verification passes.

Existing sync routes and dashboards remain compatible while source adapters are extracted from the API runtime one source at a time. The storage and serving contracts are already independent of that extraction. The full model and transition are in [the Atlas architecture](../docs/atlas.md).
