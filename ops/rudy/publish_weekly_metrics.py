import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request


DEFAULT_PROJECT_ID = "b7ef7153-b2b4-4e5d-a6d9-a922c3fe74a9"
DEFAULT_ATLAS_APP_URL = "https://atlas.pr.sync.so"
QUESTION_SPECS = (
    {
        "number": 15,
        "label": "Monthly professional organizations",
        "column": "value",
        "format": "integer",
    },
    {
        "number": 1102,
        "label": "Current product run-rate",
        "column": "product_run_rate",
        "format": "currency_monthly",
    },
    {
        "number": 1105,
        "label": "Latest complete-month usage NDR",
        "column": "usage_ndr_pct",
        "format": "percent",
    },
)


def request_json(url, headers=None, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:1000]
        raise RuntimeError(f"Request failed with HTTP {error.code}: {detail}") from error


def fetch_question(base_url, secret, number):
    return request_json(
        f"{base_url.rstrip('/')}/internal/atlas/questions/{number}",
        headers={
            "Authorization": f"Bearer {secret}",
            "Accept": "application/json",
        },
    )


def linear_graphql(api_key, query, variables):
    response = request_json(
        "https://api.linear.app/graphql",
        headers={
            "Authorization": api_key,
            "Content-Type": "application/json",
        },
        payload={"query": query, "variables": variables},
    )
    if response.get("errors"):
        messages = "; ".join(error.get("message", "Unknown error") for error in response["errors"])
        raise RuntimeError(f"Linear GraphQL failed: {messages}")
    return response["data"]


def result_value(question, column):
    result = question.get("result") or {}
    columns = [item.get("name") for item in result.get("columns") or []]
    rows = result.get("rows") or []
    if column not in columns:
        raise RuntimeError(f"Atlas question {question_number(question)} is missing column {column}.")
    if not rows:
        raise RuntimeError(f"Atlas question {question_number(question)} returned no rows.")
    return rows[-1][columns.index(column)]


def question_number(question):
    return (question.get("question") or {}).get("number", "unknown")


def format_value(value, kind):
    if kind == "integer":
        return f"{round(float(value)):,}"
    if kind == "currency_monthly":
        return f"${float(value):,.0f} / month"
    if kind == "percent":
        return f"{float(value):.1f}%"
    return str(value)


def format_timestamp(value):
    if not value:
        return "unknown"
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(dt.timezone.utc).strftime("%d %b %Y, %H:%M UTC")


def verification_notes(question):
    provenance = question.get("provenance") or {}
    run = provenance.get("metricRun") or {}
    notes = []
    for verification in run.get("verifications") or []:
        if verification.get("status") == "PASSED":
            continue
        evidence = verification.get("evidence") or {}
        reason = evidence.get("reason") or verification.get("name") or "Verification is incomplete."
        notes.append(reason.rstrip("."))
    freshness = question.get("freshness") or {}
    if freshness.get("status") not in {None, "fresh"} and freshness.get("reason"):
        notes.append(str(freshness["reason"]).rstrip("."))
    return list(dict.fromkeys(notes))


def trust_health(questions):
    states = {(question.get("result") or {}).get("trustStatus", "PENDING") for question in questions}
    freshness = {(question.get("freshness") or {}).get("status", "pending") for question in questions}
    if states & {"FAILED", "STALE"} or freshness & {"failed", "stale", "error"}:
        return "offTrack"
    if states != {"VERIFIED"} or freshness != {"fresh"}:
        return "atRisk"
    return "onTrack"


def week_marker(now):
    year, week, _ = now.isocalendar()
    return f"atlas-weekly-metrics:{year}-W{week:02d}"


