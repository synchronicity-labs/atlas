---
name: product-pages-weekly-report
description: Weekly product-page acquisition and paid-conversion report from governed Atlas Q237.
version: 3.0.0
license: MIT
---

The no-agent cron runs the fixed scoped command:

```bash
sudo -n /usr/local/sbin/rudy-ga4-report product-pages-weekly
```

Use --dry-run to check the report and chart without Slack delivery.

Q237 is the only report source. Require CERTIFIED, VERIFIED, fresh status and a healthy source. Never query GA4, PostHog, billing, or product databases as a headline replacement.

Preserve Q237's exact product-page registry, clean signups, earliest recognized product-page claim per organization, and positive subscription invoices after signup. Paid conversion is paid organizations divided by attributed organizations, not sessions divided by subscriptions.

The script prints one report and one safe MEDIA path. Hermes delivers both to C0AD87S7YN6. Do not call Slack directly or pre-record delivery success.

The existing references/product-page-attribution-debugging.md and references/blog-product-pages-ga4-conversion-attribution.md are for requested investigations only. They do not replace the canonical Q237 report path.
