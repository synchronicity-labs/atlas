---
name: studio-kpis-weekly-report
description: Weekly Studio KPI report from certified Atlas questions.
version: 3.0.0
license: MIT
metadata:
  hermes:
    tags:
    - blueprint
    - automation
    - atlas
    blueprint:
      schedule: 29 8 * * 1
      deliver: slack:C0ACTQRBFAT
      prompt: |
        ATLAS-FIRST CANONICAL
        Use Q234, Q272, Q274, and Q276 for the weekly Studio KPI report.
        Use Q247 only as a separate bookings and delivery-commitment measure.
        Require CERTIFIED, VERIFIED, fresh, and a HEALTHY source.
        Never replace an unavailable Atlas value with a raw PostHog value.
        Return one final report. The gateway delivers it to C0ACTQRBFAT.
---

# Weekly Studio KPI report

Use the `atlas-company-intelligence` skill first.

Use these governed questions:

- Q234 for complete-week generated hours, new subscriptions, and logo movement.
- Q272 for complete-week time to magic.
- Q274 for mature signup-to-subscription cohort weeks.
- Q276 for mature week-two generation-retention cohorts.
- Q247 only for separate bookings and delivery commitments.

Use a question only when it is `CERTIFIED`, `VERIFIED`, fresh, and backed by a `HEALTHY` source. If it is not ready, omit the section and state the Atlas blocker. Do not query PostHog, Metabase, or another raw source as a replacement.

Q274 has a six-week observation window. Q276 has a three-week observation window. Show each section's own period labels. Do not present those mature cohorts as the latest Q234 delivery weeks.

Show previous to current. Use the Atlas row counts and rates without rebuilding them. Convert Q272 median seconds to minutes only for display. For monthly-style retention arithmetic, use retained users divided by cohort users. Never average percentages.

Return one final report. The gateway delivers it to `C0ACTQRBFAT`. Do not call send tools or use Slack credentials. Do not claim delivery before gateway confirmation.
