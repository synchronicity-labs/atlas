# Customer economics verification

## Scope

This pack turns Matt's customer-analysis method into governed Atlas questions. It
separates paid-invoice reporting from the accrued operating view.

## Questions

| Atlas question | Answer | Basis | State |
| --- | --- | --- | --- |
| [277](https://atlas.pr.sync.so/questions/277) | Paid invoice revenue by paid-event month | Paid Stripe invoice source events, assigned to the source event's UTC month | Verified for July 2026 |
| [186](https://atlas.pr.sync.so/questions/186) | Logo churn and gross logo retention by plan | Stripe cancellation with no active paid subscription at month end | Reconciling |
| [278](https://atlas.pr.sync.so/questions/278) | Paid-invoice NDR and GRR by plan | Same-customer paid invoice revenue | Reconciling |
| [279](https://atlas.pr.sync.so/questions/279) | Paid-invoice cohort revenue retention | First positive paid-invoice month; paid invoice revenue | Reconciling |
| [280](https://atlas.pr.sync.so/questions/280) | Usage-active subscribers by plan | Active paid subscription at month end and completed-generation activity | Reconciling |
| [281](https://atlas.pr.sync.so/questions/281) | Realized LTV and CAC target | Cumulative paid invoice revenue with explicit margin assumptions | Reconciling |
| [282](https://atlas.pr.sync.so/questions/282) | Paid customer win-backs | Paid invoice revenue after a full zero-revenue month | Verified definition and query |
| [283](https://atlas.pr.sync.so/questions/283) | Paid-invoice baseline and V3 top-up context | Paid invoices plus successful V3 top-ups, reported as separate values | Verified definition and query |

## Completed checks

- All queries are read-only and run successfully against TinyBird CH database 166.
- Question 277 returns `$733,883.46` for July 2026. Matt's reference is `$733,883`.
- Logo churn uses Stripe cancellation. Same-month resubscriptions are not churn.
- NDR means net dollar retention. It includes expansion from the starting customer
  group. GRR means gross revenue retention. It caps retained revenue at the starting
  amount so expansion cannot increase the result.
- Cohort month zero uses the first month with positive paid-invoice revenue. A cohort
  based on the first successful payment of any type is a separate measure.
- Question 283 proves the scope bridge. July 2026 contains `$733,883.46` of paid
  invoices and `$6,741.91` from `249` successful V3 top-ups. The paid-invoice result
  ties Matt's panel. Matt explicitly excludes standalone top-ups from his revenue
  tables and includes them only in the collections funnel. This is a scope choice,
  not evidence that he forgot V3. Atlas shows the top-ups separately and does not
  silently add them to the paid-invoice reference.
- Country is not published as verified. Current source coverage does not reproduce
  Matt's country table.

## Open reconciliation work

1. Reproduce Matt's 2026 YTD country totals before publishing a governed country view:
   US `$2,569,160`, UA `$466,186`, and HK `$281,167`.
2. Reconcile plan-level churn, retention, cohort, and LTV outputs with the July
   reference panel. The two supplied analysis workbooks stop at March 2026 and
   cannot establish the July results.
3. Obtain a fixed historical subscription panel or an event-ingestion timestamp. The
   live subscription mirror repeats the Stripe object's original creation time and
   cannot reconstruct the exact population that was active at an old month end.
4. Replace the current tier gross-margin assumptions after Matt updates the Andromeda
   cost allocation.

## Source-artifact audit, 27 August 2026

The supplied ZIP was checked independently from Atlas's live queries. Its SHA-256 is
`148ded9695ef74e26d9dbf1d202d25d5f0d64f2daf618154d175fa43d29faf49`.
No customer-level exports are stored in this repository.

| Supplied evidence | Check | Result |
| --- | --- | --- |
| Customer identity mapping | Count rows and distinct nonempty `org_id` values | 48,190 rows and 48,190 distinct organization IDs; no blanks |
| Enterprise and partner invoice lines | Count lines and organizations | 15,087 lines for 75 organizations |
| Invoice-line tie-out | Independently sum lines and compare with the panel for each organization-month | All 412 organization-months match; maximum absolute difference is $0.00 |
| `methodology_and_sanity_checks.csv` | Read the period rule for Export 4 | Invoice-paid event month in UTC, from `sync_prod.sync_stripe_invoices_paid` |
| Both supplied analysis workbooks | Check the covered months | End in March 2026; do not contain the July reference panel |

The exact line tie-out verifies the supplied allocation for those 75 organizations.
It does not verify the full customer population or every retention table.

Matt reports 38,248 organization IDs in his final panel. The ZIP instead contains
48,190 distinct organization IDs. A separate live query returned 39,763 organization
IDs. The ZIP does **not** prove that customer-to-organization mapping explains the
48,190 to 38,248 difference. That explanation remains unverified.

The export's paid-event-month rule also differs from Matt's later description of
paid invoices assigned to invoice month. Matching one July total does not prove that
these date rules are equivalent. Atlas labels its working question by the rule it
actually executes.

### Evidence still needed

- The exact July panel and the query or transformation that produced it, including
  population exclusions. This will resolve the population and date-rule differences
  without asking Matt to redefine all metrics again.
- Historical subscription events or dated snapshots to establish the plan and active
  state at each old month end. Current object state alone is not enough.
- The country-bearing source rows or access that reproduces the country reference.
  Atlas must not replace billing country with signup IP or PostHog location.
- Updated serving-cost allocation before treating tier margins or acquisition-cost
  targets as approved values. The 3:1 target is still an assumption.

## Trust rule

A successful query is not enough for a green check. Atlas marks a result verified only
after the definition is approved, the query returns data, the immutable snapshot is
stored, and the result matches an independent reference within the stated tolerance.
The reference must use the same population, revenue basis, and reporting period. Atlas
does not remove V3 revenue only to make a broader result match an older reference.
