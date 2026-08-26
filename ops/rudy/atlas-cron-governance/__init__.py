from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.request
from typing import Any


PLAN_TTL_SECONDS = 30 * 60
AUTHORING_BROKER = "/usr/local/sbin/rudy-atlas-question-draft"
ATLAS_SKILL = "atlas-company-intelligence"
_PLANS: dict[str, dict[str, Any]] = {}
_LOCK = threading.Lock()

SCHEMA = {
    "name": "atlas_cron_plan",
    "description": (
        "Mandatory Atlas preflight for every new recurring Rudy cron. Search the "
        "governed catalog before creating a cron. Use create_draft only when an "
        "analytics report has no logical certified question. Drafts cannot run in "
        "crons until Atlas certifies and verifies them."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["search", "create_draft"]},
            "query": {
                "type": "string",
                "description": "Plain-language purpose and output of the requested cron.",
            },
            "request_key": {"type": "string"},
            "name": {"type": "string"},
            "business_definition": {"type": "string"},
            "decision_use": {"type": "string"},
            "owner_team": {"type": "string"},
            "cadence": {
                "type": "string",
                "enum": ["hourly", "daily", "weekly", "monthly", "quarterly", "ad-hoc"],
            },
            "dimensions": {"type": "array", "items": {"type": "string"}},
            "source_hints": {"type": "array", "items": {"type": "string"}},
            "acceptance_checks": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["action"],
    },
}


def _session_key(kwargs: dict[str, Any]) -> str:
    return str(kwargs.get("session_id") or kwargs.get("task_id") or "").strip()


