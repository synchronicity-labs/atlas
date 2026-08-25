# Atlas architecture

Atlas is a single-tenant internal company brain built on the CompAI CRM foundation.
The analytics layer deliberately separates Atlas identity from source identity:

- Atlas questions use stable numeric URLs such as `/questions/15`.
- A question may point to Metabase card `8164`, but renaming either side does not
  change the Atlas URL.
- Every saved edit creates an immutable `QuestionVersion`.
- Result snapshots are content-addressed and idempotent by source, external ID,
  reporting period, and content hash.
- Dashboards compose questions. Tabs are URL-addressable with `?tab=1`, and layout
  positions live on dashboard cards rather than in a Metabase-specific model.

## Source-first metric system

Atlas reads governed metrics from the underlying source systems. Existing Metabase
cards are discovery and reconciliation references, not the canonical extraction path.
A certified question points to an approved metric version; exploratory questions and
reconciliation questions remain available but cannot publish a canonical answer by
accident.

The repository remains one product with separate runtime boundaries:

- `apps/app` renders questions, dashboards, and CRM context.
- `apps/api` serves authenticated application data and the read-only metric API.
- source adapters and scheduled ingestion move behind an independent ingest runtime;
  the existing sync routes remain compatible while adapters are extracted.
- `packages/metrics` owns UTC windows, shared-watermark selection, metric contract
  validation, and deterministic contract hashing.

Postgres separates the data plane into namespaces without moving existing application
tables:

- `ingestion.dataset` registers a physical source dataset and its event-time,
  watermark, cadence, freshness, and backfill rules.
- `ingestion.sourceWatermark` records retry-safe checkpoints and the complete
  `dataThrough` boundary produced by a source run.
- `core.normalizedFact` stores immutable facts at the smallest useful grain, with
  canonical entity IDs, eligibility state, dimensions, measures, and content hashes.
- `metrics.metricDefinition` and `metrics.metricVersion` hold the business meaning,
  owner, source queries, normalization rules, computation, verification policy, and
  cadence.
- `metrics.metricRun`, `metrics.metricVerification`, and `metrics.metricSnapshot`
  preserve inputs, the oldest common source watermark, validation evidence, and the
  immutable published result.
- existing CRM, auth, question, dashboard, and source-mirror records remain in
  `public`. The reserved `atlas_app` schema is available for a later application-table
  move that does not block the metric-layer rollout.

A multi-source metric never mixes unequal source windows. Its run uses the oldest
complete required watermark as the shared `dataThrough` time. A rolling window is
anchored to that exact instant, and a calendar window uses UTC half-open boundaries.
Missing, stale, pending, and failed verification states are explicit API results.

The trusted agent API exposes the metric contract, input datasets, source queries,
watermarks, run hashes, verification evidence, and trust status with each certified
question. The browser and Rudy read this API; they do not query source systems
directly.

The stakeholder decision register is in
[`docs/metric-definition-decisions.md`](./metric-definition-decisions.md). The
current Product KPI source, normalization, and trust map is in
[`docs/verification/product-scoreboard-data-layer.md`](./verification/product-scoreboard-data-layer.md).
The workbook-wide inventory, readiness stages, and verification rollout are in
[`docs/kpi-catalog-rollout.md`](./kpi-catalog-rollout.md).
Business ambiguity remains a pending decision; it is never resolved by silently
changing a timestamp or relabeling an amount.

## Reporting time policy

Atlas uses UTC for every deterministic reporting boundary:

- A calendar day is `[00:00 UTC, 00:00 UTC the following day)`.
- A calendar week is ISO Monday 00:00 UTC through the following Monday 00:00 UTC.
- A calendar month is the first day 00:00 UTC through the first day of the next month.
- Rolling windows are exact elapsed durations ending at one captured query-start
  instant and are always labeled `rolling`; for example, seven days means 168 hours
  and one day means 24 hours. They are not presented as calendar periods.
