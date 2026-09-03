---
name: studio-kpis-monthly-report
description: Monthly Studio KPI report from certified Atlas questions.
version: 3.0.0
license: MIT
metadata:
  hermes:
    tags:
    - blueprint
    - automation
    - atlas
    blueprint:
      schedule: 23 8 1 * *
      deliver: slack:C0ACTQRBFAT
      prompt: |
        ATLAS-FIRST CANONICAL
        Use Q271, Q273, Q275, and Q276 for the monthly Studio KPI report.
        Use Q247 only as a separate bookings and delivery-commitment measure.
        Require CERTIFIED, VERIFIED, and fresh. A failed latest refresh does not invalidate a verified answer before its freshness deadline.
        Never replace an unavailable Atlas value with a raw PostHog value.
        Return one final report. The gateway delivers it to C0ACTQRBFAT.
---

# Monthly Studio KPI report

Use the `atlas-company-intelligence` skill first.

Use these governed questions:

- Q271 for complete-month generated hours, new subscriptions, and logo movement.
- Q273 for complete-month time to magic.
- Q275 for mature signup-to-subscription cohort months.
- Q276 for mature week-two generation-retention cohorts.
- Q247 only for separate bookings and delivery commitments.

Use a question only when it is `CERTIFIED`, `VERIFIED`, and fresh. A failed latest refresh does not invalidate a verified answer before its freshness deadline. If it is not ready, omit the section and state the Atlas blocker. Do not query PostHog, Metabase, or another raw source as a replacement.

Q275 has a six-week observation window. Q276 has a three-week observation window. Show each section's own period labels. Do not present those mature cohorts as the latest Q271 delivery months.

For the monthly Q276 rollup, group the governed weekly rows by cohort month. Use the sum of `week_two_users` divided by the sum of `cohort_users`. Use only complete cohort months whose weekly rows are present and mature. Never average weekly percentages.

Show previous to current. Convert Q273 median seconds to minutes only for display. Return one final report. The gateway delivers it to `C0ACTQRBFAT`. Do not call send tools or use Slack credentials. Do not claim delivery before gateway confirmation.