def _request(path: str) -> dict[str, Any]:
    base_url = os.environ.get("ATLAS_API_URL", "").rstrip("/")
    secret = os.environ.get("ATLAS_QUERY_SECRET", "")
    if not base_url or not secret:
        raise RuntimeError("Atlas read access is not configured in this runtime")
    request = urllib.request.Request(
        f"{base_url}{path}",
        headers={"Authorization": f"Bearer {secret}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"Atlas returned HTTP {error.code}: {detail}") from error
    if not isinstance(result, dict):
        raise RuntimeError("Atlas returned an invalid response")
    return result


def _tokens(value: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", value.casefold())
        if len(token) >= 3
    }


def _score(question: dict[str, Any], query: str) -> int:
    query_tokens = _tokens(query)
    metric = question.get("metric") or {}
    text = " ".join(
        str(value or "")
        for value in (
            question.get("number"),
            question.get("name"),
            question.get("description"),
            metric.get("key"),
            metric.get("name"),
            metric.get("description"),
            metric.get("ownerTeam"),
        )
    )
    text_tokens = _tokens(text)
    overlap = len(query_tokens & text_tokens)
    phrase = 20 if query.casefold().strip() in text.casefold() else 0
    name_overlap = len(query_tokens & _tokens(str(question.get("name") or "")))
    return phrase + overlap * 3 + name_overlap * 4


def _eligibility(number: int) -> dict[str, Any]:
    response = _request(f"/internal/atlas/questions/{number}")
    question = response.get("question") or {}
    result = response.get("result") or {}
    freshness = response.get("freshness") or {}
    checks = {
        "active": question.get("status") == "ACTIVE",
        "certified": question.get("purpose") == "CERTIFIED",
        "verified": result.get("trustStatus") == "VERIFIED",
        "fresh": freshness.get("status") == "fresh",
    }
    return {
        "eligible": all(checks.values()),
        "checks": checks,
        "freshnessReason": freshness.get("reason"),
        "dataThrough": result.get("dataThrough"),
        "reportingPeriod": result.get("reportingPeriod"),
    }


def _store_plan(key: str, plan: dict[str, Any]) -> str:
    if not key:
        raise RuntimeError("Atlas cron planning requires a Hermes session")
    token = secrets.token_urlsafe(12)
    with _LOCK:
        _PLANS[key] = {**plan, "token": token, "created_at": time.monotonic()}
    return token


def _search(args: dict[str, Any], key: str) -> str:
    query = str(args.get("query") or "").strip()
    if len(query) < 8:
        return json.dumps({"error": "query must describe the recurring cron"})
    catalog = _request("/internal/atlas/catalog")
    scored = [
        (_score(question, query), question)
        for question in catalog.get("questions", [])
        if isinstance(question, dict)
    ]
    candidates = []
    eligible_numbers = []
    for score, question in sorted(scored, key=lambda item: item[0], reverse=True)[:8]:
        if score <= 0:
            continue
        number = int(question["number"])
        eligibility = _eligibility(number)
        if eligibility["eligible"]:
            eligible_numbers.append(number)
        candidates.append(
            {
                "number": number,
                "name": question.get("name"),
                "description": question.get("description"),
                "score": score,
                **eligibility,
            }
        )
    token = _store_plan(
        key,
        {"mode": "search", "query": query, "eligible_numbers": eligible_numbers},
    )
    return json.dumps(
        {
            "schemaVersion": "rudy.atlas-cron-plan.v1",
            "planToken": token,
            "query": query,
            "candidates": candidates,
            "instructions": {
                "canonical": f"ATLAS_PLAN: token={token} canonical=Q<number>",
                "operationalDirect": (
                    f"ATLAS_PLAN: token={token} operational-direct reason=<why Atlas is not logical>"
                ),
                "missingAnalyticsMetric": (
                    "Call atlas_cron_plan again with action=create_draft. Do not create the cron yet."
                ),
            },
        },
        separators=(",", ":"),
    )


def _create_draft(args: dict[str, Any], key: str) -> str:
    mapping = {
        "requestKey": args.get("request_key"),
        "name": args.get("name"),
        "businessDefinition": args.get("business_definition"),
        "decisionUse": args.get("decision_use"),
        "ownerTeam": args.get("owner_team"),
        "cadence": args.get("cadence"),
        "dimensions": args.get("dimensions") or [],
        "sourceHints": args.get("source_hints") or [],
        "acceptanceChecks": args.get("acceptance_checks") or [],
    }
    process = subprocess.run(
        ["sudo", "-n", AUTHORING_BROKER],
        input=json.dumps(mapping, separators=(",", ":")),
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    if process.returncode != 0:
        detail = (process.stdout or process.stderr or "broker failed").strip()[:1_000]
        return json.dumps({"error": detail})
    result = json.loads(process.stdout)
    token = _store_plan(
        key,
        {
            "mode": "draft",
            "query": str(args.get("business_definition") or ""),
            "eligible_numbers": [],
        },
    )
    result["planToken"] = token
    result["cronBlocked"] = True
    return json.dumps(result, separators=(",", ":"))


def handle_plan(args: dict[str, Any], **kwargs: Any) -> str:
    try:
        key = _session_key(kwargs)
        if args.get("action") == "search":
            return _search(args, key)
        if args.get("action") == "create_draft":
            return _create_draft(args, key)
        return json.dumps({"error": "unknown action"})
    except Exception as error:
        return json.dumps({"error": f"Atlas cron planning failed: {error}"})


def available() -> bool:
    return bool(os.environ.get("ATLAS_API_URL") and os.environ.get("ATLAS_QUERY_SECRET"))


def _one_off(args: dict[str, Any]) -> bool:
    if args.get("repeat") == 1:
        return True
    schedule = str(args.get("schedule") or "").strip()
    return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}T[^ ]+", schedule))


def _on_pre_tool_call(
    tool_name: str = "",
    args: Any = None,
    session_id: str = "",
    task_id: str = "",
    **_: Any,
) -> dict[str, str] | None:
    if tool_name != "cronjob" or not isinstance(args, dict):
        return None
    if str(args.get("action") or "").strip().lower() != "create" or _one_off(args):
        return None
    key = session_id or task_id
    with _LOCK:
        plan = _PLANS.get(key)
    if not plan or time.monotonic() - plan["created_at"] > PLAN_TTL_SECONDS:
        return {
            "action": "block",
            "message": (
                "Recurring cron creation requires an Atlas preflight. Call "
                "atlas_cron_plan(action='search', query='<purpose and output>') first."
            ),
        }
    if plan["mode"] == "draft":
        return {
            "action": "block",
            "message": (
                "The Atlas question is still a draft. Do not create this report cron until "
                "the question is certified, verified, and fresh."
            ),
        }
    prompt = str(args.get("prompt") or "")
    marker = re.search(
        r"ATLAS_PLAN:\s*token=([^\s]+)\s+(canonical=Q(\d+)|operational-direct\s+reason=(.{12,}))",
        prompt,
        re.IGNORECASE,
    )
    if not marker or marker.group(1) != plan["token"]:
        return {
            "action": "block",
            "message": "Add the exact ATLAS_PLAN marker returned by atlas_cron_plan to the cron prompt.",
        }
    if marker.group(3):
        number = int(marker.group(3))
        if number not in plan["eligible_numbers"]:
            return {
                "action": "block",
                "message": (
                    f"Atlas Q{number} was not an eligible result in this plan. Search again "
                    "with a clearer report definition."
                ),
            }
        eligibility = _eligibility(number)
        if not eligibility["eligible"]:
            return {
                "action": "block",
                "message": f"Atlas Q{number} is no longer certified, verified, and fresh.",
            }
        skills = args.get("skills") or []
        if ATLAS_SKILL not in skills:
            return {
                "action": "block",
                "message": f"Attach the {ATLAS_SKILL} skill to the recurring report cron.",
            }
    with _LOCK:
        _PLANS.pop(key, None)
    return None


def register(ctx: Any) -> None:
    ctx.register_tool(
        name="atlas_cron_plan",
        toolset="atlas-company-intelligence",
        schema=SCHEMA,
        handler=handle_plan,
        check_fn=available,
        emoji="🧭",
    )
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
