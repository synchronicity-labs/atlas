#!/usr/bin/env python3

import json
import os
import urllib.request


def _required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is missing from the scoped runtime")
    return value


def question(number):
    base = _required_env("ATLAS_API_URL").rstrip("/")
    secret = _required_env("ATLAS_QUERY_SECRET")
    request = urllib.request.Request(
        f"{base}/internal/atlas/questions/{number}",
        headers={"Authorization": f"Bearer {secret}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def canonical(number):
    payload = question(number)
    freshness = payload.get("freshness", {}).get("status")
    trust = (payload.get("result") or {}).get("trustStatus")
    purpose = payload.get("question", {}).get("purpose")
    source = payload.get("provenance", {}).get("source", {}).get("state")
    if freshness != "fresh" or trust != "VERIFIED" or purpose != "CERTIFIED" or source != "HEALTHY":
        raise RuntimeError(f"Atlas Q{number} is {purpose}/{freshness}/{trust}, source={source}")
    return payload


def reconciliation(number):
    payload = question(number)
    if payload.get("question", {}).get("purpose") != "RECONCILIATION":
        raise RuntimeError(f"Atlas Q{number} is not a reconciliation question")
    return payload


def rows(payload):
    result = payload.get("result") or {}
    names = [column.get("name") for column in result.get("columns") or []]
    values = result.get("rows") or []
    if any(len(row) != len(names) for row in values):
        raise ValueError("Atlas result row does not match its columns")
    return [dict(zip(names, row)) for row in values]


def data_through(payload):
    return ((payload.get("result") or {}).get("dataThrough") or "unknown")
