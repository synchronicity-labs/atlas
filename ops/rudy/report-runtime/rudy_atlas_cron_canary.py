#!/usr/bin/env python3

import concurrent.futures
import datetime as dt
import json
import os
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen
from final_report_contracts import traffic_question_number, validate_final_reports

BASE = os.environ.get("ATLAS_API_URL", "").rstrip("/")
SECRET = os.environ.get("ATLAS_QUERY_SECRET", "")
JOBS_PATH = Path("/root/.hermes/cron/jobs.json")
Q3_SCRIPT = Path("/usr/local/lib/rudy-hermes-crons/q3_gtm_metabase_refresh.py")
CRON_WRAPPER = Path("/usr/local/sbin/rudy-hermes-cron-run")
ATLAS_AGENT_HEALTH_URL = "https://agent.pr.sync.so/eve/v1/health"

CANONICAL = {
    233,
    2,
    4,
    7,
    8,
    13,
    21,
    23,
    25,
    28,
    31,
    40,
    62,
    63,
    64,
    66,
    71,
    72,
    73,
    74,
    95,
    96,
    97,
    98,
    *range(152, 160),
    *range(193, 202),
    *range(210, 214),
    239,
    242,
    244,
    245,
    236,
    237,
    247,
    248,
    249,
    270,
    234,
    235,
    238,
    240,
    241,
    243,
    246,
    271,
    272,
    273,
    274,
    275,
    276,
}
RECONCILIATION = set(range(233, 250)) - CANONICAL
JOB_REQUIREMENTS = {
    "1cee2c08de19": {"Q2", "Q4", "Q7", "Q13", "Q71-Q74", "Q152", "Q153", "Q247", "Q248"},
    "276d40f46107": {"Q71-Q74", "Q152", "Q153", "Q154-Q159", "Q193-Q201", "Q210-Q213", "Q247", "Q248"},
    "072f69ecb3cd": {"Q8", "Q21", "Q23", "Q242"},
    "929e5e227dc4": {"Q62", "Q63", "Q64", "Q66", "Q244"},
    "8de99ce2b532": {"Q62", "Q63", "Q64", "Q66", "Q244"},
    "0b1d5f7a8e8d": {"Q233"},
    "c4d0695ffc3f": {"Q235"},
    "6d5d35907a5b": {
        "Q234",
        "Q247",
        "Q272",
        "Q274",
        "Q276",
        "ATLAS-FIRST CANONICAL",
    },
    "b1ff759d416d": {
        "Q247",
        "Q271",
        "Q273",
        "Q275",
        "Q276",
        "ATLAS-FIRST CANONICAL",
    },
    "fc9db0707898": {"Canonical Lipsync traffic question:", "525331485", "sc-domain:lipsync.com"},
    "8f666de9e464": {"Q236", "rudy-hermes-cron-run lipsync-weekly-report"},
    "e367aca764b9": {"Q71-Q74", "Q233", "Q238", "Q248"},
    "165f3db78c17": {"Q239"},
    "72c27d5abebd": {
        "Q240",
        "Q241",
        "ATLAS-CANONICAL REPORT",
        "Do not use a raw fallback",
    },
    "c85708289508": {"Q95", "Q96", "Q98", "Q245", "Q270"},
    "5ea671f075c0": {"Q137", "Q246"},
    "9bede82ed90f": {"Q25", "Q249"},
    "0d00398ecf13": {"Q237"},
}
SCRIPT_REQUIREMENTS = {
    "/usr/local/lib/rudy-atlas-runtime/atlas_report_controls.py": {
        "def canonical(number)",
        "def reconciliation(number)",
    },
    "/usr/local/lib/rudy-daily-abuse-report/daily_abuse_report.py": {
        "atlas_question(95)",
        "atlas_question(96)",
        "atlas_question(98)",
        "atlas_question(245)",
        "atlas_question(270)",
    },
    "/usr/local/lib/model-feedback-report/model_feedback_report.py": {
        "atlas_canonical(137)",
        "atlas_canonical(246)",
    },
    "/usr/local/lib/rudy-hermes-crons/geo_weekly_report_post.py": {
        "atlas_canonical(25)",
        "atlas_canonical(249)",
    },
    "/usr/local/lib/rudy-hermes-crons/product_pages_weekly_report_post.py": {
        "atlas_canonical(237)",
        "atlas_rows(payload)",
    },
    "/usr/local/lib/rudy-hermes-crons/lipsync_weekly_report.py": {
        "atlas_question(QUESTION_NUMBER)",
        'question.get("purpose") != "CERTIFIED"',
        'result.get("trustStatus") != "VERIFIED"',
        'freshness.get("status") != "fresh"',
    },
    "/usr/local/lib/rudy-hermes-crons/publish_weekly_metrics.py": {
        '"number": 15',
        '"number": 152',
        '"number": 155',
        "Not published — not verified and fresh",
    },
}
SCOPED_WRAPPERS = (
    "/usr/local/sbin/rudy-daily-abuse-report",
    "/usr/local/sbin/rudy-model-feedback-report",
    "/usr/local/sbin/rudy-ga4-report",
)


