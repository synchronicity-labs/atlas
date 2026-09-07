import argparse
import fcntl
import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from atlas_http import RateLimited, request_json


def instant(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Timestamp is not a string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp has no timezone")
    return parsed


def validated_sources(payload, now):
    if payload.get("schemaVersion") != 1 or not isinstance(payload.get("sources"), list):
        raise ValueError("Invalid source health response")
    checked = instant(payload.get("checkedAt"))
    if checked is None or abs((now - checked).total_seconds()) > 300:
        raise ValueError("Source health response is not current")
    seen = set()
    for source in payload["sources"]:
        if not isinstance(source, dict) or not isinstance(source.get("key"), str) or not source["key"]:
            raise ValueError("Source has no key")
        if source["key"] in seen or source["key"] == "__monitor__":
            raise ValueError("Duplicate or reserved source key")
        seen.add(source["key"])
        if source.get("state") not in {"HEALTHY", "ERROR", "SYNCING", "STALE", "UNCONFIGURED"}:
            raise ValueError("Invalid source state")
        if not isinstance(source.get("required"), bool):
            raise ValueError("Invalid required-source flag")
        instant(source.get("lastSyncAt"))
        instant(source.get("freshnessDeadlineAt"))
        if source.get("latestRun") is not None and not isinstance(source["latestRun"], dict):
            raise ValueError("Invalid latest source run")
        if not isinstance(source.get("dashboards", []), list):
            raise ValueError("Invalid source dashboard links")
    if not seen:
        raise ValueError("Source health response is empty")
    return payload["sources"]


def health(source, now):
    if not source["required"]:
        return "UNCONFIGURED"
    if source["state"] == "ERROR":
        return "ERROR"
    deadline = instant(source.get("freshnessDeadlineAt"))
    last_sync = instant(source.get("lastSyncAt"))
    if source["state"] == "STALE" or deadline and deadline <= now:
        return "STALE"
    if not deadline or not last_sync or (last_sync - now).total_seconds() > 300 or source["state"] == "UNCONFIGURED":
        return "UNAVAILABLE"
    return "HEALTHY"


def message(source, status, app_url):
    recovery = status == "HEALTHY"
    run = source.get("latestRun") or {}
    lines = [
        f"Atlas source {'recovered' if recovery else 'needs attention'}: {source.get('label', source['key'])}",
        f"Source: {source['key']} | State: {status}",
        f"Last successful sync: {source.get('lastSyncAt') or 'none'}",
        f"Freshness deadline: {source.get('freshnessDeadlineAt') or 'not configured'}",
        f"Latest run: {run.get('id', 'none')} | {run.get('status', 'unknown')}",
    ]
    if not recovery:
        lines.append(f"Latest error: {source.get('lastError') or 'No source error recorded; check the deadline and collector.'}")
    else:
        lines.append("The current source check passes. This is not a certification change.")
    for number in source.get("dashboards", [])[:10]:
        if isinstance(number, int) and number > 0:
            lines.append(f"Dashboard: {app_url}/dashboards/{number}")
    lines.append("Runbook: https://github.com/synchronicity-labs/atlas/blob/main/ops/rudy/source-reliability/README.md")
    lines.append("Ticket: https://linear.app/sync-labs/issue/OPS-30")
    return "\n".join(lines).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")[:3900]


def transitions(sources, previous, now):
    for source in sources:
        status = health(source, now)
        before = previous.get(source["key"])
        if status == "UNCONFIGURED":
            continue
        if before and before["status"] == status:
            continue
        if status == "HEALTHY" and not before:
            continue
        yield source, status


def save_state(path, state):
    descriptor, temporary = tempfile.mkstemp(prefix=".atlas-state-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(state, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def deliver_transitions(sources, state, now, send, persist):
    delivered = 0
    for source, status in transitions(sources, state, now):
        send(source, status)
        state[source["key"]] = {"status": status, "notifiedAt": now.isoformat()}
        persist(state)
        delivered += 1
    return delivered


def run(dry_run=False, state_dir=Path("/var/lib/rudy-atlas-source-monitor")):
    base = os.environ.get("ATLAS_API_URL", "").rstrip("/")
    app = os.environ.get("ATLAS_APP_URL", "https://atlas.pr.sync.so").rstrip("/")
    token = os.environ.get("ATLAS_QUERY_SECRET", "")
    channel = os.environ.get("ATLAS_ALERT_SLACK_CHANNEL", "")
    slack_token = os.environ.get("SLACK_BOT_TOKEN", "")
    if not base or not token or not dry_run and not (channel and slack_token):
        print(json.dumps({"status": "disabled", "reason": "Missing optional monitor configuration"}))
        return
    origin = urlparse(base)
    if origin.scheme != "https" or not origin.netloc or origin.username or origin.path or origin.query or origin.fragment:
        raise RuntimeError("Atlas monitor requires an HTTPS API origin")
    now = datetime.now(timezone.utc)
    monitor = {"key": "__monitor__", "label": "Atlas source health endpoint", "required": True,
               "state": "HEALTHY", "lastSyncAt": now.isoformat(),
               "freshnessDeadlineAt": datetime.fromtimestamp(now.timestamp() + 300, timezone.utc).isoformat()}
    try:
        sources = validated_sources(request_json(base + "/internal/atlas/sources", token), now)
    except (RuntimeError, ValueError, TypeError):
        sources = []
        monitor.update(state="ERROR", lastError="The authenticated source health endpoint is unavailable or invalid.")
    sources.append(monitor)
    if dry_run:
        print(json.dumps({"dryRun": True, "sources": [{"key": source["key"], "status": health(source, now)} for source in sources]}))
        return
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (state_dir / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = state_dir / "incidents.json"
        state = json.loads(path.read_text()) if path.exists() else {}
        if not isinstance(state, dict) or any(not isinstance(value, dict) or "status" not in value for value in state.values()):
            raise RuntimeError("Incident state is invalid; preserve it for investigation")
        backoff_path = state_dir / "slack-backoff.json"
        backoff = json.loads(backoff_path.read_text()) if backoff_path.exists() else {}
        if backoff.get("until", 0) > time.time():
            print(json.dumps({"status": "delivery_deferred", "reason": "Slack Retry-After is active"}))
            return

        def send(source, status):
            response = request_json("https://slack.com/api/chat.postMessage", slack_token, {
                "channel": channel, "text": message(source, status, app), "mrkdwn": False,
                "parse": "none", "link_names": False, "unfurl_links": False, "unfurl_media": False,
            })
            if response.get("ok") is not True:
                raise RuntimeError("Slack did not accept the source alert")
            time.sleep(1.1)

        try:
            delivered = deliver_transitions(sources, state, now, send, lambda value: save_state(path, value))
        except RateLimited as error:
            save_state(backoff_path, {"until": time.time() + error.retry_after})
            raise
        print(json.dumps({"sourcesChecked": len(sources) - 1, "notificationsSent": delivered}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    options = parser.parse_args()
    run(options.dry_run)
