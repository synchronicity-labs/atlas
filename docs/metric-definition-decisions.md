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
| Activated organization | An eligible organization that reaches the metric's stated activation event. | The V2 scoreboard currently uses 3+ billable generations on 2+ distinct UTC days. Each metric version must state its exact threshold. |
| Professional organization | An eligible organization that passes the approved accrued-value, completed-generation, and active-day gates for the period. | The threshold and billing-version population belong in the metric version, not only in dashboard copy. |
| Recurring or retained | The same starting entity satisfies an explicitly named later-period condition. | The metric must say whether retention means product activity, subscription status, spend, or full requalification. |
| Completed generation | A generation whose final Product status is `COMPLETED`. | Confirmed by the Product owner for the scorecard. |
| Billable generation | A generation started while its organization is on a non-free plan. Product stores the plan and billing source when the generation is accepted. | Confirmed by the Product owner. Billing or collection problems are measured by the separate paid-qualified guardrail. |
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

### Revenue-door classification

Company revenue is measured as four separate businesses:

| Revenue door | Meaning | Current Atlas treatment |
| --- | --- | --- |
| `sync.tools` | V2 and V3 self-serve subscriptions, V2 postpaid usage, and V3 top-up payments | The Weekly Revenue questions calculate each component and the combined total. |
| `sync.partners` | Channel-partner revenue | Excluded from `sync.tools` and measured separately. |
| `sync.productions` | Professional services and enterprise commitments | Excluded from `sync.tools` and measured separately. |
| `sync.enterprise` | Contracted enterprise revenue | Excluded from `sync.tools`; Prady asked to define this last. |

Atlas stores this classification in the `revenueDoorPolicy` and `revenueDoorRule`
tables. Queries do not contain a permanent list of customer names. Each rule has a
door, match type, value, evidence, and active state. The current rules exclude
`enterprise`, `program`, and `partner` plans. They also exclude organizations linked
to `fal.ai`, `higgsfield.ai`, `replicate.com`, and `magichour.ai` from `sync.tools`.

Sanjit's partner register names seven current partners: Fal, Higgsfield, Replicate,
MagicHour, Adapt Global, Runware, and Segmind. Atlas resolves those partners from the
listed domains and live Product organization records. The register still needs three
mapping corrections: Replicate repeats Higgsfield's billing mapping, MagicHour and
Runware share one Product organization mapping, and Adapt Global has no Product
organization mapping. Atlas applies confirmed matches but keeps affected revenue
results in `PENDING` trust state until those exceptions are resolved. Existing report
snapshots remain immutable; later runs use the corrected policy version and evidence
hash.

Ask these in one review. Record each answer in a new metric version before the report
is called certified.

| Decision | Current Atlas behavior | Alternatives to confirm | Why it changes the answer |
| --- | --- | --- | --- |
| Self-serve month-end estimate | Active V2 and V3 subscription value plus estimated V2 postpaid usage plus estimated successful V3 top-up payments | Contracted ARR, invoiced revenue, recognized revenue, or cash | These measure different economic events and must not share one label. V3 credit consumption is not added as revenue. Complete months always use actual values. |
| Product activity period | `generationCreatedAt` in UTC | Completion or settlement time | This keeps behavioral cohorts stable when a generation crosses a period boundary. |
| V2 usage revenue period | Successful V2 postpaid usage after completion, represented by `generationEndedAt` in TinyBird | Start time or invoice time | Failed generations are not billed. Revenue therefore cannot use the activity clock without changing the economics. V3 credit consumption is excluded from revenue. |
| V2 plan and billing path | The organization plan and billing source are fixed when the generation starts | Use completion-time plan | Product persists `Generations.organizationPlan` and `billingSource` at admission. TinyBird V2 usage uses that plan snapshot. This part is confirmed. |
| V2 price and discount timing | The current Stripe price can still be resolved when successful usage is reported after completion | Freeze the price and discount when the generation starts | A user can change subscription price or discount while a generation is running. This decision is still open. |
| V3 credit settlement | Reserve at generation start, capture actual usage after success, and release the hold after failure | Charge immediately or price again at completion | The persisted hold and billing source keep the accepted billing path stable through the generation lifecycle. |
| V3 revenue event | Successful one-time Stripe top-up payments plus recurring V3 subscription value | V3 credit consumption or usage value | V3 consumption spends prepaid credits and is not new revenue. The top-up payment is the variable revenue event. |
| V3 paid-qualified month | V3 subscription invoices plus successful top-up payments in the same UTC month | Subscription invoices only, top-up payments only, or another threshold | V3 does not produce postpaid usage invoices. The Product owner must confirm the paid-qualified guardrail. |
| Stripe reconciliation line | Cash from invoices whose Stripe `paid_at` is inside the cutoff | Invoice creation, invoice finalization, due date, service period, or payment settlement | “Created,” “billed,” and “paid” answer different questions. If invoice creation is wanted, Atlas should add an `invoice billings` metric instead of changing `cash collected`. |
| Enterprise and Studio bookings date | HubSpot stage-entry history is used for CRM verification | Contract signature timestamp or work-start timestamp | A contract can be signed before Sales moves the deal, and work can start later. |
| Signed amount precedence | HubSpot amount is accepted only as CRM evidence; a conflicting signed amount remains partial | Signed contract always wins, HubSpot always wins, or a named reconciliation owner resolves conflicts | USC is `$292` in HubSpot and `$334.25` in the cited source thread. |
| Licensed subscription base | Current active or past-due subscriptions multiplied by the recurring licensed Stripe item price and quantity stored in the raw subscription payload | Invoice-item accrual, contracted price, or collected license cash | Current state is useful for run-rate but cannot replay an old close without lifecycle ingestion time. New self-serve plans flow through after the governed revenue-door policy accepts them. |
| Enterprise commitments | Excluded from master Product run-rate | Include contracted commitments, usage drawdown, or only the unused commitment balance | Adding commitments and usage can double count the same economics. |
| Complete channel-partner list | Known partner domains and `partner` plans are excluded from `sync.tools`; the registry is partial | Confirm every partner organization and its effective date | A missed partner inflates self-serve revenue and retention. |
| Partner pricing source | Product plan and domain identify the door; contract-specific tiers are not yet normalized | Signed agreement, Stripe price, CRM deal, or an approved plan configuration | Partners can share one commercial structure while using different prices and thresholds. |
| Report finality | The delivered snapshot is immutable | Recalculate old reports after source corrections | An immutable close is reproducible; a live dashboard may still restate history. |

