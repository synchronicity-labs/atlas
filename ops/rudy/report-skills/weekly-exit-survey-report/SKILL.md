---
name: weekly-exit-survey-report
description: Weekly governed cancellation-request and exit-survey report from Atlas Q239.
version: 3.0.0
license: MIT
metadata:
  hermes:
    tags:
    - blueprint
    - automation
    blueprint:
      schedule: 11 14 * * 4
      deliver: local
      prompt: >-
        Use Atlas Q239 for the latest two complete UTC weeks of successful cancellation requests,
        completed survey responses, response coverage, separate survey dismissals, structured
        reasons, and plans. Use Q239 only when it is VERIFIED and fresh. Never publish raw text.
---

Use the `atlas-company-intelligence` skill and read Q239 first.

Q239 is canonical only when it is `CERTIFIED`, `VERIFIED`, fresh, and backed by a `HEALTHY` source.

- `cancellation_requests` counts unique server events emitted after Stripe accepts a scheduled cancellation request.
- `responses` counts those events with the server-joined `survey_completed=true` value.
- `response_rate_pct` is responses divided by successful cancellation requests.
- `dismissed_feedback_forms` is separate. Never add it to cancellation requests.

The result repeats weekly totals across breakdown rows.

- Take `reason_count` once per week and reason. Do not sum it across plan rows.
- Take `plan_count` once per week and plan. Do not sum it across reason rows.
- Use `response_group_count` only for a reason-by-plan cross table.

Report the latest two complete UTC weeks and week-over-week change. Lead with cancellation requests, responses, response coverage, and separate dismissals. Then show structured reason and plan distributions. Include a matplotlib chart of the latest complete week reason counts.

Keep the reporting period and Q239 link in the report. Record dataThrough, trust, and metric version in local acceptance evidence, not a long status footer.

Return one final report. Do not call send tools or use Slack credentials. Preserve the configured destination; the existing local-only archive is not evidence of a Slack delivery. Stage charts under /root/.hermes/cache/documents/outbound with Rudy-readable permissions. For gateway attachment delivery, use a MEDIA: absolute path, never a sandbox: link. Do not claim that an attachment was sent before gateway confirmation.

Never publish raw comments, competitor names, customer names, emails, URLs, account IDs, user IDs, or organization IDs. Do not infer themes from free text.

If Q239 is unavailable, stale, failed, or not verified, omit metrics and report the Atlas blocker. Do not substitute Metabase feedback form counts for successful cancellation requests or calculate a response rate without the governed denominator.

Exported from cron job 86edaa10e12e on the rudy gateway. Installing this skill registers a suggested automation (consent-first); accepting it creates the cron job via the normal scheduler.
