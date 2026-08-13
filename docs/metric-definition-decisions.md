# Metric definition decisions

This register separates business choices from query bugs. Atlas does not use one
timestamp or amount as a substitute for another. A stakeholder approves the meaning;
Atlas then stores that meaning in an immutable metric version.

## Company rules already agreed

- Calendar periods use UTC and half-open boundaries.
- A multi-source result stops at the oldest complete source watermark.
- Banned, anonymous, `@sync.so`, and `@sync.labs` identities are excluded from
  recalculated operating metrics.
- Disabled identities remain in historical populations. Atlas reports deletion after
  qualification as a separate retention signal.
- A later ban can change a live historical dashboard. A report already sent keeps its
  original immutable snapshot.
- A metric is not verified because its query ran. Its required source, snapshot,
  population, freshness, and result checks must pass.
- Metabase cards are reconciliation references. Canonical metrics read the underlying
  source tables through a read-only transport.

## Questions for Prady: Weekly Revenue Lite

Ask these in one review. Record each answer in a new metric version before the report
is called certified.

| Decision | Current Atlas behavior | Alternatives to confirm | Why it changes the answer |
| --- | --- | --- | --- |
| Master product run-rate | Active self-serve licensed plan value plus projected accrued usage | Contracted ARR, invoiced revenue, recognized revenue, or cash | These measure different economic events and must not share one label. |
| Usage event time | `generationEndedAt` | Generation created time or invoice time | A generation can cross a period boundary or fail after creation. |
| Stripe reconciliation line | Cash from invoices whose Stripe `paid_at` is inside the cutoff | Invoice creation, invoice finalization, due date, service period, or payment settlement | “Created,” “billed,” and “paid” answer different questions. If invoice creation is wanted, Atlas should add an `invoice billings` metric instead of changing `cash collected`. |
| Enterprise and Studio bookings date | HubSpot stage-entry history is used for CRM verification | Contract signature timestamp or work-start timestamp | A contract can be signed before Sales moves the deal, and work can start later. |
| Signed amount precedence | HubSpot amount is accepted only as CRM evidence; a conflicting signed amount remains partial | Signed contract always wins, HubSpot always wins, or a named reconciliation owner resolves conflicts | USC is `$292` in HubSpot and `$334.25` in the cited source thread. |
| Licensed subscription base | Current active or past-due subscriptions multiplied by current plan price | Invoice-item accrual, contracted price, or collected license cash | Current state is useful for run-rate but cannot replay an old close without lifecycle ingestion time. |
| Enterprise commitments | Excluded from master Product run-rate | Include contracted commitments, usage drawdown, or only the unused commitment balance | Adding commitments and usage can double count the same economics. |
| Report finality | The delivered snapshot is immutable | Recalculate old reports after source corrections | An immutable close is reproducible; a live dashboard may still restate history. |

The current Stripe cash calculation is correct for the label **paid invoice
collections**. It is not a decision that Prady wants cash as the operating KPI. If he
wants invoice creation or contract signature, Atlas should publish a separate metric
with that exact name and event timestamp.

## Questions for Tair: Product Scoreboard

| Decision | Current state | Owner answer needed |
| --- | --- | --- |
| Generation event time | Legacy Product questions use `generationCreatedAt`; the verified revenue work uses `generationEndedAt`. | Should every completed, billable, and accrued Product KPI use `generationEndedAt`? |
| Billable generation | Existing cards use the source card logic. | Which final statuses count, and how are retries, deleted records, and rejected generations handled? |
| `$100 accrued` | Product definitions say accrued operating value, not paid cash. | Confirm the exact subscription allocation plus consumed-usage formula and billing-version treatment. |
| V2 population | Core Scoreboard cards use hobbyist, creator, growth, and scale. | Confirm how later billing versions appear without rewriting the historical V2 cohort. |
| Active day | Existing logic counts distinct generation dates. | Confirm whether the day follows creation or completion time and whether one billable completion is enough. |
| API-key attribution | A generation can have a user ID, API key ID, both, or neither. | Confirm that API-key activity belongs to its owner and define the fail-closed rule for an unresolved principal. |
| M3 | Existing logic means two calendar months after the starting month. | Confirm this is the intended meaning rather than 90 elapsed days or the third renewal. |
| Completion rate denominator | The current certified definition is completed, non-deleted generations divided by all non-deleted generation records. | Confirm which terminal and non-terminal statuses belong in the denominator. |
| Paid-qualified | The draft metric compares accrued-professional organization-months with at least `$100` in subscription and usage invoices. | Confirm invoice creation, service period, or payment time and treatment of credits, refunds, and open invoices. |

## Decision record template

For each answer, record:

- metric key and owner;
- plain-language business definition;
- numerator, denominator, entity, and grain;
- event timestamp and UTC window;
- included and excluded population;
- source dataset and immutable query version;
- freshness requirement and shared data-through time;
- verification reference and tolerance;
- approver and approval time;
- effective reporting period and whether history is restated.
