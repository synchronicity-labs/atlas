# QBR questions and collection

Atlas owns the definitions, source queries, collection requests and answer history. The QBR repository renders an Atlas report. It must not query Metabase, Product databases or source providers.

The Q3 definition register is `apps/api/src/atlas-query/qbr/registry.json`. It preserves the authored QBR definitions at revision a89b8b1. Each entry has a stable metric ID, accountable lead (with tentative assignments labeled), source requirement, manual request, and Q4 work. Related Atlas questions remain labeled as related evidence; they are not silently substituted for a different definition.

## Operating the connection

Run from the Atlas repository root with the existing Doppler configuration. These commands write the shared Atlas database; they are operator actions, not development fixtures.

```sh
doppler run --project atlas --config local -- bun apps/api/scripts/qbr.ts register
doppler run --project atlas --config local -- bun apps/api/scripts/qbr.ts refresh
doppler run --project atlas --config local -- bun apps/api/scripts/qbr.ts export /tmp/atlas-q3-report.json
```

Registration creates stable Atlas question URLs for all 135 Q3 definitions. Repeated registration retains those IDs. Nine source-backed definitions have runnable SQL; the remaining questions carry their collection plan. The three structural N/A measures stay N/A and require no input. Existing questions owned by a person are not overwritten by this registration.

The initial shared registration includes [PLG teams Q422](https://atlas.pr.sync.so/questions/422), [M3 accrued NDR Q474](https://atlas.pr.sync.so/questions/474), [generation completion Q492](https://atlas.pr.sync.so/questions/492), [Productions revenue Q525](https://atlas.pr.sync.so/questions/525) and [Finance runway Q535](https://atlas.pr.sync.so/questions/535). The exported report contains the complete mapping; consumers must use it rather than calculate question numbers.

Refresh uses the same Atlas clean-population and revenue-door controls as question preview. Results remain provisional. It reads only complete UTC calendar months, stops at the Q3 boundary, preserves M3 starting-cohort labels, and never constructs a quarter value from an incomplete monthly series. The source cutoff advances after month end; a completed calendar month is not proof of source completeness. Unknown data-through watermarks remain null.

The read endpoint is `GET /internal/atlas/reports/qbr/2026-Q3`, protected by the existing `ATLAS_QUERY_SECRET`. It reads saved answers and never triggers provider queries. Deploy the Atlas API change before using that route from the QBR host. Until deployment, the export command produces the same envelope for a local end-to-end preview.

The QBR importer uses `ATLAS_API_URL` and `ATLAS_QUERY_SECRET` only in its server/CLI environment. It validates stable metric IDs, definitions, units and periods. The browser receives the report and canonical question links, never a credential. The hosted QBR is still a published snapshot until its owner connects the import to deployment.

## Missing data to acquire

These are collection workstreams, not requests to redefine Prady's settled metrics. The exact request and evidence limits are stored with each question.

| Workstream | Lead to chase | What we need now | How Atlas should automate it |
| --- | --- | --- | --- |
| Finance close and revenue | Pavan; Sanjit/Hadi supply commercial evidence | Approved period ledger/export with stable economic-event IDs, parent customer, door, amount/currency, credits, revenue basis and close/reconciliation status. Separate earned revenue, signed bookings, usage and cash. | Read-only finance close feed, parent/door allocation, duplicate checks and a complete-source watermark. Reconcile company totals to the four doors before publishing. |
| Enterprise and channel | Sanjit | Active signed-account roster, effective/expiry dates, signed values, contract term, mapped Product/Stripe identities, actual usage and pilot outcomes. A CRM closed-won stage alone is insufficient. | Ingest signed agreement/SOW events and canonical account mappings. Join governed usage to the correct contract and period; retain unresolved mappings as gaps. |
| Productions | Hadi | Signed title/SOW and accepted-job records; usage or earned-service amounts; due/accepted timestamps, deadline changes, shot IDs, touch hours and iterations. | A job/shot event feed and signed SOW/invoice identities. Calculate delivery and accepted-value metrics from that history; do not replace accepted jobs with Studio generated hours. |
| Acquisition | Ana | Monthly unique visitors, clean signups and first-touch attribution reports with bot/internal filters, unknown attribution and eligible-organization joins. | Repair source access and persist first-touch events. Join web/form identities to organizations and keep unknown/failed joins visible. Sessions are not unique visitors. |
| Product outcomes | Noah (tentative; confirm owner) | Experiment exposure/assignment and eligible cohorts, numerator/base, maturity window and outcome events. | Instrument missing events and use fixed mature cohorts. Existing PLG movement and mature M3 queries are already available in Atlas. |
| ML and Research quality | Simran (ML tentative); Prajwal (Research) | Versioned benchmark/evaluation results, model/dataset revisions, sample counts, rubric and acceptance evidence. | Import evaluation artifacts with stable run IDs and dataset versions; retain the measured population and review state. |
| Platform | Tanmay | Source coverage, per-generation latency and matched cost/output-minute records; review the supplied completion population. | Extend existing generation/cost ingestion with complete windows and shared identifiers. Preserve exclusions and disclose unmatched cost/usage. |
| Customer support | Sanjit or designated CS lead | Genuine open-ticket state/history and Pylon organization mappings, with spam/internal exclusions. | Incremental Pylon ticket/status ingestion and reviewed company/organization mapping. |
| Reporting operations | Nacho | Source mappings, unresolved exceptions, measured team-pack preparation time and evidence of validated coverage. | Run the Atlas refresh/export in the existing job runner, retain reviewed snapshots, and add definition/source coverage checks before QBR publication. |
| Runway summary | Pavan | Finance-approved approximate runway as a nonnegative whole-month value, approval date and source summary. | Import that approved summary only. Do not ingest cash balances, forecast operands or financing details into the company QBR. |

## Manual answers this quarter

Save a reviewed input as JSON and import it through Atlas:

```sh
doppler run --project atlas --config local -- bun apps/api/scripts/qbr.ts import-manual /path/to/reported-input.json
```

The file contains `metricId` and `observations`. Each observation includes `period`, finite `value`, nullable `numerator`/`denominator`, `status: "reported"`, `reportedBy`, `evidenceSource: { label, url }`, `asOf` and nullable `dataThrough`. Use the actual source coverage date when known; a submission timestamp is not data-through. The metric's definition, unit and required inputs remain those of its Atlas question. Zero is a value; missing data is not zero. Do not submit structural N/A measures.

Manual import records evidence without asserting verification. Automated refresh cannot replace a reported answer silently. Whole-quarter inputs must describe a completed quarter; September 30 before 00:00 UTC on October 1 is not a closed Q3. No emails or messages are sent by these commands.

## Friday review and Q4 sequence

1. Review canonical Atlas questions and the supplied July/August observations with the functional leads.
2. Resolve source access, account mapping and manual input gaps by workstream above. Confirm tentative Product/ML owners.
3. Collect Finance and functional-lead evidence in Atlas; export it into the presentation.
4. After Q3 closes and source coverage is confirmed, refresh September and provide separately supported quarter aggregations.
5. In Q4, prioritize Finance/contract/Production event ingestion, then acquisition and evaluation feeds. Reuse existing connectors before adding a new source. Add approved source watermarks and metric verification before promoting provisional or reported answers.
6. Generalize the reviewed Q3 registry to future quarter definitions and connect the importer to the QBR deployment pipeline. This first integration does not claim that future quarters or missing provider feeds are already automated.
