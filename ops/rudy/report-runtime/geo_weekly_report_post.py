#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import shutil
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, "/usr/local/lib/rudy-atlas-runtime")
from atlas_report_controls import canonical as atlas_canonical
from atlas_report_controls import data_through as atlas_data_through
from atlas_report_controls import rows as atlas_rows

SCRIPT = "/usr/local/lib/rudy-agent-data/geo_weekly_report.py"
OUTPUT_DIR = Path("/root/.hermes/cache/documents/outbound")


def run(cmd, **kwargs):
    return subprocess.run(cmd, text=True, capture_output=True, check=False, **kwargs)


def atlas_context():
    traffic = atlas_canonical(25)
    conversion = atlas_canonical(249)
    traffic_rows = atlas_rows(traffic)
    conversion_rows = atlas_rows(conversion)
    visitors = sum(int(row.get("visitors") or 0) for row in traffic_rows)
    pageviews = sum(int(row.get("pageviews") or 0) for row in traffic_rows)
    cohorts = sorted({str(row.get("cohort_week")) for row in conversion_rows})
    if len(cohorts) != 2:
        raise RuntimeError("Q249 must contain two mature signup cohorts")
    latest, previous = cohorts[-1], cohorts[-2]
    latest_rows = [row for row in conversion_rows if str(row.get("cohort_week")) == latest]
    previous_rows = [row for row in conversion_rows if str(row.get("cohort_week")) == previous]

    def totals(rows):
        return {
            "signups": sum(int(row.get("signups") or 0) for row in rows),
            "generations": sum(int(row.get("first_successful_generations") or 0) for row in rows),
            "paid": sum(int(row.get("paid_subscriptions") or 0) for row in rows),
        }

    current = totals(latest_rows)
    prior = totals(previous_rows)
    paid_rate = current["paid"] / current["signups"] * 100 if current["signups"] else 0
    generation_rate = current["generations"] / current["signups"] * 100 if current["signups"] else 0
    conversion_lines = [
        f"*Atlas Q249 mature conversion cohort — {latest}:*",
        f"• *total:* {current['signups']} signups · {current['generations']} first successful generations ({generation_rate:.1f}%) · {current['paid']} paid within 7d ({paid_rate:.1f}%)",
        f"• *prior cohort:* {prior['signups']} signups · {prior['generations']} first successful generations · {prior['paid']} paid within 7d",
    ]
    for row in sorted(latest_rows, key=lambda value: int(value.get("signups") or 0), reverse=True):
        conversion_lines.append(
            f"• *{row.get('provider')}:* {int(row.get('signups') or 0)} signups · "
            f"{int(row.get('first_successful_generations') or 0)} first successful · "
            f"{int(row.get('paid_subscriptions') or 0)} paid ({float(row.get('signup_to_paid_pct') or 0):.1f}%)"
        )
    context = (
        "Atlas governed controls (Q25/Q249): month-to-date AI-referral traffic "
        f"through {str(atlas_data_through(traffic))[:10]}: {visitors:,} visitors and {pageviews:,} pageviews. "
        f"Product conversion uses mature signup cohorts through {str(atlas_data_through(conversion))[:10]}."
    )
    return context, "\n".join(conversion_lines)


def replace_raw_conversion(report, governed_conversion):
    start = report.find("\n*conversions (last week):*")
    end = report.find("\n*last 4 weeks total:*", max(start, 0))
    if end < 0:
        raise RuntimeError("raw GEO report summary boundary was not found")
    if start < 0:
        return report[:end] + "\n\n" + governed_conversion + report[end:]
    return report[:start] + "\n\n" + governed_conversion + report[end:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    governed_context, governed_conversion = atlas_context()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    chart_path = OUTPUT_DIR / f"geo_weekly_chart_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.png"
    env = os.environ.copy()
    env.setdefault("MPLCONFIGDIR", "/tmp/matplotlib-rudy")
    res = run([sys.executable, SCRIPT, str(chart_path)], env=env, timeout=300)
    if res.returncode != 0:
        print(res.stderr or res.stdout, file=sys.stderr)
        return res.returncode
    lines = [ln for ln in res.stdout.splitlines() if ln.strip()]
    if not lines:
        print("geo script produced no JSON", file=sys.stderr)
        return 1
    data = json.loads(lines[-1])
    raw_report = replace_raw_conversion(data["report"], governed_conversion)
    title, body = raw_report.split("\n", 1)
    report = (
        f"{title}\n\n{governed_context}\n\n"
        f"*GA4 weekly traffic and engagement reconciliation:*\n{body.lstrip()}"
    )
    chart = Path(data.get("chart_path", chart_path))

    if args.dry_run:
        print(json.dumps({"ok": True, "dry_run": True, "chart_exists": chart.exists(), "report_preview": report.splitlines()[:8]}, indent=2))
        return 0

    if not chart.is_file():
        raise RuntimeError("GEO chart was not created")
    os.chmod(chart, 0o640)
    shutil.chown(chart, user="rudy", group="rudy")
    print(f"{report}\n\nMEDIA:{chart}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
