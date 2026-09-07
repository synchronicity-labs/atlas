# Host report runtime

`daily_abuse_report.py` is deployed to `/usr/local/lib/rudy-daily-abuse-report/daily_abuse_report.py` on Rudy. Vercel does not deploy it. Its existing root wrapper injects only the Atlas read credentials and uses the scoped Slack broker.

The report keeps complete totals, shows the five most frequent reasons in each enforcement section, and lists the remaining count. Long reason text is shortened. Detail is limited to 12,000 UTF-8 bytes, with an explicit omission notice when needed and a link to Atlas Q270. The broker's independent 38,000-byte safety limit is unchanged.

Run `python3 -B -m unittest discover -s ops/rudy/report-runtime` locally. For a host release, stage the file privately and use the existing Atlas controls to render it without `--post-slack`. Inspect byte lengths and totals, not raw customer records in deployment logs. Compare the live file against its captured checksum before replacing it, retain a root-only backup, and preserve root:root ownership and mode 0755. No service restart is needed.

Use the existing daily job for delivery. Do not clear its error state by editing cron metadata. Only a successful scheduled execution or an explicitly requested rerun should clear it.
