# QBR quarter reads and North Star readiness

## Outcome

Allow agents to select saved Atlas question snapshots by `YYYY-Q1` through
`YYYY-Q4`, alongside existing month and day selectors. Preserve the optional
`asOf` cutoff, exact snapshot selection, immutable provenance, and read-only
authorization. A quarter selector identifies the snapshot's reporting period;
it does not turn supporting tables into observations or filter individual rows.

## Source reconciliation

Use the North Star workbook exports captured on October 3, 2026 at 08:50 and
08:52 UTC. The user selected those exports. Google Sheets CLI login is deferred
at the user's request because no approved Desktop OAuth client is configured.

The [row-by-row reconciliation](north-star-sheet-reconciliation.md) maps authored
workbook rows to canonical Atlas question URLs. It separates scoped PLG results,
missing company observations, and supporting tables. Unknown periods remain
unknown. No source refresh or shared-data write is part of this change.

Captured input hashes (SHA-256):

| Artifact | Hash |
| --- | --- |
| Overview export, 08:50 UTC | `909235861bebe34200fd79d4faf8568172ed2f32c8294caea70ee75eee26f014` |
| KPI export, 08:52 UTC | `6d30a90a753ce834f4fd25d4f12231e00b7cd357eafbf12e14094940d58ee3f8` |
| Saved report after North Star supporting imports | `0a519eaade43df84a8763773ee433602305fc4cf3e575261513a630b004dba6f` |

The private arithmetic preview is `.output/qbr-invoice-annualization-preview.json`.
It retains source question, snapshot, definition and query identifiers, status,
extraction time, and unknown data-through coverage. Q553's selected-period
formula gives Q3 `$1,923,289.04 × 12/3 = $7,693,156.16`. The Sheet's ending-month
pace gives September `$624,410.46 × 12 = $7,492,925.52`. Neither candidate fills
a saved observation or the company actualized-revenue KPI.

## Remaining work for the company scorecard

| Gap | Required evidence or decision | Accountable lead in Atlas |
| --- | --- | --- |
| Company professional teams | Stable team IDs, complete September agreement/SOW and qualifying-activity rosters, cross-door deduplication | Noah, Sanjit, Hadi; confirm the authored door policy with Prady |
| Prosumer qualification | Resolve Sheet `>3` generations against current Atlas `>=3`, paying versus accrued value, and the meaning of sustained | Noah; business definition approval |
| Enterprise and partner qualification | Approve actual contract term versus `/12`, preferred-partner mapping, and the two unresolved partner thresholds | Sanjit; business definition approval |
| Actualized revenue, YTD, gross margins | Approved revenue events and complete Finance close rows with revenue, COGS, adjustments, and allocation | Pavan with Matt |
| Company NDR and concentration | Fixed cohort, customer-parent identity, consistent revenue basis, complete door attribution, and Finance reconciliation | Pavan with Matt; commercial mapping from Sanjit/Hadi |
| Active rate | September paid-base identity/state history, idle paid teams retained, and explicit subscription/contract/credit/PAYG rules | Noah and commercial owners |

These are evidence requests and definition gaps. This change sends no outreach.

## Implementation and verification

1. Extend API and MCP question filter validation to accept valid quarter keys.
2. Verify quarter plus `asOf` through the HTTP boundary and the MCP SDK; retain
   number-only, month, and day behavior and reject invalid selectors.
3. Update the copied agent instructions and API/MCP documentation with accepted
   formats and saved-snapshot semantics.
4. Review the integrated diff, run affected type/lint checks, and publish a
   non-draft PR. Follow CI to its observed result. Production behavior remains
   unchanged until deployment of both the Atlas API and Rudy MCP adapter.

The existing saved Q3 report has 135 definitions and 11 Q3 observation keys.
The other 124 keys are absent, including three structural N/A definitions.
Supporting tables do not change that count. All 11 saved Q3 values retain their
reported or provisional status and unknown data-through coverage.

## Local proof

- The new HTTP contract failed before implementation: `2026-Q3` returned 400;
  invalid calendar periods reached the service. It passes after the fix,
  including quarter plus `asOf`, month, day, number-only reads, and invalid keys.
- `bunx bun@1.3.12 test src/atlas-query/atlas-query.http.test.ts` from `apps/api`:
  one passing boundary test, seven assertions.
- `uv run --no-project --python 3.12 --with mcp==1.26.0 python -B -m unittest
  discover -s ops/rudy/mcp`: ten passing tests, including real SDK registration.
  The quarter/as-of route check verifies the encoded upstream selector.
- API and app type checks passed. Biome passed for the affected TypeScript
  files. `git diff --check` passed.
- Decimal arithmetic independently confirms the source months sum to Q3 and
  both annualization formulas above. No source query or shared write ran.
