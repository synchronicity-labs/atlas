# KPI catalog and verification rollout

## Scope

Atlas treats the full [Q3 metrics and planning workbook](https://docs.google.com/spreadsheets/d/17oWmJqYGxWwHEbdVhvo1OCHLAUEv03bljDuPHaqGHwU/edit) as a discovery input. The `KPIs` tab is the consolidated index, but it is not the complete inventory. The team tabs also contain explicit KPIs, diagnostic measures, breakdowns, and roadmap success measures:

- overview;
- KPIs;
- ops;
- engineering;
- research;
- product;
- marketing;
- marketing new;
- productions;
- sales;
- gtme;
- css.

The live import currently finds 197 measurement records across 11 data tabs: 38
top-level KPIs, 12 breakdown views, 3 diagnostics, and 144 roadmap measures. The
`overview` tab is read as workbook metadata but is not turned into fake metrics.
Importing the workbook therefore means reading every tab, preserving each useful
row's source location, and deduplicating repeated definitions into one canonical
metric.

The workbook is not a live reporting source. It tells Atlas what the business wants to measure. Certified values still come from governed source data and immutable metric versions.

## What enters the catalog

Every measurable row receives a source reference and one of these kinds before implementation:

| Kind | Meaning | Example treatment |
| --- | --- | --- |
| `KPI` | A company or team outcome used to judge performance. | Can become a certified Atlas metric. |
| `VIEW` | A breakdown of a canonical KPI by segment, tier, channel, model, or another dimension. | Reuses the parent metric contract where possible. |
| `DIAGNOSTIC` | A measure used to explain a KPI, investigate a problem, or monitor a guardrail. | Can be calculated and published, but is not counted as a top-level KPI. |
| `ROADMAP_MEASURE` | A success condition for an initiative or deliverable. | Stays linked to the initiative unless the owner promotes it to a recurring KPI. |

This prevents roadmap checklists from inflating KPI coverage and prevents the same KPI from appearing several times because it is referenced by Company, Product, and another team.

## Readiness is not one percentage

Atlas must not report one unlabeled completion percentage across unlike records.
The catalog may show an explicit KPI verification rate, such as “10 of 38 KPIs,”
alongside separate lifecycle counts for views, diagnostics, and roadmap measures.
Each catalog entry has a lifecycle stage and separate evidence axes.

### Lifecycle stage

| Stage | Meaning |
| --- | --- |
| `CATALOGED` | The row and its workbook source are stored. No claim is made about meaning or data access. |
| `NEEDS_DEFINITION` | The owner must resolve an ambiguous entity, population, event, window, amount, or finality rule. |
| `NEEDS_SOURCE` | The business definition is usable, but the canonical dataset or access path is missing. |
| `READY_TO_IMPLEMENT` | The definition and source contract are clear enough to write a deterministic query. |
| `IMPLEMENTING` | A versioned query or normalization job is being built. |
| `RECONCILING` | Atlas returns data, but it is still being compared with a known report or source artifact. |
| `VERIFIED` | The approved definition, inputs, query, immutable snapshot, and required checks passed. |
| `BLOCKED` | A named external decision or source constraint prevents progress. |

`DEPRECATED` remains a separate terminal state for definitions that should no longer be used.

### Evidence axes

A metric can advance only when the applicable evidence exists:

1. **Definition:** entity, numerator, denominator, eligibility, exclusions, event time, UTC window, late-arrival rule, and revision policy are explicit.
2. **Source:** canonical datasets are named, accessible, and have event-time and watermark contracts.
3. **Calculation:** a deterministic, versioned query produces an immutable result for a fixed input snapshot.
4. **Reconciliation:** the result is compared with an approved report, source total, or manually reviewed sample, with an explicit tolerance.
5. **Approval:** the metric owner approves the business meaning and the verification evidence.
6. **Freshness:** the latest successful data-through watermark satisfies the metric's SLA.

Freshness is runtime health, not lifecycle. A verified metric can become `STALE` without losing its approved definition. A draft calculation can be `FRESH` while remaining untrusted.

## Ambiguity is visible work

Open decisions are stored and shown instead of being resolved inside SQL. Common ambiguity types are:

- entity and identity joins;
- eligible population and exclusions;
- created, completed, ended, signed, invoiced, paid, or recognized event time;
- attempted, completed, billable, paid, or final-state outcomes;
- calendar period, trailing window, cohort age, or matched MTD window;
- contracted, booked, billed, accrued, recognized, or collected money;
- authoritative source and reconciliation-only sources;
- deduplication and final-state rules;
- current-clean history versus immutable as-reported history.

These decisions use the checklist in [`metric-definition-decisions.md`](./metric-definition-decisions.md). An unresolved decision keeps the metric out of `VERIFIED`, even when Atlas can display a plausible draft number.

## Data model mapping

The existing source-first metric system remains the foundation:

| Concern | Atlas record |
| --- | --- |
| Canonical metric identity and owner | `metrics.metricDefinition` |
| Immutable approved business and computation contract | `metrics.metricVersion` |
| Direct source query and expected grain | `metrics.metricInput` |
| Exact execution window and shared watermarks | `metrics.metricRun` |
| Check results and reconciliation evidence | `metrics.metricVerification` |
| Immutable published answer and trust state | `metrics.metricSnapshot` |
| Shareable query and visualization | `public.question` and `public.questionVersion` |
| Dashboard composition | `public.dashboard`, `public.dashboardTab`, and `public.dashboardCard` |

The catalog import adds source provenance and readiness to the metric definition layer. It does not create a Question until a deterministic computation exists. Questions are the shareable query interface; they do not replace the canonical metric definition.

The current `DRAFT`, `CERTIFIED`, and `DEPRECATED` lifecycle enum is too coarse for this rollout. The implementation should add readiness separately so existing certified metrics keep their meaning while catalog entries can move through definition, source, implementation, and reconciliation work.

## Import and refresh behavior

1. Read every workbook tab through a read-only Google Sheets connector.
2. Store the workbook ID, tab ID, row or range, raw text, and content hash as import provenance.
3. Classify each measurable row and match it to an existing canonical metric or create a `CATALOGED` draft.
4. Never overwrite an approved metric version from a sheet edit. Create a reviewable proposed revision instead.
5. Preserve rows that disappear from the workbook and mark the source reference missing. Do not delete metric history.
6. Run the catalog import daily at 05:13 UTC and on demand with
   `bun catalog:sync`. Metric data ingestion keeps its own source-specific cadence.

The importer uses the existing read-only Google service account. The workbook is
shared to that account; no user OAuth token is stored. `GET` and `POST`
`/internal/sync/metric-catalog` are guarded by `CRON_SECRET` and record a sync run,
content hash, source freshness, and missing rows without deleting history.

## Progress shown in Atlas

The `/metrics` registry shows the exact workbook row, declared source, KPI-only
mapping and verification rates, and separate lifecycle counts:

- cataloged measurements;
- top-level KPIs versus views, diagnostics, and roadmap measures;
- definitions clear;
- sources connected;
- calculations running;
- reconciling;
- verified;
- stale or failed;
- unresolved decisions;
- blocked by owner or source.

Dashboards may show draft data when that is useful, but every card must label it `Draft`, `Reconciling`, `Verification pending`, `Verified`, `Stale`, or `Failed`. Rudy uses verified snapshots by default. It may use draft data only when it says that the value is not certified and explains the missing evidence.

## Rollout order

1. Import and deduplicate the complete workbook inventory.
2. Preserve the already governed Product Scoreboard definitions and map them to the catalog.
3. Finish Company/CEO and Product KPI definitions, source contracts, and reconciliation first.
4. Add Marketing KPIs next, because they are part of the current cycle commitment.
5. Continue team by team, starting with entries that are already defined and source-accessible.
6. Keep ambiguous or unavailable metrics visible in the catalog with a named owner and next decision.

The first useful milestone is not “all rows return a number.” It is “all rows are accounted for, every ambiguity or source gap is explicit, and the first priority KPI set is verified end to end.”
