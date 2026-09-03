---
name: lipsync-com-weekly-traffic-report
description: Weekly lipsync.com website traffic and search report from its own governed Atlas source.
version: 3.0.0
license: MIT
---

Use atlas-company-intelligence first. Read the question named "Lipsync weekly traffic and search" (source key cron:lipsync:weekly-traffic) named in the cron prompt. Require CERTIFIED, VERIFIED, and fresh. A failed latest refresh does not invalidate a verified answer before its freshness deadline.

Q28 and Q40 contain other Sync sites. They are not lipsync.com traffic sources. Q31 is a rolling search-query ranking, not a complete weekly site total.

The weekly question has two rows per source. GA4 rows must identify property 525331485. Search Console rows must identify sc-domain:lipsync.com. Compare previous to current within each source, not across sources.

Show each section's period_start, window_end (exclusive), and source_time_zone. GA4 uses its property calendar. Search Console uses finalized Pacific-time days and a three-day processing allowance. Its latest complete week can lag GA4; show the actual older dates instead of relabeling them.

Headlines:

- GA4 sessions, users, new users, engagement rate, and average session duration.
- Search impressions, clicks, CTR, and average position.

Native weekly users are not summed daily users. Search headlines use site totals, never sums of query or page rankings. Keep Q236 product-conversion cohorts separate; do not divide product outcomes by sessions or clicks.

The scoped rudy-lipsync-traffic-data command may supply top pages, source/medium, country, and query detail only. Label its dates. It must not replace Atlas headlines. Query rankings are sorted by the requested metric after fetching a broad set; Search Console does not guarantee all dimension rows.

Return one Slack-ready report to the cron. It owns delivery to C0AD87S7YN6. Do not use send tools or Slack credentials. Do not write a fabricated slack_ts or mark a report delivered before confirmation. Optional charts remain local, so there is only one report message.

If the Atlas question fails its checks, return a short internal blocker instead of substituting raw headline metrics. The existing references/api-query-pitfalls.md remains available for requested source investigations.
