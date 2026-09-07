#!/usr/bin/env python3
"""Daily signup-abuse report from governed Atlas snapshots."""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

sys.path.insert(0, "/usr/local/lib/rudy-atlas-runtime")
from atlas_report_controls import canonical as atlas_canonical
from atlas_report_controls import rows as atlas_rows

SLACK_CHANNEL = os.environ.get("ABUSE_REPORT_SLACK_CHANNEL", "C0ACTQRBFAT")
SLACK_BROKER_SOCKET = "/run/slack-operations/broker.sock"
DETAIL_LIMIT_BYTES = 12_000
DETAIL_LINK = "<https://atlas.pr.sync.so/questions/270|Full enforcement breakdown in Atlas>"


def compact_text(value: Any, limit: int = 160) -> str:
    text = " ".join(str(value or "(none)").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def top_reasons(rows: list[dict[str, Any]], metric: str = "users") -> list[str]:
    ranked = sorted(
        rows,
        key=lambda row: (-n(row_metrics(row).get(metric)), str(row.get("reason") or "")),
    )
    lines = [
        f"  • {compact_text(row.get('reason'))}: {n(row_metrics(row).get(metric)):,}"
        for row in ranked[:5]
    ]
    remaining = ranked[5:]
    if remaining:
        total = sum(n(row_metrics(row).get(metric)) for row in remaining)
        unit = "users" if metric == "users" else "entries"
        lines.append(f"  • Other reasons: {total:,} {unit} across {len(remaining):,} reasons")
    return lines


def bounded_detail(text: str) -> str:
    suffix = "\n\n" + DETAIL_LINK
    if len((text + suffix).encode("utf-8")) <= DETAIL_LIMIT_BYTES:
        return text + suffix
    suffix = "\n\n_Some detail is omitted to keep this report short._" + suffix
    budget = DETAIL_LIMIT_BYTES - len(suffix.encode("utf-8"))
    prefix = text.encode("utf-8")[:budget].decode("utf-8", errors="ignore")
    return prefix.rsplit("\n", 1)[0] + suffix


def post_threaded_report(report_key: str, summary: str, detail: str) -> dict[str, Any]:
    request = {
        "operation": "post_daily_abuse_report",
        "channel_id": SLACK_CHANNEL,
        "report_key": report_key,
        "summary": summary,
        "detail": detail,
    }
    encoded = (json.dumps(request, separators=(",", ":")) + "\n").encode("utf-8")
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(45)
            client.connect(SLACK_BROKER_SOCKET)
            client.sendall(encoded)
            response_file = client.makefile("rb")
            raw = response_file.readline(65_537)
    except OSError as exc:
        raise RuntimeError(f"Slack operations broker is unavailable: {exc}") from None
    if not raw or len(raw) > 65_536:
        raise RuntimeError("Slack operations broker returned an invalid response")
    try:
        response = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError("Slack operations broker returned invalid JSON") from None
    if not isinstance(response, dict) or not response.get("ok"):
        raise RuntimeError(
            f"Slack operations broker failed: {str(response.get('error') if isinstance(response, dict) else response)[:300]}"
        )
    return response


def n(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


@lru_cache(maxsize=None)
def atlas_question(number: int) -> dict[str, Any]:
    return atlas_canonical(number)


def question_rows(number: int) -> list[dict[str, Any]]:
    return atlas_rows(atlas_question(number))


def section_rows(number: int, section: str) -> list[dict[str, Any]]:
    return [row for row in question_rows(number) if row.get("section") == section]


def row_metrics(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("metrics")
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def atlas_abuse_control() -> str:
    block_rate = atlas_question(95)
    reasons = atlas_question(96)
    blocked = atlas_question(98)
    rings = atlas_question(245)
    enforcement = atlas_question(270)
    rate_rows = atlas_rows(block_rate)
    blocked_rows = atlas_rows(blocked)
    rate = float(rate_rows[0].get("block_rate_pct") or 0) if rate_rows else 0
    total = n(blocked_rows[0].get("blocked_attempts")) if blocked_rows else 0
    reason_bits = [
        f"{row.get('reason') or '(blank)'} {n(row.get('blocked_attempts')):,}"
        for row in atlas_rows(reasons)[:5]
    ]
    return (
        "*Atlas governed control (Q95/Q96/Q98/Q245/Q270):*\n"
        f"  • MTD blocked attempts: {total:,}\n"
        f"  • MTD block rate: {rate:.2f}%\n"
        f"  • MTD top reasons: {', '.join(reason_bits) if reason_bits else 'none'}"
    )


def section_signups_blocked() -> tuple[str, int]:
    rows = sorted(
        section_rows(245, "reason"),
        key=lambda row: (-n(row.get("blocked_attempts")), str(row.get("dimension_value") or "")),
    )
    total = sum(n(row.get("blocked_attempts")) for row in rows)
    lines = [f"*Signups blocked (last 1d): {total:,}*"]
    if rows:
        lines.append("Top reasons:")
        for row in rows[:5]:
            lines.append(
                f"  • {compact_text(row.get('dimension_value') or '(blank)')}: "
                f"{n(row.get('blocked_attempts')):,} "
                f"({n(row.get('related_count')):,} domains)"
            )
        if len(rows) > 5:
            other = sum(n(row.get("blocked_attempts")) for row in rows[5:])
            lines.append(f"  • Other reasons: {other:,} blocked signups across {len(rows) - 5:,} reasons")
    else:
        lines.append("  (no signup_blocked events)")
    return "\n".join(lines), total


def section_rings() -> tuple[str, list[str]]:
    domains = section_rows(245, "domain_ring")[:12]
    ips = section_rows(245, "ip_ring")[:8]
    lines = ["*Abuse rings that showed up:*"]
    if domains:
        lines.append("Top domains by blocked signups:")
        for row in domains:
            lines.append(
                f"  • {row.get('dimension_value')}: "
                f"{n(row.get('blocked_attempts')):,} blocks across "
                f"{n(row.get('related_count')):,} IPs"
            )
    if ips:
        lines.append("Top IPs by blocked signups:")
        for row in ips:
            lines.append(
                f"  • {row.get('dimension_value')}: "
                f"{n(row.get('blocked_attempts')):,} blocks across "
                f"{n(row.get('related_count')):,} domains"
            )
    if not domains and not ips:
        lines.append("  (no clustered domain/IP rings ≥5 blocks)")
    return "\n".join(lines), [str(row.get("dimension_value")) for row in domains[:3]]


def section_user_agents() -> str:
    rows = section_rows(245, "bot_user_agent")[:10]
    lines = ["*Bot user-agents flagged:*"]
    if rows:
        for row in rows:
            lines.append(
                f"  • {str(row.get('dimension_value'))[:80]}: "
                f"{n(row.get('blocked_attempts')):,}"
            )
    else:
        lines.append("  (none)")
    return "\n".join(lines)


def section_new_db_entries() -> tuple[str, dict[str, int]]:
    learned = section_rows(270, "new_block")
    learned_counts: dict[str, int] = {}
    for row in learned:
        block_type = str(row.get("dimension_value") or "unknown")
        learned_counts[block_type] = learned_counts.get(block_type, 0) + n(
            row_metrics(row).get("count")
        )
    learned_total = sum(learned_counts.values())
    learned_counts["total"] = learned_total
    lines = [
        "*Newly blocked - auto-learned (last 1d): "
        f"{learned_counts.get('domain', 0):,} domains, "
        f"{learned_counts.get('ip', 0):,} IPs, {learned_total:,} total*"
    ]
    if learned:
        lines.extend(top_reasons(learned, "count"))
        samples = sorted(
            section_rows(270, "recent_block"),
            key=lambda row: n(row_metrics(row).get("rank")),
        )
        if samples:
            lines.append("Most recent:")
            for row in samples[:3]:
                block_type, _, value = str(row.get("dimension_value") or "").partition(":")
                tail = f" - {compact_text(row.get('reason'))}" if row.get("reason") else ""
                lines.append(
                    f"    - [{compact_text(block_type)}] {compact_text(value)}{tail} ({compact_text(row.get('source') or 'unknown')})"
                )
    else:
        lines.append("  (none - guard found no new burners)")
    maintenance = section_rows(270, "maintenance")
    extras = []
    for row in maintenance:
        count = n(row_metrics(row).get("count"))
        source = str(row.get("dimension_value") or "")
        if source == "github_disposable_sync":
            extras.append(f"{count:,} disposable domains from the weekly GitHub sync")
        if source == "baseline_seed":
            extras.append(f"{count:,} from the one-time baseline seed")
    if extras:
        lines.append(f"_Maintenance: {'; '.join(extras)}._")
    return "\n".join(lines), learned_counts


def section_ban_sweep() -> tuple[str, int]:
    rows = section_rows(270, "banned_reason_24h")
    total = sum(n(row_metrics(row).get("users")) for row in rows)
    lines = [f"*Users banned by sweep (last 1d): {total:,}*"]
    if rows:
        lines.append("Top reasons:")
        lines.extend(top_reasons(rows))
    else:
        lines.append("  (none)")
    return "\n".join(lines), total


def section_fresh_ip_rings() -> tuple[str, dict[str, int]]:
    summary_rows = section_rows(270, "summary")
    summary = row_metrics(summary_rows[0]) if summary_rows else {}
    candidates = section_rows(270, "fresh_ring_candidate")
    stats = {
        "candidates": n(summary.get("fresh_ring_candidates")),
        "candidate_accounts": n(summary.get("fresh_ring_candidate_accounts")),
        "active": n(summary.get("fresh_ring_active")),
        "created": n(summary.get("fresh_ring_created_24h")),
    }
    lines = [
        "*Fresh IP-ring prevention:*",
        f"  • current 7d candidates: {stats['candidates']:,} IPs / "
        f"{stats['candidate_accounts']:,} free accounts",
        f"  • persisted prevention verdicts: {stats['active']:,} active; "
        f"{stats['created']:,} created in last 1d",
    ]
    if candidates:
        lines.append("Candidate detail (shadow-safe, no retroactive bans):")
        for row in candidates[:8]:
            values = row_metrics(row)
            lines.append(
                f"  • {row.get('dimension_value')}: "
                f"{n(values.get('signup_count')):,} accounts, "
                f"{n(values.get('distinct_domains')):,} domains, "
                f"{n(values.get('banned_count')):,} already banned, "
                f"{n(values.get('fast_api_key_users')):,} fast-key users, "
                f"{n(values.get('api_generation_users')):,} API-generation users"
            )
    else:
        lines.append("  (no IP meets the fresh-ring threshold)")
    return "\n".join(lines), stats


def section_autoban_7d() -> tuple[str, int]:
    summary_rows = section_rows(270, "summary")
    summary = row_metrics(summary_rows[0]) if summary_rows else {}
    total = n(summary.get("autobans_7d"))
    by_day = sorted(
        section_rows(270, "autoban_day_7d"),
        key=lambda row: str(row.get("dimension_value") or ""),
        reverse=True,
    )
    by_reason = section_rows(270, "autoban_reason_7d")
    lines = [f"*Recent-abuse auto-bans (last 7d): {total:,}*"]
    if by_day:
        lines.append(
            "By day: "
            + "; ".join(
                f"{row.get('dimension_value')}: {n(row_metrics(row).get('users')):,}"
                for row in by_day
            )
        )
    if by_reason:
        lines.append("Top reasons:")
        lines.extend(top_reasons(by_reason))
    if total == 0:
        lines.append("  (none)")
    return "\n".join(lines), total


def section_ban_generation_distribution() -> str:
    rows = section_rows(270, "ban_generation_distribution_24h")
    by_cohort = {str(row.get("dimension_value")): row_metrics(row) for row in rows}
    lines = ["*Generation counts for newly banned users:*"]

    def formatted(label: str, values: dict[str, Any]) -> str:
        return (
            f"  • {label}: {n(values.get('users')):,} users, "
            f"{n(values.get('total_generations')):,} generations "
            f"(avg {values.get('avg_generations', 0)}, "
            f"median {n(values.get('median_generations'))}) - "
            f"0: {n(values.get('users_0')):,}; 1: {n(values.get('users_1')):,}; "
            f"2: {n(values.get('users_2')):,}; 3: {n(values.get('users_3')):,}; "
            f"4-9: {n(values.get('users_4_9')):,}; "
            f"10+: {n(values.get('users_10_plus')):,}"
        )

    if "all" in by_cohort:
        lines.append(formatted("all ban reasons", by_cohort["all"]))
    if "free_ex_chargeback" in by_cohort:
        lines.append(
            formatted(
                "free users, excluding repeat chargebacks",
                by_cohort["free_ex_chargeback"],
            )
        )
    if len(lines) == 1:
        lines.append("  (none)")
    return "\n".join(lines)


def build_report() -> tuple[str, str, str]:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    atlas_detail = atlas_abuse_control()
    blocked_section, total = section_signups_blocked()
    rings_section, top_domains = section_rings()
    ua_section = section_user_agents()
    db_section, db_counts = section_new_db_entries()
    fresh_ring_section, fresh_ring_stats = section_fresh_ip_rings()
    ban_section, ban_count = section_ban_sweep()
    autoban_7d_section, autoban_7d_count = section_autoban_7d()
    ban_gen_section = section_ban_generation_distribution()

    top3 = ", ".join(top_domains) if top_domains else "none ≥5 blocks"
    db_part = (
        f"new blocks: {db_counts.get('domain', 0):,} domains, "
        f"{db_counts.get('ip', 0):,} IPs"
    )
    ban_part = f"{ban_count:,} users banned"
    autoban_part = f"{autoban_7d_count:,} 7d auto-bans"
    fresh_ring_part = (
        f"fresh IP rings: {fresh_ring_stats['candidates']:,} candidates, "
        f"{fresh_ring_stats['active']:,} active"
    )

    summary = (
        f"🛡️ *Daily signup-abuse report* - {today} (24h)\n"
        f"*{total:,}* signups blocked · {ban_part} · {autoban_part} · "
        f"{fresh_ring_part} · top blocked domains: {top3} · {db_part}\n"
        f"_Full breakdown in thread_ 🧵"
    )

    detail = "\n\n".join(
        [
            atlas_detail,
            blocked_section,
            rings_section,
            fresh_ring_section,
            ban_section,
            autoban_7d_section,
            ban_gen_section,
            ua_section,
            db_section,
            "_Blocking is automatic: the signup guard auto-adds burners to the "
            "blocklist DB in real time and the ban sweep acts on them. This is a "
            "report only - no PRs, no manual edits._",
        ]
    )
    return today, summary, bounded_detail(detail)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--post-slack",
        action="store_true",
        help="post the summary and detail thread through the scoped local Slack broker",
    )
    args = parser.parse_args()

    today, summary, detail = build_report()
    if args.post_slack:
        result = post_threaded_report(today, summary, detail)
        status = "already posted" if result.get("already_posted") else "posted"
        print(
            f"daily abuse report {status} for {today}: "
            f"{result.get('top_level_ts')} thread {result.get('thread_reply_ts')}"
        )
    else:
        print(summary + "\n\n===DETAIL===\n\n" + detail)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"daily abuse report failed: {exc}", file=sys.stderr)
        raise