The current Stripe cash calculation is correct for the label **paid invoice
collections**. It is not a decision that Prady wants cash as the operating KPI. If he
wants invoice creation or contract signature, Atlas should publish a separate metric
with that exact name and event timestamp.

## Product Scoreboard decisions

Tair confirmed the following rules. They now belong in the metric versions and query
verification evidence, not in an open-question list.

| Decision | Confirmed Product rule |
| --- | --- |
| Generation period | Assign a generation to the UTC month when it started. A generation started on July 31 and completed on August 1 belongs to July. |
| Completed status | Only final Product status `COMPLETED` counts as completed. |
| Billable generation | The generation started while its organization was on a non-free plan. Product persists the plan and billing source when the generation is accepted. V2 TinyBird `organizationPlanType` is derived from that admission snapshot. |
| Failed generation billing | Failed generations do not become usage revenue. V3 reserves credits at start and releases the hold after failure. |
| Professional organization | A V2 self-serve organization-month with `$100+` accrued value, 3+ completed billable generations, and activity on 2+ distinct UTC days. |
| Activated organization | A V2 self-serve organization-month with 3+ completed billable generations across 2+ distinct UTC days, before the `$100` gate. |
| M3 | The same fixed starting cohort two calendar months after the starting month. It is not 90 elapsed days. |
| Completion rate | Weekly `COMPLETED` non-deleted generation records divided by all non-deleted generation records, using final Product status. |

Two feedback decisions remain open because the Product sheet defines upvote rate and
coverage as separate measures:

1. For generation upvote rate, does positive mean thumbs-up, 4–5 stars, or both? If a
   generation has more than one rating, does it count once or more than once?
2. For feedback coverage, which denominator is the official scorecard measure: first
   generation per organization, all eligible `COMPLETED` generations, or all eligible
   terminal generations?

Two billing decisions remain open:

3. If an organization changes its Stripe price or discount while a V2 generation is
   running, should the generation use the price from start time or the price visible
   when successful usage is reported? The plan and billing source are already fixed at
   start, but the price can still be resolved at completion.
4. For the V3 paid-qualified guardrail, should the monthly paid amount include the V3
   subscription invoice plus successful top-up payments, subscription invoices only,
   or another approved amount?

The approved self-serve revenue model is:

- subscription run-rate: active V2 and V3 recurring plan value;
- V2 usage run-rate: completed V2 postpaid usage, assigned by `generationEndedAt`;
- V3 top-up run-rate: successful one-time V3 top-up payments, assigned by payment
  `createdAt`;
- variable revenue run-rate: V2 usage run-rate plus V3 top-up run-rate;
- total self-serve run-rate: subscription run-rate plus V2 usage run-rate plus V3
  top-up run-rate.

For the current incomplete UTC month, V2 usage and V3 top-ups are paced from the exact
shared data-through time. Complete months show actual values. V3 credit consumption is
an operating usage measure, not a revenue component.

## Customer economics decisions

Matt confirmed the reporting rules used by the customer and data-room analyses. Atlas
uses these rules for the Customer economics questions. A query is not marked verified
until its result also matches an independent reference output.

