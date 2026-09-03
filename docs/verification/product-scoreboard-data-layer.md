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

This table records the current definitions. It does not copy a live trust label into a
document. The latest Atlas snapshot is the source of truth for whether a question is
verified, stale, pending, or failed.

| Atlas | KPI | Direct source | Grain | Recorded contract | Runtime note |
| --- | --- | --- | --- | --- | --- |
| [Q15](https://atlas.pr.sync.so/questions/15) | Monthly professional organizations | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8164](https://sync-labs.metabaseapp.com/question/8164) | Month | Generation start time in UTC; `COMPLETED`; non-free plan at admission; `$100+`, 3+ generations, and 2+ active days | Read current trust in Atlas. |
| [Q16](https://atlas.pr.sync.so/questions/16) | Monthly activated organizations | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8165](https://sync-labs.metabaseapp.com/question/8165) | Month | The Q15 generation and activity rules before the `$100` gate | Read current trust in Atlas. |
| [Q21](https://atlas.pr.sync.so/questions/21) | 14-day return and activation | Product Postgres; [Metabase reference 8170](https://sync-labs.metabaseapp.com/question/8170) | Week | First completed generation, distinct-day return, and 14-day maturity window | Read current trust in Atlas. |
| [Q22](https://atlas.pr.sync.so/questions/22) | Activated-to-professional rate | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8172](https://sync-labs.metabaseapp.com/question/8172) | Month | Professional organization-months divided by activated organization-months | Read current trust in Atlas. |
| [Q23](https://atlas.pr.sync.so/questions/23) | 30-day product-led subscription conversion | Product Postgres; [Metabase reference 8173](https://sync-labs.metabaseapp.com/question/8173) | Week | Subscription starts within 30 days after the first completed generation | Read current trust in Atlas. |
| [Q17](https://atlas.pr.sync.so/questions/17) | M3 professional requalification | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8166](https://sync-labs.metabaseapp.com/question/8166) | Month | The fixed starting cohort must meet the full professional definition two calendar months later | A cohort cannot verify until its third calendar month is complete. |
| [Q24](https://atlas.pr.sync.so/questions/24) | Accrued value from professional organizations | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8175](https://sync-labs.metabaseapp.com/question/8175) | Month | Allocated subscription value plus consumed usage from the Q15 professional population | Read current trust in Atlas. |
| [Q18](https://atlas.pr.sync.so/questions/18) | M3 accrued NDR | TinyBird `sync_prod.sync_usage3`; [Metabase reference 8167](https://sync-labs.metabaseapp.com/question/8167) | Month | Same-cohort month-three accrued value divided by starting-month accrued value | A cohort cannot verify until its third calendar month is complete. |
| [Q8](https://atlas.pr.sync.so/questions/8) | Generation completion rate | Product Postgres; [Metabase reference 8177](https://sync-labs.metabaseapp.com/question/8177) | Week | Final `COMPLETED` non-deleted generations divided by all non-deleted generations | Read current trust in Atlas. |
| [Q9](https://atlas.pr.sync.so/questions/9) | Paid-qualified professional organization-months | TinyBird usage and Stripe mirrors; [Metabase reference 8178](https://sync-labs.metabaseapp.com/question/8178) | Month | V2 uses subscription and usage invoices; V3 uses subscription invoices and successful top-up payments | Read current trust in Atlas. |

## Feedback definitions

The governed weekly model-feedback metric combines thumb events and star scores. Four
or five stars are positive. Coverage counts distinct completed generations with at least
one approved feedback event and divides by completed generations. First-generation
coverage is a separate view.

The older generation-level upvote question still needs a deduplication rule when one
generation has more than one approved feedback event. Its broad instrument-definition
question is no longer open.

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
