import argparse
import copy
import datetime as dt
import json
import os
from pathlib import Path


DELIVERIES = {
    "c4d0695ffc3f": "slack:C0ACTQRBFAT",
    "6d5d35907a5b": "slack:C0ACTQRBFAT",
    "b1ff759d416d": "slack:C0ACTQRBFAT",
    "fc9db0707898": "slack:C0AD87S7YN6",
    "8f666de9e464": "slack:C0AD87S7YN6",
}

DELIVERY_RULE = (
    "\n\nGATEWAY-OWNED DELIVERY: Return one final report. Do not call send tools "
    "or use Slack credentials. Do not record a delivered status before gateway confirmation. "
    "The gateway owns the configured destination. Use short reporting-period labels and "
    "Atlas question links; keep trust, metric version, and dataThrough in local evidence, "
    "not a long reader-facing status footer."
)


def replace_required(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError("Live cron prompt changed; review it before applying this migration")
    return text.replace(old, new)


def updates_for(jobs, question):
    if not isinstance(question, int) or question < 1 or question in {28, 31, 40, 236}:
        raise ValueError("The dedicated Lipsync traffic question number is required")
    updates = {}
    for job_id, destination in DELIVERIES.items():
        job = jobs[job_id]
        if not job.get("enabled") or job.get("run_claim"):
            raise RuntimeError(f"Report {job_id} is disabled or has a running claim")
        updates[job_id] = {"prompt": job["prompt"], "deliver": destination}
    adobe = updates["c4d0695ffc3f"]
    adobe["prompt"] = replace_required(
        adobe["prompt"],
        "Post with message action=send, channel=slack, target=C0ACTQRBFAT.",
        "",
    )
    adobe["prompt"] = replace_required(
        adobe["prompt"],
        "If Q235 is unavailable or not VERIFIED and fresh, use only the approved scoped readers as a clearly labeled fallback. Cite Q235 as the Atlas coverage gap.",
        "Require CERTIFIED, VERIFIED, and fresh. A failed latest refresh does not invalidate a verified answer before its freshness deadline. If Q235 fails a check, omit metrics and report the Atlas blocker. Do not use a raw fallback.",
    )
    for job_id in ("6d5d35907a5b", "b1ff759d416d"):
        updates[job_id]["prompt"] = replace_required(
            updates[job_id]["prompt"],
            "Use message action=send, channel=slack, target=C0ACTQRBFAT. Post once. Do not post a thread reply.",
            "",
        )
    updates["fc9db0707898"]["prompt"] = f"""ATLAS-FIRST CANONICAL

Canonical Lipsync traffic question: Q{question}
Read Q{question}, named Lipsync weekly traffic and search, source key cron:lipsync:weekly-traffic.
Require CERTIFIED, VERIFIED, and fresh. A failed latest refresh does not invalidate a verified answer before its freshness deadline.
Use the lipsync-com-weekly-traffic-report and atlas-company-intelligence skills.

Produce the weekly lipsync.com traffic report for C0AD87S7YN6.
Use the two complete weeks per source in Q{question}. GA4 property 525331485 and
Search Console sc-domain:lipsync.com are the only headline sources. Show each source's
actual dates and time zone. Search can lag GA4 because only finalized days are used.
Show previous -> current sessions, users, new users, engaged sessions, engagement rate,
average session duration, search clicks, impressions, CTR, and average position.
Use percentage-point changes for rates and relative changes for counts.
Q28 and Q40 are other sites, not Lipsync. Q31 is not a weekly site total.
Keep Q236 product-user conversions separate; never divide those by sessions or clicks.

The approved scoped rudy-lipsync-traffic-data reader may supply top pages, traffic sources,
queries, and countries as explicitly dated detail only. Do not replace Atlas headlines.
Keep optional charts local. Do not write slack_ts or a fabricated delivery marker.
If Q{question} fails a check, report the Atlas blocker instead of raw headline metrics."""
    updates["8f666de9e464"]["prompt"] = """ATLAS-FIRST CANONICAL

Use atlas-company-intelligence and lipsync-weekly-funnel-report.
Q236 is the only governed Lipsync-attributed product-user funnel source.
Require CERTIFIED, VERIFIED, and fresh. A failed latest refresh does not invalidate a verified answer before its freshness deadline.
Run exactly: sudo -n /usr/local/sbin/rudy-hermes-cron-run lipsync-weekly-report
Parse the JSON and keep its message text unchanged.
Append MEDIA: /root/.hermes/cache/documents/outbound/lipsync_weekly_funnel.png
only when that staged file is readable. Return the report to the gateway for C0AD87S7YN6.
Website sessions and search clicks are separate populations, not funnel denominators.
Never read raw PostHog or platform credentials. On failure, return a short internal blocker,
not raw stderr or replacement metrics."""
    exit_prompt = jobs["165f3db78c17"]["prompt"]
    fallback = "If Q239 is unavailable, stale, failed, or not VERIFIED,"
    if fallback not in exit_prompt:
        raise RuntimeError("Exit survey fallback changed; review before applying")
    updates["165f3db78c17"] = {
        "prompt": exit_prompt.partition(fallback)[0]
        + "Require CERTIFIED, VERIFIED, and fresh. A failed latest refresh does not invalidate a verified answer before its freshness deadline. If Q239 fails, "
        "omit metrics and report the Atlas blocker. Do not use a raw fallback. "
        "Stage the chart under /root/.hermes/cache/documents/outbound with readable permissions. "
        "Use a MEDIA: absolute path, never a sandbox: link. Keep the existing configured destination."
    }
    for update in updates.values():
        update["prompt"] = update["prompt"].strip() + DELIVERY_RULE
    return updates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--traffic-question", type=int, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    from cron.jobs import _jobs_lock, load_jobs, _save_jobs_unlocked

    with _jobs_lock():
        jobs = load_jobs()
        by_id = {job["id"]: job for job in jobs}
        before = copy.deepcopy(jobs)
        updates = updates_for(by_id, args.traffic_question)
        for job_id, update in updates.items():
            by_id[job_id].update(update)
        if args.apply:
            home = Path(os.environ["HERMES_HOME"])
            stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup = home / "cron" / f"jobs.before-final-atlas-{stamp}.json"
            fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as handle:
                json.dump({"jobs": before}, handle)
            _save_jobs_unlocked(jobs)
    print(json.dumps({"applied": args.apply, "jobs": sorted(updates), "changedFields": ["prompt", "deliver"], "schedulesAndModelsPreserved": True}))


if __name__ == "__main__":
    main()