def build_update(questions, now, app_url=DEFAULT_ATLAS_APP_URL):
    by_number = {question_number(question): question for question in questions}
    marker = week_marker(now)
    lines = [
        f"## Atlas weekly metrics — {now.strftime('%d %b %Y')}",
        "",
        "Generated directly from governed Atlas snapshots with no manual assembly.",
        "",
        "| Metric | Value | Reporting period | Data through | Trust |",
        "| --- | ---: | --- | --- | --- |",
    ]
    notes = []
    for spec in QUESTION_SPECS:
        question = by_number.get(spec["number"])
        if not question:
            raise RuntimeError(f"Atlas question {spec['number']} was not loaded.")
        result = question.get("result") or {}
        trust = result.get("trustStatus", "PENDING")
        value = format_value(result_value(question, spec["column"]), spec["format"])
        link = f"{app_url.rstrip('/')}/questions/{spec['number']}"
        label = f"[{spec['label']}]({link})"
        lines.append(
            f"| {label} | **{value}** | {result.get('reportingPeriod') or 'unknown'} | "
            f"{format_timestamp(result.get('dataThrough'))} | **{trust}** |"
        )
        for reason in verification_notes(question):
            notes.append(f"- **{spec['label']}** is {trust.lower()}: {reason}.")
    lines.extend(["", "### Trust notes", ""])
    if notes:
        lines.extend(notes)
    else:
        lines.append("- All three snapshots are verified and fresh.")
    lines.extend(
        [
            "",
            "Calendar periods use UTC. Each linked question includes its definition, query version, source evidence, and immutable result.",
            "",
            f"automation id: `{marker}`",
        ]
    )
    return "\n".join(lines), marker, trust_health(questions)


def recent_project_updates(api_key, project_id):
    query = """
query ProjectUpdates($id: String!) {
  project(id: $id) {
    projectUpdates(first: 25) {
      nodes { id body createdAt health }
    }
  }
}
"""
    data = linear_graphql(api_key, query, {"id": project_id})
    project = data.get("project")
    if not project:
        raise RuntimeError("Linear project was not found.")
    return (project.get("projectUpdates") or {}).get("nodes") or []


def create_project_update(api_key, project_id, body, health):
    mutation = """
mutation CreateProjectUpdate($input: ProjectUpdateCreateInput!) {
  projectUpdateCreate(input: $input) {
    success
    projectUpdate { id createdAt health }
  }
}
"""
    data = linear_graphql(
        api_key,
        mutation,
        {"input": {"projectId": project_id, "body": body, "health": health}},
    )
    payload = data.get("projectUpdateCreate") or {}
    if not payload.get("success") or not payload.get("projectUpdate"):
        raise RuntimeError("Linear did not create the project update.")
    return payload["projectUpdate"]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--project-id", default=os.environ.get("LINEAR_METRICS_PROJECT_ID", DEFAULT_PROJECT_ID))
    parser.add_argument("--app-url", default=os.environ.get("ATLAS_APP_URL", DEFAULT_ATLAS_APP_URL))
    return parser.parse_args()


def main():
    args = parse_args()
    atlas_url = os.environ.get("ATLAS_API_URL", "")
    atlas_secret = os.environ.get("ATLAS_QUERY_SECRET", "")
    if not atlas_url or not atlas_secret:
        raise RuntimeError("ATLAS_API_URL and ATLAS_QUERY_SECRET are required.")
    questions = [fetch_question(atlas_url, atlas_secret, spec["number"]) for spec in QUESTION_SPECS]
    now = dt.datetime.now(dt.timezone.utc)
    body, marker, health = build_update(questions, now, args.app_url)
    if args.dry_run:
        print(body)
        return
    linear_key = os.environ.get("LINEAR_API_KEY", "")
    if not linear_key:
        raise RuntimeError("LINEAR_API_KEY is required.")
    for update in recent_project_updates(linear_key, args.project_id):
        if marker in (update.get("body") or ""):
            print(f"Skipped: Linear project update already exists for {marker} ({update['id']}).")
            return
    update = create_project_update(linear_key, args.project_id, body, health)
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:12]
    print(f"Created Linear project update {update['id']} ({health}, body {digest}).")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Atlas weekly metrics update failed: {error}", file=sys.stderr)
        raise SystemExit(1)
