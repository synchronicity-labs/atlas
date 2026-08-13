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

## Why the metric contract comes first

A review of corrected Rudy analytics answers found one recurring failure: Rudy answered
from the first plausible data surface before locking the business definition. The query
could be technically valid and still answer the wrong question.

| Failure pattern | What has gone wrong | Atlas and Rudy rule |
| --- | --- | --- |
| Wrong source of truth | Stripe cash was used for revenue run-rate; PostHog behavior was used for paid truth; Stripe metadata was used instead of the Product organization mapping; partial Pylon enrichment was treated as complete. | Resolve the governed metric first. Its source priority decides which system is canonical and which systems only reconcile it. |
| Wrong metric definition | `Conversion` was interpreted as signup, checkout click, free-to-paid, generation completion, activation, second project, or revenue per signup. | Never query a loose metric label. Resolve the entity, event, numerator, denominator, and window first. |
| Wrong cohort spine | Event presence replaced assignment tables; one global date window replaced each organization's post-assignment window; historical cohorts without a holdout were described as causal. | Store the cohort entry event, assignment source, eligibility rule, observation window, and comparison design in the metric version. |
| Cash, usage, revenue, and credits blended | V2 postpaid usage accrual, V3 prepaid top-up cash, subscription cash, credit consumption, invoice cash, and booked commitments were treated as interchangeable. | Publish separate named measures. Never substitute one economic event for another because it is easier to query. |
| Data-shape caveats found too late | Duplicate invoice lifecycle rows, stale metadata, missing attribution, low sample sizes, boolean-only PostHog fields, and a legacy TinyBird database produced believable but unsafe answers. | Verification must check deduplication, attribution coverage, sample size, expected columns, canonical dataset, source freshness, and immutable inputs before publication. |

Two concrete examples already found:

- A V2 uncollected-revenue analysis counted stale and open invoice events even when the
  same Stripe invoice later had a paid event. The corrected rule deduplicates by Stripe
  invoice ID, resolves the latest reliable state, and verifies material cases against
  live Stripe.
- A May run-rate answer used collected Stripe cash. The intended Product run-rate was
  licensed subscription base plus usage incurred in the month, with Studio bookings
  shown separately and enterprise commitments handled without double counting.

Rudy's query order is therefore: resolve the Atlas metric contract, use its certified
snapshot when available, disclose its trust and freshness state, and only query raw
sources for verification or when no governed definition exists. If the contract is
missing or ambiguous, Rudy asks the owner instead of choosing a plausible meaning.

## Shared glossary

Metric names must be specific enough that two people cannot reasonably read them in
different ways. A published metric should not use a loose word such as `users`,
`active`, `paid`, or `revenue` without the qualifier shown below.

| Term | Atlas meaning | Status or remaining question |
| --- | --- | --- |
| Raw product user | One authentication account in the Product database, before eligibility filters or identity joins. | Use only for source auditing, not as an operating KPI. |
| Eligible product user | A raw product user who is not banned, anonymous, an approved test identity, or an internal Sync identity. | Agreed company default. Metric names should say `eligible users` rather than only `users`. |
| Canonical person | One human after known accounts and identities are joined. One person can have several product users. | The join and deduplication rules must be versioned. |
| Internal user | An identity owned by Sync staff, currently including `@sync.so` and `@sync.labs`. | Agreed exclusion from operating KPIs. The domain list must be versioned. |
| Banned user | An admin-identified abusive account. Current-clean metrics remove its full history. | Agreed. Published reports remain unchanged and preserve the value known at send time. |
| Disabled user | A user who chose to disable or delete the account. This is not an abuse flag. Valid activity before deletion stays in historical metrics. | Agreed. Atlas also reports organizations that qualified before a user later deleted the account. |
| Anonymous user | Activity that is explicitly marked anonymous and is not resolved to an eligible person, API key owner, or organization. | Excluded by default. Unresolved attribution must fail closed for a certified person-level metric. |
| Active user or organization | An eligible entity with a named qualifying event inside a named window. | `Active` alone is not a definition. The metric must name the entity, event, minimum frequency, and UTC window. |
| Signup | Creation of an eligible Product authentication account. Blocked pre-signup attempts do not count. | The metric must state whether verification, workspace creation, or another later step is required. |
| Activated organization | An eligible organization that reaches the metric's stated activation event. | Product currently uses completed generations across distinct days; each metric version must state the exact threshold. |
| Professional organization | An eligible organization that passes the approved accrued-value, completed-generation, and active-day gates for the period. | The threshold and billing-version population belong in the metric version, not only in dashboard copy. |
| Recurring or retained | The same starting entity satisfies an explicitly named later-period condition. | The metric must say whether retention means product activity, subscription status, spend, or full requalification. |
| Completed generation | A generation whose final Product status is `COMPLETED`. | Do not use this as a synonym for billable until Product confirms the billing-status rule. |
| Billable generation | A generation that the approved billing logic treats as chargeable. | Product must confirm statuses, retries, rejected records, deletions, and billing-version behavior. |
| Booked | A commercial commitment at a stated event, such as contract signature or CRM Closed Won. | The event is still owner-defined. Contract signature and HubSpot stage entry are not interchangeable. |
| Billed | An invoice was created or finalized. | The metric must name which invoice event and whether open invoices count. |
| Accrued | Economic value assigned to the period in which usage or service occurred, whether or not cash arrived. | Product usage currently follows generation activity; Finance must approve other accrual rules. |
| Collected | Cash was paid against an invoice, using Stripe `paid_at` for the period. | This is the current Stripe collections meaning. It is not invoice creation or contract signature. |
| Recognized revenue | Revenue assigned to an accounting period under the approved accounting policy. | Not available by inference from Stripe cash or Product usage. Requires the accounting source and policy. |
| Run-rate | A stated recurring or paced value projected to a monthly amount. | The components and pacing method must be named. It is not automatically ARR, revenue, bookings, or cash. |
| Reporting period | The exact half-open UTC interval being measured. | Calendar periods and rolling windows must be labeled differently. |
| Data-through time | The latest event time that every required source completely covers. | For multiple sources, use the oldest complete watermark. |
| Refreshed at | When Atlas most recently ran the calculation. | This can be later than the data-through time and must not be presented as data coverage. |
| Verified | The versioned definition, query, population, source snapshot, result, and required checks passed. | Verification does not mean the source is still fresh. |
| Fresh or stale | Whether the latest verified data-through time is inside the metric's freshness target. | Freshness is separate from correctness. |
| Current-clean history | History recalculated using what Atlas knows now, including later bans. | Prior periods can change. |
| As-reported history | The immutable value and evidence that were actually sent or published. | Never overwritten by a later recalculation. |