def question(number: int) -> tuple[int, dict]:
    request = Request(
        f"{BASE}/internal/atlas/questions/{number}",
        headers={
            "Authorization": f"Bearer {SECRET}",
            "Accept": "application/json",
        },
    )
    with urlopen(request, timeout=45) as response:
        return number, json.load(response)


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, sort_keys=True))
    raise SystemExit(1)


def canonical_readiness_failures(responses, numbers):
    failures = []
    for number in sorted(numbers):
        payload = responses[number]
        freshness = payload.get("freshness") or {}
        trust = (payload.get("result") or {}).get("trustStatus")
        purpose = (payload.get("question") or {}).get("purpose")
        source = (payload.get("provenance") or {}).get("source") or {}
        state = source.get("state")
        status = freshness.get("status")
        if status == "fresh" and trust == "VERIFIED" and purpose == "CERTIFIED":
            continue
        detail = f"Q{number}: {status}, trust={trust}, purpose={purpose}, source={state}"
        if freshness.get("checkedAt"):
            detail += f", checked={freshness['checkedAt']}"
        if freshness.get("deadlineAt"):
            detail += f", deadline={freshness['deadlineAt']}"
        failures.append(detail)
    return failures


def main() -> None:
    if not BASE or not SECRET:
        fail("Atlas runtime is not configured")
    try:
        health_request = Request(
            ATLAS_AGENT_HEALTH_URL,
            headers={"Accept": "application/json"},
        )
        with urlopen(health_request, timeout=20) as response:
            agent_health = json.load(response)
    except Exception as exc:
        fail(f"Atlas ingest agent health failed: {type(exc).__name__}")
    if agent_health.get("ok") is not True or agent_health.get("status") != "ready":
        fail("Atlas ingest agent is not ready")

    with JOBS_PATH.open(encoding="utf-8") as handle:
        jobs = {job["id"]: job for job in json.load(handle)["jobs"]}
    traffic_number = traffic_question_number(jobs)
    canonical_numbers = CANONICAL | {traffic_number}
    numbers = sorted(canonical_numbers | RECONCILIATION)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        responses = dict(executor.map(question, numbers))

    canonical_failures = canonical_readiness_failures(responses, canonical_numbers)
    if canonical_failures:
        shown = canonical_failures[:6]
        remaining = len(canonical_failures) - len(shown)
        suffix = f"; {remaining} more question(s) not ready" if remaining else ""
        fail(f"Atlas report readiness: {len(canonical_failures)} question(s) not ready. " + "; ".join(shown) + suffix)
    try:
        final_reports = validate_final_reports(
            jobs, responses, Path("/root/.hermes/skills/sync-reports")
        )
    except (ValueError, KeyError, TypeError) as exc:
        fail(f"final report contract failed: {exc}")

    hubspot_source = responses[71].get("provenance", {}).get("source", {})
    try:
        last_sync = dt.datetime.fromisoformat(
            str(hubspot_source["lastSyncAt"]).replace("Z", "+00:00")
        )
        hubspot_age = dt.datetime.now(dt.timezone.utc) - last_sync
    except (KeyError, TypeError, ValueError):
        fail("Atlas HubSpot sales source has no valid last-sync time")
    if hubspot_source.get("state") != "HEALTHY" or hubspot_age > dt.timedelta(hours=8):
        fail(
            "Atlas HubSpot sales source is not healthy and current: "
            f"state={hubspot_source.get('state')}, age={hubspot_age}"
        )

    q97 = responses[97].get("result", {})
    if q97.get("rowCount", 0) < 180:
        fail(f"Q97 is truncated: rowCount={q97.get('rowCount')}")
    rows = q97.get("rows") or []
    if not rows or str(rows[-1][0])[:10] != str(q97.get("dataThrough", ""))[:10]:
        fail("Q97 latest row does not match its data-through day")

    q246 = responses[246]
    q246_result = q246.get("result") or {}
    q246_names = [column.get("name") for column in q246_result.get("columns") or []]
    q246_rows = [
        dict(zip(q246_names, row)) for row in q246_result.get("rows") or []
    ]
    q246_product_models = {
        str(row.get("model"))
        for row in q246_rows
        if row.get("surface") == "product_feedback"
    }
    q246_surfaces = {str(row.get("surface")) for row in q246_rows}
    q246_source_counts = {
        int(float(row.get("support_source_items") or 0)) for row in q246_rows
    }
    if (
        q246_product_models != {"1.9", "2", "2-pro", "3"}
        or q246_surfaces != {"product_feedback", "support_negative"}
        or len(q246_source_counts) != 1
    ):
        fail("Q246 model-feedback evidence boundary does not reconcile")

    q243_result = responses[243].get("result") or {}
    q243_names = [column.get("name") for column in q243_result.get("columns") or []]
    q243_rows = [
        dict(zip(q243_names, row)) for row in q243_result.get("rows") or []
    ]
    q243_inbound = sum(int(row.get("enterprise_inbound") or 0) for row in q243_rows)
    q243_closed_won = sum(
        int(row.get("crm_paid_closed_won") or 0) for row in q243_rows
    )
    q243_classified = sum(
        int(row.get(name) or 0)
        for row in q243_rows
        for name in ("net_new_logos", "renewals", "unmapped_deals")
    )
    if (
        not q243_rows
        or q243_inbound <= 0
        or q243_closed_won != q243_classified
        or any(row.get("signed_paid_sows") is not None for row in q243_rows)
        or len({str(row.get("data_through")) for row in q243_rows}) != 1
        or any(
            name in q243_names
            for name in ("email", "domain", "company", "contact_id", "deal_id")
        )
    ):
        fail("Q243 Q3 GTM evidence boundary does not reconcile")

    reconciliation_failures = []
    for number in sorted(RECONCILIATION):
        payload = responses[number]
        purpose = payload.get("question", {}).get("purpose")
        freshness = payload.get("freshness", {}).get("status")
        if purpose != "RECONCILIATION" or freshness != "unavailable":
            reconciliation_failures.append(f"Q{number}:{purpose}/{freshness}")
    if reconciliation_failures:
        fail(
            "reconciliation questions changed state without certification: "
            + ", ".join(reconciliation_failures)
        )

    with JOBS_PATH.open(encoding="utf-8") as handle:
        jobs = {job["id"]: job for job in json.load(handle)["jobs"]}
    job_failures = []
    for job_id, markers in JOB_REQUIREMENTS.items():
        job = jobs.get(job_id)
        if not job or not job.get("enabled"):
            job_failures.append(f"{job_id}:missing-or-disabled")
            continue
        skills = set(job.get("skills") or [])
        prompt = job.get("prompt") or ""
        if "atlas-company-intelligence" not in skills:
            job_failures.append(f"{job_id}:skill")
        missing = sorted(marker for marker in markers if marker not in prompt)
        if missing:
            job_failures.append(f"{job_id}:prompt:{','.join(missing)}")
    api_report = jobs.get("72c27d5abebd") or {}
    if set(api_report.get("skills") or []) != {
        "atlas-company-intelligence",
        "company-brain",
    }:
        job_failures.append("72c27d5abebd:raw-source-skill")
    atlas_linear = jobs.get("4490abf200b8")
    if (
        not atlas_linear
        or not atlas_linear.get("enabled")
        or atlas_linear.get("script") != "publish_weekly_metrics.sh"
        or not atlas_linear.get("no_agent")
    ):
        job_failures.append("4490abf200b8:binding")
    q3_refresh = jobs.get("385ee6e063d0")
    if (
        not q3_refresh
        or not q3_refresh.get("enabled")
        or q3_refresh.get("script") != "q3_gtm_metabase_refresh.py"
        or not q3_refresh.get("no_agent")
    ):
        job_failures.append("385ee6e063d0:binding")
    else:
        q3_prompt = q3_refresh.get("prompt") or ""
        for marker in (
            "Q243",
            "certified, verified, fresh Atlas questions",
            "Do not read Slack or raw CRM data",
            "signature counts explicitly unavailable",
        ):
            if marker not in q3_prompt:
                job_failures.append(f"385ee6e063d0:prompt:{marker}")
    if job_failures:
        fail("cron Atlas bindings drifted: " + "; ".join(job_failures))

    q3_script = Q3_SCRIPT.read_text(encoding="utf-8")
    wrapper = CRON_WRAPPER.read_text(encoding="utf-8")
    q3_question_markers = {
        243: "atlas_records(243)",
        71: '71, "open_pipeline_amount", "month"',
        72: "atlas_records(72)",
        73: '73, "weighted_pipeline_amount", "month"',
        74: '74, "closed_won_amount", "month"',
        195: '195, "partner_invoices_raised"',
        196: '196, "partner_cash_collected"',
        198: "atlas_records(198)",
        199: '199, "partner_usage_run_rate"',
    }
    missing_q3_questions = [
        number for number, marker in q3_question_markers.items()
        if marker not in q3_script
    ]
    if missing_q3_questions:
        fail(
            "Q3 GTM script is missing Atlas questions: "
            + ", ".join(f"Q{number}" for number in missing_q3_questions)
        )
    if 'DRY_RUN = "--dry-run" in sys.argv[1:]' not in q3_script:
        fail("Q3 GTM script no longer has a safe dry-run mode")
    if any(
        marker in q3_script
        for marker in (
            "/srv/rudy-slack",
            "NEW INBOUND FORM SUBMISSION",
            "HUBSPOT_API_KEY",
            "PYLON_API_KEY",
        )
    ):
        fail("Q3 GTM presentation script reads a raw source")
    q3_route = wrapper.partition("q3-gtm-metabase-refresh)")[2].partition(";;")[0]
    if (
        "prd_core:ATLAS_API_URL,ATLAS_QUERY_SECRET" not in q3_route
        or "prd_plutus:METABASE_API_KEY,METABASE_URL" not in q3_route
        or any(
            marker in q3_route
            for marker in ("prd_hubspot", "prd_integrations", "prd_pylon", "prd_gbrain")
        )
    ):
        fail("Q3 GTM wrapper is not Atlas-only for report evidence")
    producer = Path(
        "/usr/local/lib/rudy-hermes-crons/q3_inbound_atlas_ingest.py"
    ).read_text(encoding="utf-8")
    if any(marker not in producer for marker in ("sourceItemCount", "enterpriseInbound")):
        fail("Q3 inbound producer no longer publishes aggregate evidence")
    for unit in (
        "rudy-q3-inbound-atlas-ingest.timer",
        "rudy-q3-inbound-atlas-ingest.service",
    ):
        state = subprocess.run(
            ["/usr/bin/systemctl", "show", unit, "-p", "LoadState", "--value"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if state.returncode != 0 or state.stdout.strip() != "loaded":
            fail(f"Q3 inbound producer unit is not loaded: {unit}")
    timer = subprocess.run(
        ["/usr/bin/systemctl", "is-active", "rudy-q3-inbound-atlas-ingest.timer"],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    if timer.returncode != 0 or timer.stdout.strip() != "active":
        fail("Q3 inbound producer timer is not active")
    lipsync_route = wrapper.partition("lipsync-weekly-report)")[2].partition(";;")[0]
    if (
        "prd_core:ATLAS_API_URL,ATLAS_QUERY_SECRET" not in lipsync_route
        or "POSTHOG_" in lipsync_route
    ):
        fail("Lipsync funnel wrapper is not Atlas-only")

    script_failures = []
    for path, markers in SCRIPT_REQUIREMENTS.items():
        content = Path(path).read_text(encoding="utf-8")
        try:
            compile(content, path, "exec")
        except SyntaxError as exc:
            script_failures.append(f"{path}:syntax:{exc.msg}")
            continue
        missing = sorted(marker for marker in markers if marker not in content)
        if missing:
            script_failures.append(f"{path}:{','.join(missing)}")
    if script_failures:
        fail("hybrid Atlas script bindings drifted: " + "; ".join(script_failures))

    wrapper_failures = []
    for path in SCOPED_WRAPPERS:
        content = Path(path).read_text(encoding="utf-8")
        syntax = subprocess.run(
            ["/usr/bin/bash", "-n", path],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if syntax.returncode != 0:
            wrapper_failures.append(f"{path}:syntax")
        if "prd_core:ATLAS_API_URL,ATLAS_QUERY_SECRET" not in content:
            wrapper_failures.append(path)
    inner_path = "/usr/local/libexec/rudy-ga4-report-inner"
    inner = Path(inner_path).read_text(encoding="utf-8")
    inner_syntax = subprocess.run(
        ["/usr/bin/bash", "-n", inner_path],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    if inner_syntax.returncode != 0:
        wrapper_failures.append(f"{inner_path}:syntax")
    if "ATLAS_QUERY_SECRET=${ATLAS_QUERY_SECRET:-}" not in inner:
        wrapper_failures.append(inner_path)
    if wrapper_failures:
        fail("scoped Atlas injection drifted: " + ", ".join(wrapper_failures))

    model_feedback_wrapper = Path(
        "/usr/local/sbin/rudy-model-feedback-report"
    ).read_text(encoding="utf-8")
    if any(
        marker in model_feedback_wrapper
        for marker in ("prd_gbrain_mcp", "METABASE", "DATABASE_URL", "PYLON")
    ):
        fail("model-feedback delivery wrapper is not Atlas-only")

    print(
        json.dumps(
            {
                "ok": True,
                "canonicalQuestions": len(canonical_numbers),
                "finalReports": final_reports,
                "reconciliationQuestions": len(RECONCILIATION),
                "boundCronJobs": len(JOB_REQUIREMENTS),
                "atlasCronPaths": len(JOB_REQUIREMENTS) + 2,
                "atlasAgent": agent_health.get("status"),
                "hubspotSourceAgeMinutes": round(hubspot_age.total_seconds() / 60),
                "q97Rows": q97.get("rowCount"),
                "q97DataThrough": q97.get("dataThrough"),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