- SQL filters use half-open intervals (`>= start` and `< end`) to prevent boundary
  rows from appearing in two periods.
- Every card shows the metric window/grain separately from `capturedAt`. Snapshot
  partition labels such as `2026-08` are storage metadata, not metric timeframes.

PostgreSQL calendar truncation must convert to UTC before truncating, for example
`date_trunc('day', created_at at time zone 'UTC')`. Comparisons to `timestamptz`
columns convert the UTC boundary back with `at time zone 'UTC'`. ClickHouse queries
must pass the `UTC` timezone to their `toStartOf*` boundary functions.

## Metabase ingestion

The server owns the Metabase credential. Browser code receives source metadata,
result snapshots, and an explicit freshness/error state, never the API key.

This connector remains useful for mirroring the Product Scoreboard and reconciling
historical answers during the source-first transition. Metabase-backed questions are
classified as `RECONCILIATION`. A metric becomes `CERTIFIED` only after its direct
source inputs, normalization, verification policy, and approved metric version exist.

`POST /internal/sync/metabase/users` advances the product-user cursor by at most
twenty 500-row pages without also refreshing dashboard cards.
`POST /internal/sync/metabase/customer-billing-countries` refreshes the canonical
Stripe customer country registry. It uses the latest nonempty billing country from
a successful charge. When a customer has no successful charge country, it falls
back to the latest invoice billing country, then the latest invoice shipping
country. The sync updates the current record and stores an immutable snapshot when
the selected evidence changes. New customers are added after their first successful
charge or invoice appears. A newer successful charge can update the current country,
while the earlier country remains available in the snapshot history.
When `STRIPE_SECRET_KEY` is configured, Atlas reads both charge and invoice
evidence directly from Stripe. Metabase is used only as a compatibility fallback
when direct Stripe access is not configured.
`POST /internal/sync/metabase/incremental` refreshes source metadata, card results,
the Stripe customer country registry, and a smaller product-user batch.
`POST /internal/sync/metabase/backfill` starts with the most recent available month,
advances the persisted cursor toward older periods, and continues the customer
country scan. All endpoints require `Authorization: Bearer $CRON_SECRET`.

The generated Vercel configuration schedules the users-only continuation hourly,
the source Metabase mirror every eight hours, the Atlas scoreboard every 15 minutes,
and historical backfill every 15 minutes until the source status reports
`backfillFinished`. Dashboard 1 advances by at most two Metabase questions per
request; report dashboards advance by at most four. A refresh runs at most four
queries at once. Retries are safe: run status and
cursors are persisted, snapshots are idempotent, and a failed batch resumes from its
last checkpoint.

Atlas never downloads or exports the full Product identity or organization-membership
table for metric eligibility. Product questions use a server-side join, a bounded
aggregate, or a small exclusion set that is capped at the source. The API also applies
a hard 2,000-row result bound to Product Postgres identity queries as a final guard.
A partial identity result can never certify a metric.

Raw usage facts are filtered by `userId`; Stripe mirrors are filtered by the
organization or customer linked to an excluded owner. Internal users are excluded.
Banned users who never subscribed are excluded, while paid history from users who
did subscribe remains in money metrics even if the user was banned later. Disabled
identities remain in historical KPI populations because deletion after qualification
is a retention signal; question 6001 reports those organizations separately. The
exclusion is applied when a question runs, not when the immutable raw fact first
arrives, so a later ban can change a historical metric on the next refresh.
Previously published report snapshots remain unchanged. Each governed run stores the
eligibility snapshot hash and capture time used for the calculation.

Local operators can trigger the same paths without copying a secret:

```sh
bun run metabase:users
bun run metabase:sync
bun run metabase:backfill
```

Dashboard 1 extends the source Product 2026 Scoreboard with Atlas-owned tabs that
still link back to their originating saved questions. The Billing v3 experiment tab
uses the persisted `billing_v3_experiment` assignment as its causal spine: external,
enabled owners assigned to `control` are v2 and those assigned to `treatment` are v3.
It combines assignment and conversion records from Postgres with deduplicated
invoice, payment, and cancellation facts from TinyBird in the Atlas service layer.

