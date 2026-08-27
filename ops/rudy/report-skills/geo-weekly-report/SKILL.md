---
name: geo-weekly-report
description: Weekly AI-referral report with Atlas Q25 traffic and Q249 mature product conversion.
version: 3.0.0
license: MIT
---

The no-agent cron runs the fixed scoped command:

```bash
sudo -n /usr/local/sbin/rudy-ga4-report geo-weekly
```

Use --dry-run for a local render and chart check with no Slack delivery.

Q25 is the month-to-date PostHog AI-referral control. Q249 is the canonical mature signup-cohort conversion result. Require CERTIFIED, VERIFIED, fresh results from healthy sources.

Keep GA4 weekly traffic and engagement as explicitly labeled reconciliation. Never divide Q249 outcomes by GA4 sessions or equate referral sessions with citation impressions. Show each source's actual reporting window.

The script prints report text and one safe MEDIA path. Hermes delivers both to C0AD87S7YN6. The script and report agent must not use Slack credentials or send tools.

For a requested deeper investigation, the existing references/diagnosing-referral-dips.md, references/llm-referral-attribution-dip-diagnostics.md, references/blog-content-push-effectiveness.md, and references/seo-geo-quick-read.md cover the source-specific diagnostics. Their raw-source methods are investigative evidence, not replacements for Atlas headline values.
