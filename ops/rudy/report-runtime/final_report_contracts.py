import datetime as dt
import re
from pathlib import Path

from apply_final_migrations import DELIVERIES


SKILLS = (
    "adobe-premiere-plugin-kpis-weekly-report",
    "studio-kpis-weekly-report",
    "studio-kpis-monthly-report",
    "lipsync-com-weekly-traffic-report",
    "lipsync-weekly-funnel-report",
    "geo-weekly-report",
    "product-pages-weekly-report",
    "weekly-exit-survey-report",
)


def traffic_question_number(jobs):
    match = re.search(r"Canonical Lipsync traffic question: Q(\d+)", jobs["fc9db0707898"].get("prompt", ""))
    if not match or int(match[1]) in {28, 31, 40, 236}:
        raise ValueError("Lipsync traffic is not bound to its dedicated weekly source")
    return int(match[1])


def records(payload):
    result = payload["result"]
    names = [c["name"] for c in result["columns"]]
    if not result["rows"] or any(len(row) != len(names) for row in result["rows"]):
        raise ValueError("empty or truncated report snapshot")
    return [dict(zip(names, row)) for row in result["rows"]]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def date(value):
    return dt.date.fromisoformat(str(value)[:10])


def validate_traffic(payload):
    values = records(payload)
    require(len(values) == 4, "Lipsync needs two weeks per source")
    for source, scope in (("ga4", "525331485"), ("search_console", "sc-domain:lipsync.com")):
        rows = sorted((r for r in values if r["source"] == source), key=lambda r: r["period_start"])
        require(len(rows) == 2 and all(r["source_scope"] == scope for r in rows), "wrong Lipsync source population")
        require(date(rows[1]["period_start"]) - date(rows[0]["period_start"]) == dt.timedelta(days=7), "Lipsync weeks are not consecutive")
        for row in rows:
            require(
                date(row["period_start"]).weekday() == 0
                and date(row["window_end"]) - date(row["period_start"]) == dt.timedelta(days=7)
                and row["window_end"] == row["source_data_through"]
                and row["source_time_zone"] == "America/Los_Angeles",
                "Lipsync source calendar or reporting window changed",
            )
    require(not any(name in values[0] for name in ("email", "user_id", "organization_id")), "person fields in traffic report")


def validate_final_reports(jobs, responses, skills_path):
    for job_id, destination in DELIVERIES.items():
        job = jobs[job_id]
        require(job.get("deliver") == destination, f"{job_id} is not gateway-delivered")
        require("GATEWAY-OWNED DELIVERY" in job["prompt"], f"{job_id} delivery instructions drifted")
        require("message action=send" not in job["prompt"], f"{job_id} requests a direct Slack send")
    for name in SKILLS:
        content = (Path(skills_path) / name / "SKILL.md").read_text()
        require("version: 3.0.0" in content, f"{name} active skill is not migrated")
    traffic_number = traffic_question_number(jobs)
    validate_traffic(responses[traffic_number])
    sections = {r["section"] for r in records(responses[235])}
    require(sections == {"installs", "retention", "power_retention", "activation", "two_day_activation", "post_generation", "nps", "nps_distribution", "nps_response"}, "Adobe report lost a governed section")
    for number in (234, 271):
        for row in records(responses[number]):
            require(row["net_logo_growth"] == row["new_logos"] + row["expanded_logos"] - row["churned_logos"], f"Q{number} logo counts do not reconcile")
    for number, numerator, denominator, rate in (
        (274, "subscriptions", "signups", "conversion_pct"),
        (275, "subscriptions", "signups", "conversion_pct"),
        (276, "week_two_users", "cohort_users", "week_two_retention_pct"),
    ):
        for row in records(responses[number]):
            expected = row[numerator] / row[denominator] * 100 if row[denominator] else 0
            require(abs(row[rate] - expected) < 0.011, f"Q{number} rates do not reconcile")
    exit_rows = records(responses[239])
    for week in {r["week_start"] for r in exit_rows}:
        group = [r for r in exit_rows if r["week_start"] == week]
        first = group[0]
        reasons = {r["reason"]: r["reason_count"] for r in group}
        plans = {r["plan"]: r["plan_count"] for r in group}
        require(sum(reasons.values()) == first["responses"] == sum(plans.values()), "Q239 breakdown totals do not reconcile")
    return {"reports": 8, "trafficQuestion": traffic_number, "populationAndDeliveryChecks": "passed"}
