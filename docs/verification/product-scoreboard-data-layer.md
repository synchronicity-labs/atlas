# Product Scoreboard data layer

## Scope

Atlas has governed definitions for every Product KPI in the current Scoreboard. One
Atlas question can return several measures, so ten questions cover eleven KPI lines.
Each sync writes a source watermark, normalized facts, a metric run, verification
evidence, and an immutable metric snapshot.

The current implementation uses the Metabase API only as a read-only SQL transport.
The canonical input is the named Postgres or TinyBird table in the saved query, not
the value rendered on a Metabase dashboard.

## KPI map

| Atlas | KPI | Direct source | Grain | Current trust | Remaining work |
| --- | --- | --- | --- | --- | --- |
| [Q15](https://atlas.pr.sync.so/questions/15) | Monthly professional organizations | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8164](https://sync-labs.metabaseapp.com/question/8164) | Month | Certified | Confirm created-time versus completed-time policy. |
| [Q16](https://atlas.pr.sync.so/questions/16) | Monthly activated organizations | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8165](https://sync-labs.metabaseapp.com/question/8165) | Month | Draft | Complete the governed principal join. |
| [Q21](https://atlas.pr.sync.so/questions/21) | 14-day return and activation | Product Postgres; [Metabase reference 8170](https://sync-labs.metabaseapp.com/question/8170) | Week | Certified | Stakeholder sign-off on completed-generation semantics. |
| [Q22](https://atlas.pr.sync.so/questions/22) | Activated-to-professional rate | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8172](https://sync-labs.metabaseapp.com/question/8172) | Month | Draft | Complete the governed principal join. |
| [Q23](https://atlas.pr.sync.so/questions/23) | 30-day product-led subscription conversion | Product Postgres; [Metabase reference 8173](https://sync-labs.metabaseapp.com/question/8173) | Week | Certified | Stakeholder sign-off on subscription start event. |
| [Q17](https://atlas.pr.sync.so/questions/17) | M3 professional requalification | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8166](https://sync-labs.metabaseapp.com/question/8166) | Month | Draft | Complete the governed principal join and confirm M3 meaning. |
| [Q24](https://atlas.pr.sync.so/questions/24) | Accrued value from professional organizations | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8175](https://sync-labs.metabaseapp.com/question/8175) | Month | Draft | Confirm accrued-value allocation and complete eligibility. |
| [Q18](https://atlas.pr.sync.so/questions/18) | M3 accrued NDR | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8167](https://sync-labs.metabaseapp.com/question/8167) | Month | Draft | Complete the governed principal join. |
| [Q8](https://atlas.pr.sync.so/questions/8) | Generation completion rate | Product Postgres; [Metabase reference 8177](https://sync-labs.metabaseapp.com/question/8177) | Week | Certified | Stakeholder sign-off on denominator statuses. |
| [Q9](https://atlas.pr.sync.so/questions/9) | Paid-qualified professional organization-months | TinyBird usage and Stripe mirrors; [Metabase reference 8178](https://sync-labs.metabaseapp.com/question/8178) | Month | Draft | Confirm invoice event basis and complete eligibility. |

## Stored layers

| Layer | Table | Purpose |
| --- | --- | --- |
| Source contract | `ingestion.dataset` | Physical dataset, event time, watermark, cadence, and backfill policy. |
| Checkpoint | `ingestion.sourceWatermark` | Complete source boundary and content hash for a retry-safe run. |
| Normalized data | `core.normalizedFact` | Immutable metric source rows with dimensions, measures, eligibility evidence, and canonical UTC windows. |
| Definition | `metrics.metricDefinition` | Stable metric identity, owner, description, and lifecycle state. |
| Version | `metrics.metricVersion` | Immutable business definition, query, normalization, computation, verification policy, cadence, and approval. |
| Execution | `metrics.metricRun` | Exact inputs, watermarks, hashes, validation state, and errors. |
| Evidence | `metrics.metricVerification` | Passed, pending, failed, or waived checks with references and evidence. |
| Published answer | `metrics.metricSnapshot` | Immutable result, reporting period, data-through time, content hash, and trust state. |

## Certification rule

A Product question is verified against its current metric version only when all
required run checks pass for its immutable snapshot:

1. the query is read-only;
2. the source result is stored immutably;
3. the result is present;
4. the canonical banned, anonymous, and internal eligibility policy is enforced.

Disabled identities are deliberately retained. Their later deletion is an observed
retention signal, not an exclusion. Source freshness is shown separately and can
make a previously verified result stale.

The Product dashboard is verified only when every question on it is governed and its
latest snapshot is verified. Atlas exposes partial coverage as **Verification
pending** rather than giving the dashboard a green check.
