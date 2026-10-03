# Strict rules - Always review before starting any work

You should always check and see if there are any relevant skill files you should review before starting a task e.g. if you're working on better-auth, always review the better auth best practice skill - if you're working on prisma, review your prisma-database-setup skill.

Please check below, if you're working on anything related review the rules and let the user know you've read them:

## Code Comments
Do not add code comments to the code you write, ever.

## Design
Read @docs/design.md

## API:
Read @docs/api.md

## The research agent (`apps/agent`):
Read @docs/agent.md

Every piece of intelligence in this repo lives there, not in the API. The
complete eve documentation ships in `apps/agent/node_modules/eve/docs` and
matches the installed version — read the relevant guide before writing eve code
rather than working from memory of the API.

ABSOLUTELY, no coauthoring commits.

## QBR data through Rudy MCP

For quarterly business review (QBR) data, discover the `atlas_*` tools on the
connected Rudy MCP server. Search available tools for `atlas` or `qbr`, or list
the server's tools. Start with `atlas_qbr_report(quarter="2026-Q3")` to discover
metrics and their source links, then request only the evidence the user needs.
The four Atlas tools are read-only and use server-held credentials.

For period-specific `atlas_question` evidence, always pass the requested
`reporting_period`. An unfiltered read returns the latest snapshot across
periods, which may not match the request. Use question numbers and canonical
URLs from the report or search results; do not guess them.

Read [the QBR agent guide](docs/qbr-agent-access.md) for tool selection, period
semantics, and example requests. Reuse an existing Rudy connection; setup is
only needed when the agent cannot discover or reach the tools.

## Environment / configuration:
Read @docs/environment.md

There is **one `.env`, at the root of the repo**, and `.env.example` is its
documentation. If you add a variable, add it to `.env.example` with a note on
what it does — and if the API reads it, declare it in
`apps/api/src/config/env.validation.ts` too. Never add a per-package `.env`.

Anything a self-hoster might not have is optional, and the code must work
without it: a missing key removes a capability, it never throws. See
`apps/agent/agent/lib/capabilities.ts` for the pattern.