The tab's headline questions are a current read calculated with Tair's experiment
methodology. Cash comparisons require fourteen days of paid tenure; churn is only
calculated for cohorts that have matured past the fixed 30- or 60-day boundary. The
27 July artifact remains in immutable question version history for auditability, but
is not the displayed result. The earlier non-causal billing population, plan,
revenue, usage, and cost questions are archived rather than mixed into the causal
experiment dashboard. The experiment tab refreshes through
`/internal/sync/atlas/1`.

The Reliability tab exposes current-day and current-week generation success,
ten-week trend, model and input-type cuts with volume, hourly failure rate, and a
rolling 24-hour failed-generation ledger. Every card displays its window and grain;
the ledger exposes all snapshot rows in a scrollable table and downloadable CSV. A
successful generation is any row whose status is not `FAILED`, including null, which
preserves the source Metabase definition. These Atlas-owned queries refresh in
checkpointed batches every 15 minutes through `/internal/sync/atlas/1`; the normal
Metabase incremental job continues to mirror source dashboard metadata and cards
every eight hours.

Required Doppler variable names are:

- `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ALLOWED_SIGN_IN`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `API_URL`, `APP_URL`, `AGENT_BRIDGE_SECRET`, `CRON_SECRET`
- `RUDY_API_URL`, `RUDY_API_KEY` for resumable shared Rudy sessions
- `METABASE_BASE_URL`, `METABASE_API_KEY`, `METABASE_DASHBOARD_ID`
- `METABASE_USER_QUESTION_ID`, `METABASE_SYNC_BATCH_SIZE`
- `METABASE_USER_BATCH_SIZE`, `METABASE_MAX_BACKFILL_MONTHS`
- `GOOGLE_SERVICE_ACCOUNT_JSON`, `KPI_CATALOG_SPREADSHEET_ID`, and the six
  `GA4_*_PROPERTY_ID` values
- `GOOGLE_SEARCH_CONSOLE_SYNC_SITE`, `GOOGLE_SEARCH_CONSOLE_LIPSYNC_SITE`
- `POSTHOG_HOST`, `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`
- `HUBSPOT_ACCESS_TOKEN` with read-only company, contact, deal, pipeline, owner,
  activity, and Leads-object scopes
- `HUBSPOT_PORTAL_ID` for source-dashboard links in the question editor

`ALLOWED_SIGN_IN` is `sync.so` for Atlas. The Google client needs the localhost
redirect URI `http://localhost:3001/api/auth/callback/google` and the equivalent
deployed API callback before users can sign in.

## Metric catalog import

Atlas reads the Q3 metrics workbook with the same read-only Google service account
used for reporting. `KPI_CATALOG_SPREADSHEET_ID` selects the workbook. The importer
preserves the tab ID, row, range, declared source, trackability note, raw row, and a
content hash. It classifies canonical KPIs, breakdown views, diagnostics, and
roadmap measures without treating the workbook as a reporting database.

`GET` or `POST /internal/sync/metric-catalog` refreshes the catalog behind
`CRON_SECRET`; production runs it daily at 05:13 UTC. `bun catalog:sync` runs the
same path locally. The `/metrics` page shows KPI mapping and verification coverage,
source gaps, definition questions, and links back to exact workbook rows.

## Marketing ingestion

Dashboard 3 executes server-side, editable `API` questions against three read-only
reporting surfaces:

- GA4 supplies users, sessions, page views, engagement, channel groups, and the
  per-property portfolio trend.
- Search Console supplies clicks, impressions, CTR, position, search queries,
  landing pages, and countries for `sync.so` and `lipsync.com`.