## Ambiguity checklist for every metric

Before a metric can be certified, its owner must make each applicable choice explicit.
Atlas records the answer in the metric version instead of hiding it in a query.

| Decision | Common choices that give different answers | Question for the owner |
| --- | --- | --- |
| What is counted? | Raw event, product user, canonical person, organization, company, payer, contract, or invoice | What is the unit, and how are duplicate accounts or related companies joined? |
| Who is eligible? | All source rows, eligible population, plan cohort, geography, customer segment, or experiment group | Which identities and organizations are included or excluded? |
| When is an event counted? | Created, started, completed, ended, ingested, updated, signed, invoiced, paid, or recognized time | Which timestamp decides the day, week, or month? |
| What outcome qualifies? | Attempted, completed, billable, paid, non-failed, accepted, or final terminal state | Which statuses count, and which belong in the denominator? |
| How are retries handled? | Every attempt, final attempt, one retry family, or one business object | What is the deduplication key and final-state rule? |
| What does `active` mean? | Login, site visit, generation, distinct active days, spend, contract, or accepted work | Which event, minimum count, distinct-day rule, entity, and window define active? |
| Which money is shown? | Contracted, booked, billed, accrued, recognized, collected, refunded, or net cash | What business question should the headline answer? |
| When is money counted? | Contract signature, Closed Won, invoice creation, invoice finalization, service period, `paid_at`, or bank settlement | Which event owns the period, and should the others appear as reconciliation lines? |
| Which amount wins? | Signed contract, CRM amount, invoice, warehouse row, or manually approved adjustment | What is the source priority when values disagree? |
| How are adjustments treated? | Credits, refunds, tax, chargebacks, open invoices, commitments, minimums, and usage drawdown | Are these included, excluded, or reported separately? |
| How is identity attributed? | Direct user ID, API key owner, organization membership, email domain, CRM association, or payer | What happens when attribution is missing or several identities match? |
| What is the time window? | UTC calendar period, trailing elapsed duration, cohort age, matched MTD, or complete period only | What are the exact start and end boundaries, and may incomplete periods publish? |
| How do sources align? | Latest value from each source or oldest shared complete watermark | How much source lag is allowed before the result becomes partial or stale? |
| Which source is authoritative? | Direct source table, signed document, accounting system, CRM, Stripe, or Metabase reference | Which source decides the value, and which sources only verify it? |
| Can history change? | Recalculate all history, freeze after close, or preserve current-clean and as-reported views | When is a period final, and what later change requires a restatement? |
| How is the value displayed? | Exact amount, rounded amount, percent, percentage-point change, pace, or annualized value | Which transformations are presentation only, and which change the metric? |

## Questions for Prady: Weekly Revenue Lite

Ask these in one review. Record each answer in a new metric version before the report
is called certified.

| Decision | Current Atlas behavior | Alternatives to confirm | Why it changes the answer |
| --- | --- | --- | --- |
| Master product run-rate | Active self-serve licensed plan value plus projected accrued usage | Contracted ARR, invoiced revenue, recognized revenue, or cash | These measure different economic events and must not share one label. |
| Usage event time | `generationEndedAt` | `generationCreatedAt` or invoice time | A generation can cross a period boundary or fail after creation. |
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
