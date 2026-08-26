# Customer economics verification

## Scope

This pack turns Matt's customer-analysis method into governed Atlas questions. It
separates paid-invoice reporting from the accrued operating view.

## Questions

| Atlas question | Answer | Basis | State |
| --- | --- | --- | --- |
| 7400 | Paid invoice revenue by month | Paid Stripe invoices, assigned to invoice creation month | Verified for July 2026 |
| 6027 | Logo churn and gross logo retention by plan | Stripe cancellation with no active paid subscription at month end | Reconciling |
| 7401 | Paid-invoice NDR and GRR by plan | Same-customer paid invoice revenue | Reconciling |
| 7402 | Paid-invoice cohort revenue retention | First successful payment cohort; paid invoice revenue | Reconciling |
| 7403 | Usage-active subscribers by plan | Active paid subscription at month end and completed-generation activity | Reconciling |
| 7404 | Realized LTV and CAC target | Cumulative paid invoice revenue with explicit margin assumptions | Reconciling |
| 7405 | Paid customer win-backs | Paid invoice revenue after a full zero-revenue month | Reconciling |

## Completed checks

- All queries are read-only and run successfully against TinyBird CH database 166.
- Question 7400 returns `$733,883.46` for July 2026. Matt's reference is `$733,883`.
- Logo churn uses Stripe cancellation. Same-month resubscriptions are not churn.
- NDR means net dollar retention. It includes expansion from the starting customer
  group. GRR means gross revenue retention. It caps retained revenue at the starting
  amount so expansion cannot increase the result.
- Cohort month zero uses the first positive paid invoice or successful Stripe charge,
  whichever happens first.
- Country is not published as verified. Current source coverage does not reproduce
  Matt's country table.

## Open reconciliation work

1. Ask Rudy to explain why the delivered panel has `38,248` distinct organization IDs
   while his source note says `48,190` customer IDs.
2. Reproduce Matt's 2026 YTD country totals before publishing a governed country view:
   US `$2,569,160`, UA `$466,186`, and HK `$281,167`.
3. Reconcile plan-level churn, retention, cohort, LTV, and win-back outputs with Matt's
   reference workbook.
4. Replace the current tier gross-margin assumptions after Matt updates the Andromeda
   cost allocation.

## Trust rule

A successful query is not enough for a green check. Atlas marks a result verified only
after the definition is approved, the query returns data, the immutable snapshot is
stored, and the result matches an independent reference within the stated tolerance.