- PostHog supplies behavioral signup, first-touch, AI-referral, and time-to-paid
  views. These are labeled as behavioral proxies where product-database
  reconciliation or cross-source identity stitching is not yet available.

`POST /internal/sync/marketing` executes each question independently, persists a
content-addressed snapshot, records per-question failures on the sync run, and keeps
the last successful result available. The generated deployment refreshes it every
eight hours. Locally, run `bun run marketing:sync` while the API is running.

Google and PostHog credentials remain server-side. The question editor exposes the
real constrained request JSON or read-only HogQL, never the credential used to run
it. Google API requests use separate scoped access tokens for Analytics and Search
Console.

## Revenue definitions

The governed self-serve revenue model keeps each billing event separate before it combines them:

- Subscription run-rate includes recurring V2 and V3 self-serve plans.
- V2 usage revenue is postpaid usage, grouped by `generationEndedAt` in UTC.
- V3 top-up revenue is successful credit top-up payments. V3 credit consumption is not counted as new revenue.
- Variable revenue is V2 usage plus V3 top-ups.
- Total self-serve run-rate is subscriptions plus V2 usage plus V3 top-ups.
- The current UTC month uses an explicit MTD pace. Complete months use actual values.
- Subscription value uses the recurring licensed Stripe item price and quantity from
  the raw subscription payload. It does not use a hard-coded price table.
- Hobbyist, Creator, Growth, and Scale are V2. Every other non-empty self-serve plan
  accepted by the governed revenue-door policy is treated as V3, so new V3 tiers do
  not need a query change.

Dashboard 2 uses the finance-correct model for its active question versions:

- Paid usage is grouped by `generationEndedAt`.
- Stripe invoice items and invoices are reduced to one latest reliable state per
  external object ID before totals are calculated.
- Licensed base includes deduplicated paid and open licensed invoice items and
  excludes the two known internal or test customers.
- Paid customer monthly revenue is a native SQL equivalent of Metabase question
  1256 because direct saved-card execution is permission blocked.
- Totals are summed at full precision and rounded only for display.

Earlier question versions and immutable snapshots remain the audit trail for the
July Rudy email behavior. That close used raw additive lifecycle rows and did not
execute against a pinned warehouse as-of timestamp.

Weekly Revenue Lite questions 1101 through 1109 can be replayed against an explicit
UTC cutoff with `bun --filter api run replay:weekly-revenue <cutoff>`. The replay
executes the stored question versions and emits the eligibility evidence without
changing a published snapshot. Invoice cash uses one row per invoice and the Stripe
`paid_at` transition, so an invoice created before the cutoff but paid later cannot
leak into the close. Subscription lifecycle rows are reduced deterministically by
external subscription ID. The TinyBird subscription mirror does not contain a
webhook ingestion timestamp, so an old close cannot reconstruct subscription state
exactly unless Atlas preserved the result at that close. New report deliveries must
therefore point to their immutable Atlas snapshot.

Before these questions run, Atlas applies the current company revenue-door policy.
The Sync Tools result excludes enterprise, program, partner, and explicitly classified
channel-partner organizations. The rule registry is stored in Postgres so adding a
partner does not require editing every SQL question. The result stays pending while
the registry is marked partial, even though known exclusions are already applied.

## Product identities

Product-user ingestion whitelists only the fields Atlas uses. Email is searchable but
is not unique. The stable source user ID is the identity key, and organization
memberships are separate records, so one email may represent multiple product users
and one user may appear in multiple organizations without destructive merging.
The progressive sync also stores the current banned, disabled, and anonymous flags;
these mutable fields inform new calculations but never rewrite an issued snapshot.

Atlas applies one reporting-population rule before Product Postgres questions are
aggregated. Product activity excludes anonymous and internal identities. It also
excludes a banned person only when no organization membership has a
`first_subscribed_at` value. A person who subscribed remains in historical product
and money results after a later ban. Disabled accounts also remain in historical
results and can be reported as a separate retention signal. Abuse questions do not
use this filter because banned identities are their subject.

