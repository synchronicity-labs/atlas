# Ask an agent for Atlas QBR data

On [Atlas Q3 North Star](https://atlas.pr.sync.so/qbr/north-star), find **Ask your
agent for QBR data**. Describe exactly what you need in **What data do you need?**,
then click **Copy prompt** and paste it into your agent. The prompt includes your
request and the instructions for finding Atlas through the existing Rudy MCP
connection. Ask follow-up questions in your own words.

Examples:

- “Show July, August, September, and Q3 revenue and gross margin in a table.”
- “Give me enterprise NDR for Q3 with its definition and supporting evidence.”
- “Which Q3 North Star metrics are missing or stale? Include the source links.”

## Discover the tools

An agent with Rudy MCP connected can search its available tools for `atlas` or
`qbr`, or list the tools exposed by the Rudy server. Client-specific prefixes
may appear before these names. No client-side Atlas API key is needed.

| Tool | When to use it |
| --- | --- |
| `atlas_qbr_report(quarter="2026-Q3")` | Start here. Read a compact summary to discover metric IDs, definitions, observations, statuses, and source links. |
| `atlas_qbr_report(quarter="2026-Q3", metric_ids=["enterprise_usage_retention"])` | Get full evidence for the requested metrics, including preparation and supporting results. Use at most ten IDs per call. |
| `atlas_search_questions(query="revenue")` | Find additional saved questions and their numbers. `latestResult.reportingPeriod`, when present, describes the latest saved snapshot's scope. Search does not return canonical question URLs. |
| `atlas_question(number=question_number, reporting_period="2026-Q3")` | Read a QBR source question's quarterly snapshot, including its monthly observation rows. Set `question_number` from `metrics[id].question.number`. |
| `atlas_source_health()` | Check connector freshness and availability when they are unclear. This does not refresh data. |

Use the summary to select metrics instead of fetching all full evidence. Return
the requested metrics, breakdown, and format. Ask a focused question when the
request is unclear. If a requested breakdown is absent from the saved data,
report that gap.

## Keep the evidence accurate

- Read headline values from `metrics[id].observations`. Treat July (`2026-07`),
  August (`2026-08`), September (`2026-09`), and Q3 (`2026-Q3`) observations
  separately. A monthly value is not a quarter value.
- Preserve units, definitions, observation status, `asOf`, `dataThrough`, and
  canonical Atlas source links. Flag stale, pending, and unavailable data.
- Missing means not reported, not zero. Supporting results are separate evidence;
  do not relabel them as headline observations.
- For QBR source questions, pass `reporting_period="2026-Q3"`, even when
  checking July, August, or September. QBR snapshots are stored under the
  quarter; monthly and quarterly observations are separate rows inside that
  snapshot. Match the requested observation's `period` in those rows.
- For additional questions, select the stored snapshot's period and check that
  its rows cover the requested dates. Catalog metadata describes the latest
  saved period when available; it does not prove coverage for another period.
  Without a filter, `atlas_question` returns the latest snapshot across periods.
- `reporting_period` accepts a quarter, month, or date. It selects the saved
  snapshot for that period; it does not trim or recompute its rows. Use `as_of`
  when the request limits evidence to snapshots captured by a given timestamp.
- Use QBR question numbers and canonical URLs from `metrics[id].question`.
  Search returns question numbers but no canonical URLs. If additional evidence
  has no returned canonical link, cite its question number and explain that the
  link is unavailable. Do not invent URLs or claim missing evidence is present.
- Source health and catalog search do not replace period-specific evidence.

## If Rudy is not connected

Reuse the existing connection when available. Otherwise, expand **Rudy MCP
connection details** on the dashboard to copy the server configuration. The
agent runtime must reach the company Tailscale network at
`https://ip-10-0-3-200-1.tail8782ce.ts.net/mcp`.

If discovery fails, explain which tools or connection are unavailable. Do not
claim to have read QBR data. A person can still open the Atlas dashboard.

The four `atlas_*` tools are read-only. Other Rudy tools have their own
permissions. Server operators can find deployment and rollback instructions in
the [Rudy setup reference](../ops/rudy/README.md#direct-atlas-mcp-tools).
