---
name: adobe-premiere-plugin-kpis-weekly-report
description: Weekly Adobe Premiere plugin KPI report from governed Atlas Q235.
version: 3.0.0
license: MIT
---

Use the atlas-company-intelligence skill. Read Q235 and require CERTIFIED, VERIFIED, fresh, and a HEALTHY source. If unavailable, omit metrics and report the Atlas blocker. Do not rebuild the report from PostHog or Metabase.

Use all nine Q235 sections: installs, retention, power_retention, activation, two_day_activation, post_generation, nps, nps_distribution, and nps_response.

Show unique installs all-time and the latest two complete weeks. Preserve ordered activation steps, mature W1-W3 retention cohorts, and mature two-day activation. Keep every rate tied to its numerator and denominator. Post-generation event rates can exceed 100%; they are not unique-user conversion rates.

Use aggregate NPS score, categories, score distribution, and completion rate. Never query or include raw comments or person identifiers.

Keep linked bold section headings, plain numbers, no code blocks, and trend arrows only. Show each cohort's own dates. Link the title to the existing PostHog dashboard and the governed control to Q235.

Return one Slack-ready report. The cron owns delivery to C0ACTQRBFAT. Do not call a send tool, access platform credentials, or record a delivery success before the gateway confirms it.