The Product Postgres path applies this rule as a live join to `auth.users`,
`user_organizations`, and `organizations` before it reads organizations or
generations. It does not copy a large user-ID exclusion list into each question.
TinyBird money questions use the governed subscribed-customer exclusion list. A
TinyBird or PostHog question about unpaid activity remains pending until its source
facts have a normalized product-user key that can apply the same rule.

## Customer identity bridge

HubSpot companies and contacts are stored as source-backed CRM records. PostHog
persons are stored as a separate behavioral source. Every ingestion writes an
immutable, content-addressed source snapshot and updates a retry-safe cursor.

Atlas links these records to product users and organizations only when it has
explicit evidence: the same external ID, the same normalized email, a HubSpot
contact-to-company association, or an exact non-public domain. Similar names are
never auto-merged. The company sheet exposes the linked product accounts and
workspaces; the product-user page exposes the linked client, PostHog activity, and
first-touch attribution.

Run the progressive local sync with:

```sh
bun run customer:sync
```

PostHog enrichment runs for linked product users and when an individual product
profile is opened. HubSpot is optional: when `HUBSPOT_ACCESS_TOKEN` is absent, the
sync reports the source as unconfigured and leaves existing CRM data untouched. A
HubSpot private app token stays read-only and includes company, contact, deal,
pipeline, owner, activity, and Leads-object read scopes. Store it in Doppler
project `atlas`, config `local`; never put it in `.env.local` or source control.

## Sales ingestion

Dashboard 4 mirrors HubSpot sales operations through stable Atlas questions. Deal,
pipeline, owner, company, and contact associations are ingested into immutable,
content-addressed source snapshots with independent retry-safe cursors. Deal records
also preserve HubSpot history for amount, pipeline, stage, close date, and won state,
which lets Atlas prove when a deal entered a stage instead of inferring it from the
current record. The sales questions execute against that ingested layer, so editing
or previewing a question never exposes the HubSpot token to the browser.

Run `bun run hubspot:sales:sync` for the bounded sales-only path. It advances the deal
cursor before pipeline and owner metadata and does not wait for the larger company
and contact backfill. The full customer identity sync remains available through
`bun run customer:sync`.

The HubSpot mirror tab reproduces the source dashboard's rolling 30-day forecast,
contact/deal totals, team activity, daily closed-won curve, and lead-stage views.
Those reports are live connector aggregates, not copied screenshot values. Atlas
stores their source definitions and immutable results like every other question.
The Pipeline analysis tab retains open and weighted pipeline, closed won bookings,
win rate, new pipeline, stage and owner coverage, expected-close forecast, sales
cycle, and the open-deal ledger. Enterprise and Studios reuse the same question
primitives with explicit pipeline filters.

The legacy HubSpot engagements read surface supplies outbound sales-email counts;
modern read-only object APIs supply meetings, notes, and tasks. Lead cards fail
closed with an intentional unavailable state when `crm.objects.leads.read` is not
present. Adding that read-only scope populates the existing questions on the next
scheduled sync without a schema or dashboard change.

`bun run customer:sync` progressively advances the HubSpot company and contact
cursors, fully refreshes the bounded deal, pipeline, and owner datasets, then writes
new sales snapshots. Dashboard refresh re-runs the questions against the most recent
ingested state without making an extra vendor request.

## Abuse and signup protection

Dashboard 5 converts the Sync Tracker abuse views into seven reusable Atlas
questions. Product-database questions show the current banned population, ban
reasons, and bans grouped by `auth.users.updated_at`. PostHog questions show blocked
signup attempts, successful signups, block rate, and block reasons.

`updated_at` is only a proxy for the ban date because the source table has no
`banned_at`. Atlas labels that limitation in the question definition. Blocked signup
events occur before an account exists and therefore use the `all_events` person
policy. Successful signup and marketing conversion questions use
`exclude_banned_product_users`, so banned identities do not inflate signups or
conversion rates.

