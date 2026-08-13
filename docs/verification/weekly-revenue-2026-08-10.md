# Weekly Revenue Lite verification

## Artifact

- Report: `sync weekly revenue lite - week ending 2026-08-09`
- Reporting week: `[2026-08-03 00:00 UTC, 2026-08-10 00:00 UTC)`
- Report data cutoff: `2026-08-10 16:00 UTC`
- Verification run: `2026-08-13 UTC`
- Source systems: TinyBird CH database 166 and HubSpot CRM

## Result

| Reported line | Source replay | State | Evidence |
| --- | ---: | --- | --- |
| August usage actual | $233,726.76 | Verified | `generationEndedAt` from Aug 1 through the report cutoff |
| August usage pace | $749,537.52 | Verified | Exact elapsed-second pace for a 31-day UTC month |
| July complete usage | $854,643.63 | Verified | Complete July UTC month |
| August pace vs. July | -12.298% | Verified | Pace divided by July complete usage |
| July usage NDR | 106.486% | Verified | Fixed June starting organization cohort |
| Weekly usage NDR proxy | 88.748% | Verified | Jul 27-Aug 2 cohort retained in Aug 3-9 |
| Usage outside starting cohort | $19,761.27 | Verified | Total report-week usage minus retained cohort usage |
| Total usage week over week | -0.837% | Verified | Complete UTC weeks |
| NDR tier splits | Matches reported values | Verified | Enterprise, Scale, Growth, Creator, and Hobbyist all reproduce |
| August Stripe collections | $165,878.53 | Verified after query correction | One row per invoice; invoice created in August and `paid_at` before the cutoff |
| Licensed subscription base | $272,527 deterministic replay vs. $272.1k reported | Does not reproduce | The difference is about $400 at the displayed precision; the mirror has no webhook ingestion time and cannot reconstruct its Aug 10 state exactly |
| Product run-rate | $1,022,064.52 deterministic replay vs. $1.022m reported | Matches at displayed precision | Usage is exact; the subscription component has the historical-state limitation above |
| Annualized run-rate | $12,264,774 deterministic replay vs. $12.26m reported | Matches at displayed precision | Monthly run-rate multiplied by 12 |
| Enterprise Closed Won | $36,000 | Verified | Prabhushree entered Enterprise Closed Won on Aug 3 |
| Studio Closed Won | $0 | Verified | No Studio deal entered Closed Won during Aug 3-9 |
| New priced pipeline | $10,000 | Verified | Panda Video was created Aug 5 in Enterprise Evaluation |
| New unpriced Studio pipeline | 1 deal | Verified | DNEG was created Aug 7 in Studio Discovery without an amount |
| Newly quantified Channel pipeline | $10,000 | Verified | Postudio was created July 30, then received its amount and Evaluating stage on Aug 3 |
| USC commitment | HubSpot $292 | Partially verified | Stage moved Aug 3; the $334.25 signed evidence is outside HubSpot and still needs its source artifact |

## Corrections made

The prior Stripe cash query selected the current invoice state for invoices created
before the cutoff. That produced $135,655.25 when replayed later because lifecycle
changes after the report could alter the selected state. The corrected query groups
by invoice ID and uses the immutable Stripe `status_transitions.paid_at` timestamp.

The prior subscription query used `argMax(status, createdAt)`. Stripe lifecycle rows
reuse the subscription creation time, so ties produced different answers on identical
runs. The replacement reduces rows deterministically by subscription ID and treats a
terminal cancellation as final. Three identical pinned executions returned the same
result.

## Remaining trust work

1. Store the subscription webhook event or ingestion timestamp in TinyBird. Until
   then, a past cutoff cannot distinguish a lifecycle update that arrived before the
   report from one that arrived later.
2. Preserve every delivered report as an immutable Atlas snapshot. A sent report
   must link to that snapshot instead of recalculating its old cutoff from mutable
   mirrors.
3. Complete the scalable Product eligibility join for revenue and NDR metrics. This
   verification reproduces the Rudy report population; it does not certify the
   banned, anonymous, and internal-user exclusion policy for every revenue query.
4. Attach the USC signed-commitment source artifact before treating $334.25 as a
   verified Atlas value.
