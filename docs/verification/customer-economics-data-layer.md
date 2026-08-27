# Customer economics verification

## Scope

This pack turns Matt's customer-analysis method into governed Atlas questions. It
separates paid-invoice reporting from the accrued operating view.

## Questions

| Atlas question | Answer | Basis | State |
| --- | --- | --- | --- |
| 7400 | Paid invoice revenue by paid-event month | Paid Stripe invoice source events, assigned to the source event's UTC month | Verified for July 2026 |
| 6027 | Logo churn and gross logo retention by plan | Stripe cancellation with no active paid subscription at month end | Reconciling |
| 7401 | Paid-invoice NDR and GRR by plan | Same-customer paid invoice revenue | Reconciling |
| 7402 | Paid-invoice cohort revenue retention | First positive paid-invoice month; paid invoice revenue | Reconciling |
| 7403 | Usage-active subscribers by plan | Active paid subscription at month end and completed-generation activity | Reconciling |
| 7404 | Realized LTV and CAC target | Cumulative paid invoice revenue with explicit margin assumptions | Reconciling |
| 7405 | Paid customer win-backs | Paid invoice revenue after a full zero-revenue month | Verified definition and query |
| 7406 | Paid-invoice baseline and V3 top-up context | Paid invoices plus successful V3 top-ups, reported as separate values | Verified definition and query |

## Completed checks

- All queries are read-only and run successfully against TinyBird CH database 166.
- Question 7400 returns `$733,883.46` for July 2026. Matt's reference is `$733,883`.
- Logo churn uses Stripe cancellation. Same-month resubscriptions are not churn.
- NDR means net dollar retention. It includes expansion from the starting customer
  group. GRR means gross revenue retention. It caps retained revenue at the starting
  amount so expansion cannot increase the result.
- Cohort month zero uses the first month with positive paid-invoice revenue. A cohort
  based on the first successful payment of any type is a separate measure.
- Question 7406 proves the scope bridge. July 2026 contains `$733,883.46` of paid
  invoices and `$6,741.91` from `249` successful V3 top-ups. The paid-invoice result
  ties Matt's panel. The V3 amount stays visible because Matt's panel may not include
  the full V3 revenue model.
- Country is not published as verified. Current source coverage does not reproduce
  Matt's country table.

## Open reconciliation work

1. Reproduce Matt's 2026 YTD country totals before publishing a governed country view:
   US `$2,569,160`, UA `$466,186`, and HK `$281,167`.
2. Reconcile plan-level churn, retention, cohort, and LTV outputs with Matt's
   reference workbook.
3. Obtain a fixed historical subscription panel or an event-ingestion timestamp. The
   live subscription mirror repeats the Stripe object's original creation time and
   cannot reconstruct the exact population that was active at an old month end.
4. Replace the current tier gross-margin assumptions after Matt updates the Andromeda
   cost allocation.

The population difference is now explicit instead of treated as a hidden error.
Matt's fixed panel contains `38,248` organization IDs. The current live mapping contains
`39,763` organization IDs. Rudy's `48,190` value counts customer IDs, which is a
different unit. Atlas stores the population version with each snapshot and does not
compare these values as if they were the same cohort.

## Trust rule

A successful query is not enough for a green check. Atlas marks a result verified only
after the definition is approved, the query returns data, the immutable snapshot is
stored, and the result matches an independent reference within the stated tolerance.
The reference must use the same population, revenue basis, and reporting period. Atlas
does not remove V3 revenue only to make a broader result match an older reference.