| Measure | Governed rule | Current trust state |
| --- | --- | --- |
| Paid invoice revenue | Sum paid Stripe invoices by invoice creation month. Subscription MRR, plan mix, concentration, and the data-room retention tables use this paid-invoice basis. Past-due subscriptions without a paid invoice contribute zero. | Verified for July 2026: `$733,883.46`, which rounds to Matt's `$733,883` reference. |
| Logo churn | An organization churns in the UTC month of a Stripe subscription cancellation only when it has no paid subscription active at month end. A cancellation followed by a resubscription in the same month is not churn. | Query runs; historical plan-level results still need reference reconciliation. |
| Governed NDR and GRR | Same-customer paid invoice revenue in the current month divided by the prior-month starting revenue. GRR caps each customer's retained revenue at its prior-month amount. | Query runs; reference reconciliation pending. |
| Operating NDR and GRR | Subscription invoice revenue plus V2 usage accrued when the generation ends. | Supporting operating view only. It is not the governed paid-invoice result. |
| Revenue cohorts | Month zero is the first month with positive paid-invoice revenue or any successful Stripe charge, whichever is earlier. Retention and realized LTV then use paid invoices. | Query runs; reference reconciliation pending. |
| Usage-active subscriber | A customer with an active paid subscription at month end and at least one completed generation in that month. | Query runs; reference reconciliation pending. |
| Realized LTV and CAC target | Realized lifetime value is cumulative paid-invoice revenue for the selected first-pay cohort. The current gross-margin assumptions are Hobbyist 83%, Creator 81%, Growth 72%, and Scale 66%. The CAC target is gross-margin-adjusted LTV divided by 3. | The 3:1 target and tier margins are assumptions, not approved company policy. Matt still needs to update the Andromeda cost allocation. |
| Win-back | A customer with positive paid-invoice revenue after at least one complete UTC month with no paid-invoice revenue. | Query runs; reference reconciliation pending. |
| Invoice-line allocation | Allocate discounts, credits, and customer balance to invoice lines with the deterministic rule from Matt's panel. | Reporting definition, not an estimate. |
| Country | Use the latest non-empty billing country from successful Stripe charges. Fall back to invoice billing or shipping country. Apply the latest country to all historical months. | Reconciling. Do not mark verified until 2026 YTD reproduces US `$2,569,160`, UA `$466,186`, and HK `$281,167`. |
| Customer population | Use distinct organization IDs in the delivered panel. | Reconciling. Matt's panel has `38,248` organizations, while Rudy reported `48,190` customer IDs. Rudy must explain the customer-to-organization collapse before publication. |

Standalone top-up charges are excluded from the governed paid-invoice retention and LTV
tables. They remain visible in the collections funnel. The separate operating view can
show accrued V2 usage, but it must use a different label and cannot replace the paid-
invoice definition.

## Productions definitions

Muhammad Hadi Yusufali approved the business definitions in
[OPS-39](https://linear.app/sync-labs/issue/OPS-39/confirm-how-productions-turnaround-and-quality-should-be-measured).
This resolves the meaning of the three current Productions KPIs. It does not verify a
numeric result because the current workflow does not keep a complete event history.

| Decision | Approved Productions rule |
| --- | --- |
| Operational start | Start when the client has confirmed kickoff and Productions has every usable source file needed to begin. If assets arrive later than the announced date, use the usable-assets-complete time. |
| First submission | The first internally approved package sent to the client. |
| Final delivery | Every agreed deliverable passes internal delivery quality control and is sent to the client. |
| Client acceptance | A separate milestone. Do not include client review time in the main active-production clock. |
| Turnaround clocks | Publish gross elapsed time and active production time separately. Gross time includes client waits. Active time excludes documented waits for client files, decisions, feedback, or approval. |
| Quality pass | A shot passes when an internal quality-control reviewer explicitly approves it. A project passes internal quality control only when every in-scope shot is approved and the assembled deliverable passes final longplay or delivery quality control. |
| Iteration | Count a new output version after quality control sends the shot back. Keep machine-learning and visual-effects iterations separate. A batch review round is not another shot iteration. |
| Comparison groups | Keep proof-of-concept work separate from full Productions work. Keep machine-learning-only work separate from machine learning plus visual effects and delivery. Normalize by processed shot count, finished duration, complexity, and quality-control scope. |
| Time per shot | Use actual human work hours across creation, generation, quality control, rework, and visual effects. Do not substitute wall-clock duration. |

Current project Sheets hold the latest shot state, assignee, quality notes, severity,
and status. Slack, email, and delivery tools hold most timing and version history. Atlas
can reconstruct an explicitly labeled estimate from those records, but it must not call
that result verified. A deterministic result needs Workspaces or Flow to emit status
transitions, version history, assignments, approvals, time entries, delivery events,
and documented pause intervals.

The first reconstruction references are the NTR / Devara
[project Sheet](https://docs.google.com/spreadsheets/d/12WlGYJQNg-8u6Z9Wk1S7roifd1LyhSuVEFuay5isa3Y/edit)
and [execution thread](https://sync-labs-workspace.slack.com/archives/C0B0SKZB51P/p1785091428408359),
plus the Apple TV / Where's Wanda [Linear issue](https://linear.app/sync-labs/issue/PRO-313/apple-tv-wheres-wanda-english-sync-poc)
and [project Sheet](https://docs.google.com/spreadsheets/d/1BLqRz7nLktCbLH2i5FKGWmK3hxaZs4p6PWO7GnXggH4/edit).

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