Run `bun run abuse:sync` locally. The generated deployment refreshes dashboard 5
every six hours.

## Inference economics

Dashboard 6 is the deterministic version of Sync Tracker's Modal cost view. Its
seven questions combine TinyBird database 166 usage with aggregate Modal billing:

- Usage and frame counts come from `sync_prod.sync_usage3`, grouped by
  `generationEndedAt` and model.
- Paid usage revenue includes only rows with a non-empty organization plan type.
- Modal cost is allocated between free and paid frames using each model's frame
  share. The displayed margin is usage revenue minus production Modal inference
  cost; it is an inference contribution margin, not company gross margin.
- Months with Modal billing are actual. Older periods use the weighted per-model
  cost per frame from available actual months and are marked as estimates in the
  question definition.
- Unmapped Modal services remain in staging/other cost instead of being silently
  assigned to production.

Every question version contains the exact read-only TinyBird SQL. Modal credentials
stay in Doppler and are injected only into the collector process. `bun run
modal:import:rudy` uses the Atlas Modal credential when it is configured and falls
back to the collector on Rudy when it is not. It sends only month/model/cost
aggregates to `POST /internal/sync/modal`; it never stores the Modal token, app
identifiers, or raw billing descriptions in Atlas. Then
`bun run economics:sync` persists new content-addressed results. Modal aggregates
expire after 30 hours so a stopped collector produces an explicit stale/error state.
The generated deployment refreshes dashboard 6 every eight hours.

## Rudy query and session contract

Rudy and other trusted internal agents should read Atlas before querying vendor
systems. The server exposes two read-only, bearer-protected endpoints:

- `GET /internal/atlas/catalog` lists dashboards, tabs, questions, versions, source
  state, and the latest result metadata.
- `GET /internal/atlas/questions/:number` returns the immutable result, exact saved
  definition, freshness, and provenance. `reportingPeriod=YYYY-MM` and an ISO
  `asOf` timestamp select a historical snapshot.

The credential is `ATLAS_QUERY_SECRET`. It cannot refresh a connector, edit a
question, or write CRM data. A consumer must treat `stale`, `error`, and
`unavailable` as explicit states rather than silently presenting an old number as
current. Vendor fallback is appropriate only when Atlas has no governed definition
or the caller is deliberately investigating a discrepancy; that result should then
be reconciled into an Atlas question rather than becoming a second permanent metric.

Atlas is also a first-party Rudy client, parallel to Slack. The API stores a
user-owned `RudySession` pointer for each workspace, dashboard, or question thread
and resumes the corresponding Hermes session for every follow-up. The current
typed Atlas context is refreshed and attached to every turn, so a long-lived chat
does not keep reasoning from a stale dashboard payload.

`RUDY_API_URL` and `RUDY_API_KEY` configure that server-to-server bridge. The key
exists only in Doppler and Rudy's protected Hermes environment. For local work,
keep Hermes bound to loopback and forward it through the existing SSH trust:

```sh
ssh -N -L 127.0.0.1:18642:127.0.0.1:8642 rudy
```

A deployed Atlas runner should use a Tailnet-only proxy to the same loopback
listener. Tailscale is the network boundary; the bearer key is defense in depth;
Atlas Google authentication is the end-user identity and ownership boundary.

Rudy may return a typed question-change proposal, but it cannot apply it. Atlas
stores the proposal, links to the normal question editor, executes the existing
read-only preview, and requires an explicit save that creates a new immutable
`QuestionVersion`. Dashboard mutation follows the same proposal-before-apply
boundary when its visual preview contract is added.

## Future sources

Stripe, TinyBird, Postgres, HubSpot, PostHog, GA4, and Search Console register physical
datasets and write normalized facts through the same ingestion contract. They do not
pretend to be Metabase cards or reuse Metabase numbering. The metric layer publishes
verified snapshots; the deterministic API serves them; agent behavior stays outside
both layers.
