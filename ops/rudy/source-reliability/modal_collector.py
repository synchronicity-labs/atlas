import argparse
import json
import math
import os
import subprocess
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from atlas_http import https_origin, request_json


MODELS = {
    "sync-v2.5-v0": "sync-2-pro",
    "sync-v2.0.0-short-v1-25fps": "sync-2",
    "sync-v1.9.0-beta-long": "sync-1.9",
    "sync-v1.9.0-short": "sync-1.9",
    "react-distributed-inference": "react-1",
    "sync-v2.0.0-short-v1-mini": "sync-2-mini",
    "sync-v3.0.0-modal-prod": "sync-3",
}


def model(value):
    value = str(value or "")
    for prefix, target in MODELS.items():
        if value.startswith(prefix):
            return target
    if "sync-v3.0" in value.lower() or "sync-3" in value.lower():
        return "sync-3"
    return "other"


def windows(today):
    current = today.replace(day=1)
    previous = (current - timedelta(days=1)).replace(day=1)
    return [(start, end) for start, end in [(previous, current), (current, today)] if start < end]


def aggregate(batches, now):
    totals = defaultdict(float)
    for start, end, entries in batches:
        if not isinstance(entries, list) or not entries:
            raise ValueError("Modal returned an empty or invalid billing window")
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("Invalid Modal billing row")
            timestamp = entry.get("interval_start") or entry.get("Interval Start")
            if not isinstance(timestamp, str):
                raise ValueError("Modal billing row has no interval")
            day = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).date()
            if not start <= day < end:
                raise ValueError("Modal billing row is outside the requested window")
            cost = entry.get("cost", entry.get("Cost"))
            if isinstance(cost, bool) or cost is None:
                raise ValueError("Modal billing row has no cost")
            cost = float(cost)
            if not math.isfinite(cost) or cost < 0:
                raise ValueError("Invalid Modal billing cost")
            target = model(entry.get("object_id") or entry.get("Object ID"))
            if target == "other":
                target = model(entry.get("description") or entry.get("Description"))
            totals[(day.strftime("%Y-%m"), target)] += cost
    if not totals:
        raise ValueError("Modal returned no billing totals")
    return {"collector": "rudy-modal-billing-v1", "capturedAt": now.isoformat().replace("+00:00", "Z"),
            "rows": [{"month": month, "model": target, "costUsd": round(cost, 6)} for (month, target), cost in sorted(totals.items())]}


def collect(now):
    batches = []
    for start, end in windows(now.date()):
        result = subprocess.run(["/usr/local/sbin/rudy-modal-billing", "--start", start.isoformat(), "--end", end.isoformat(), "--json"],
                                capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError("Scoped Modal billing reader failed")
        batches.append((start, end, json.loads(result.stdout)))
    return aggregate(batches, now)


def run(dry_run=False):
    base = os.environ.get("ATLAS_API_URL", "")
    secret = os.environ.get("ATLAS_MODAL_INGEST_SECRET", "")
    if not dry_run and not (base and secret):
        print(json.dumps({"status": "disabled", "reason": "Missing optional Modal ingestion configuration"}))
        return
    if not dry_run:
        base = https_origin(base)
    payload = collect(datetime.now(timezone.utc))
    if dry_run:
        print(json.dumps({"dryRun": True, "rows": len(payload["rows"]), "months": sorted({row["month"] for row in payload["rows"]})}))
        return
    result = request_json(base + "/internal/sync/modal", secret, payload)
    if not isinstance(result.get("snapshotCreated"), bool) or result.get("rows") != len(payload["rows"]):
        raise RuntimeError("Atlas did not acknowledge the Modal snapshot")
    print(json.dumps({"rowsImported": 0 if result.get("ignored") is True else len(payload["rows"]), "result": result}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(args.dry_run)
