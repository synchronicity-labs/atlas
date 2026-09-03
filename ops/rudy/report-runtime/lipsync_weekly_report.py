#!/usr/bin/env python3
"""Build the weekly Lipsync product funnel from governed Atlas Q236."""

import datetime as dt
import json
import os
import sys
import urllib.request


QUESTION_NUMBER = 236
OUTPUT_PATH = "/tmp/lipsync_weekly_funnel.png"


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def atlas_question(number: int) -> dict:
    base = required_env("ATLAS_API_URL").rstrip("/")
    secret = required_env("ATLAS_QUERY_SECRET")
    request = urllib.request.Request(
        f"{base}/internal/atlas/questions/{number}",
        headers={
            "Authorization": f"Bearer {secret}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def verified_rows(payload: dict) -> list[dict]:
    question = payload.get("question", {})
    result = payload.get("result", {})
    freshness = payload.get("freshness", {})
    if question.get("number") != QUESTION_NUMBER:
        raise RuntimeError("Atlas returned the wrong question")
    if question.get("purpose") != "CERTIFIED":
        raise RuntimeError("Atlas Q236 is not certified")
    if result.get("trustStatus") != "VERIFIED":
        raise RuntimeError("Atlas Q236 is not verified")
    if freshness.get("status") != "fresh":
        raise RuntimeError("Atlas Q236 is not fresh")
    names = [column["name"] for column in result.get("columns", [])]
    values = result.get("rows", [])
    if any(len(row) != len(names) for row in values):
        raise ValueError("Atlas Q236 result row does not match its columns")
    rows = [dict(zip(names, row)) for row in values]
    if len(rows) < 2:
        raise RuntimeError("Atlas Q236 needs at least two complete cohorts")
    return rows


def date(value: object) -> dt.date:
    return dt.date.fromisoformat(str(value)[:10])


def integer(value: object) -> int:
    return int(float(str(value)))


def number(value: object) -> float:
    return float(str(value))


def percent_change(current: int, previous: int) -> str:
    if previous == 0:
        return "new" if current else "flat"
    change = (current - previous) / previous * 100
    if change > 0:
        return f"up {change:.0f}%"
    if change < 0:
        return f"down {abs(change):.0f}%"
    return "flat"


def aggregate(rows: list[dict]) -> dict[str, float]:
    result = {
        "signups": sum(integer(row["signups"]) for row in rows),
        "projects_started": sum(integer(row["projects_started"]) for row in rows),
        "successful_generations": sum(
            integer(row["successful_generations"]) for row in rows
        ),
        "paid_subscriptions": sum(integer(row["paid_subscriptions"]) for row in rows),
    }
    signups = result["signups"]
    result["signup_to_project_pct"] = (
        result["projects_started"] / signups * 100 if signups else 0
    )
    result["signup_to_generation_pct"] = (
        result["successful_generations"] / signups * 100 if signups else 0
    )
    result["signup_to_paid_pct"] = (
        result["paid_subscriptions"] / signups * 100 if signups else 0
    )
    return result


def report(rows: list[dict]) -> str:
    current = rows[-1]
    previous = rows[-2]
    start = date(current["cohort_week"])
    end = start + dt.timedelta(days=6)
    lines = [
        "*📊 lipsync.com → sync.so product funnel*",
        f"_signup cohort {start:%b %d}–{end:%b %d, %Y} · seven-day outcome window complete_",
        "",
        "*latest mature cohort*",
        (
            f"• *{integer(current['signups'])}* signups → "
            f"*{integer(current['projects_started'])}* projects "
            f"({number(current['signup_to_project_pct']):.1f}%) → "
            f"*{integer(current['successful_generations'])}* successful generations "
            f"({number(current['signup_to_generation_pct']):.1f}% of signups)"
        ),
        (
            f"• *{integer(current['paid_subscriptions'])}* paid subscriptions "
            f"({number(current['signup_to_paid_pct']):.1f}% of signups)"
        ),
        "",
        "*week over week*",
    ]
    labels = {
        "signups": "signups",
        "projects_started": "projects",
        "successful_generations": "successful generations",
        "paid_subscriptions": "paid subscriptions",
    }
    for key, label in labels.items():
        old = integer(previous[key])
        new = integer(current[key])
        lines.append(f"• {label}: {old} → {new} ({percent_change(new, old)})")

    if len(rows) >= 8:
        prior_four = aggregate(rows[-8:-4])
        latest_four = aggregate(rows[-4:])
        lines.extend(
            [
                "",
                "*four-week cohort view*",
                (
                    f"• signups: {int(prior_four['signups'])} → "
                    f"{int(latest_four['signups'])} "
                    f"({percent_change(int(latest_four['signups']), int(prior_four['signups']))})"
                ),
                (
                    f"• signup → project: {prior_four['signup_to_project_pct']:.1f}% → "
                    f"{latest_four['signup_to_project_pct']:.1f}%"
                ),
                (
                    "• signup → successful generation: "
                    f"{prior_four['signup_to_generation_pct']:.1f}% → "
                    f"{latest_four['signup_to_generation_pct']:.1f}%"
                ),
                (
                    f"• signup → paid: {prior_four['signup_to_paid_pct']:.1f}% → "
                    f"{latest_four['signup_to_paid_pct']:.1f}%"
                ),
            ]
        )

    lines.extend(
        [
            "",
            "*scope*",
            "• Atlas Q236 · CERTIFIED · VERIFIED · fresh",
            "• Product outcomes use first-referrer Lipsync signup cohorts. Website traffic and search demand are separate populations; do not divide these product outcomes by GA4 sessions or Search Console clicks.",
        ]
    )
    return "\n".join(lines)


def chart(rows: list[dict], output_path: str) -> str:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    current = rows[-1]
    previous = rows[-2]
    metrics = ["Signups", "Projects", "Generated", "Paid"]
    keys = [
        "signups",
        "projects_started",
        "successful_generations",
        "paid_subscriptions",
    ]
    current_values = [integer(current[key]) for key in keys]
    previous_values = [integer(previous[key]) for key in keys]
    x = np.arange(len(metrics))
    width = 0.35
    figure, axis = plt.subplots(figsize=(10, 6))
    bars = [
        axis.bar(
            x - width / 2,
            previous_values,
            width,
            label="Previous mature cohort",
            color="#94a3b8",
        ),
        axis.bar(
            x + width / 2,
            current_values,
            width,
            label="Latest mature cohort",
            color="#6366f1",
        ),
    ]
    axis.set_ylabel("People")
    axis.set_title("Lipsync-attributed seven-day product funnel")
    axis.set_xticks(x)
    axis.set_xticklabels(metrics)
    axis.legend()
    for group in bars:
        for bar in group:
            height = bar.get_height()
            axis.annotate(
                str(int(height)),
                xy=(bar.get_x() + bar.get_width() / 2, height),
                xytext=(0, 3),
                textcoords="offset points",
                ha="center",
                va="bottom",
            )
    figure.tight_layout()
    figure.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(figure)
    return output_path


def main() -> None:
    payload = atlas_question(QUESTION_NUMBER)
    rows = verified_rows(payload)
    chart_path = None if "--dry-run" in sys.argv[1:] else chart(rows, OUTPUT_PATH)
    print(
        json.dumps(
            {
                "text": report(rows),
                "chart": chart_path,
                "atlas_question": QUESTION_NUMBER,
                "latest_cohort": rows[-1],
                "previous_cohort": rows[-2],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
