# Atlas takeover: 7 September 2026

## Ready for review

PR 77 contains Noah's Product definitions and privacy work, merged with current main. The takeover fixes public question lookup in the standalone agent, malformed negative-feedback rows, date aliases at the API boundary, and chart unit handling. Mixed-unit single-axis charts show a table instead of silently dropping selected measures. Compatible dashboard lines keep separate axes. Q137 still uses only its saved percentage metrics.

GitHub CI and all three Vercel preview deployments passed at commit `7a1b613`. The PR is no longer a draft. It is not merged.

## Repaired and checked against live sources

| Area | Result | Remaining deployment step |
| --- | --- | --- |
| Q291 cancellation incentive report | Fixed the timezone-dependent week join. All six existing verification checks pass. Republished 120 rows through 7 September 00:00 UTC. The latest complete week has 13 offered organizations, two rewards, and USD 20 granted. Protected reads report VERIFIED and fresh. | Merge the source-reliability follow-up so scheduled refreshes keep this fix. |
| Pylon support | Added request pacing, bounded rate-limit retries, response validation, and fail-closed pagination. A live sync read 4,876 issues and wrote six snapshots. The source is HEALTHY and Q255 is fresh. | Merge the follow-up. Fresh support snapshots do not imply that unresolved CS metric definitions are certified. |
| Modal economics | Imported 13 aggregate month/model rows using the production integration credential. Rebuilt all seven dashboard questions with no errors. Q100 and Q101 are VERIFIED and fresh. | The host collector has no scheduled Atlas import. It still needs a recurring runner with a scoped Atlas sync credential. The current import expires after 30 hours; the six-hour economics refresh cannot replace it. |
| Catalog trust | Q186 was showing the status of a different linked metric. Catalog list and summary now derive readiness from the actual canonical question. Tested on live records: Q186 reports RECONCILING. | Merge the follow-up. No definition or certification was overridden. |

The Modal CLI works both with local scoped credentials and Rudy's existing credential wrapper. The import script now recognizes the wrapper and skips empty date ranges on the first day of a month. Local and production Atlas sync credentials differ; production imports must use the production integration credential. No credentials were written to the repository.

## Source material that needs an owner

The latest ingestion reports two contract files without usable contract text: a PDF with a removed-document notice and a document with no readable text. These files were not opened again during this takeover. Check the source documents before choosing restoration, replacement, OCR, or explicit retirement. Do not manufacture terms or certify the missing evidence.

## Decisions still required

1. Name the approved revenue numerator for the two revenue-per-user views. Noah's PR resolves the user denominators, not which revenue measure to use.
2. Approve the remaining finance contracts and reconciliation references: booked revenue, company COGS and margin, burn and runway, and the exact Matt cohort panel and exclusions. Inference contribution margin is not company gross margin.
3. Resolve the legacy Q138 per-generation feedback deduplication rule, or retire it in favor of the governed event-level views.
4. Resolve the open CS entity and time-window definitions and human persona labels.
5. Authorize a narrowly scoped Atlas ingestion credential for a recurring Modal collector on Rudy. Its existing Modal billing wrapper has read access, but it does not have an Atlas ingestion credential. The Atlas production import was run from the authorized local integration environment.

## Engineering work that is still open

This repair does not complete every Product question family. Keep these distinct from owner decisions and from missing instrumentation:

1. Align Q297–Q302 with Noah's governed user-first and organization-segment contracts. An access channel is not a web surface. Overlapping API/web organization segments must not be summed into an all-organization total.
2. Complete lifecycle horizons and lapsed-population denominators. The current lifecycle view is M1, and return/requalification percentage denominators are not complete.
3. Add the remaining reusable dimension controls and query-level filtering. The date-alias fix does not add surface, workflow, segment, or horizon selectors.
4. Finish the billing experiment's Product retention and return diagnostics. Its subscription and cash readouts already run.
5. Finish the cross-site identity rollout and signup outcome reconciliation. Shared tracking hooks alone do not complete attribution.
6. Replace generic checks on the feedback and failure question families with definition-specific checks before describing the complete requested families as verified.

Feedback exposure and downvote abandonment remain unmeasured. Full structured failure/rejection and retryability coverage, plus event-time dimension history, cannot be invented from present-day organization fields. Null or unavailable must not be changed to zero.

## Verification

PR 77: 334 API source tests, 84 app tests, targeted protected-read and agent tests, type checks, lint, and GitHub CI passed. React Doctor reports four existing structural warnings about component complexity and related state; it reports no new runtime finding from these changes. No rendered browser acceptance test was run in this takeover.

The source-reliability follow-up has targeted tests for UTC week joins, source-isolated refresh, Pylon pacing/retries/pagination, and canonical catalog readiness. Live refreshes were limited to the affected sources. No Slack report was sent and no finite recurring report run was consumed.
