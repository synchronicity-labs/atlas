import unittest
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from atlas_http import RateLimited
from atlas_source_monitor import deliver_transitions, health, message, run, save_state, transitions, validated_sources


NOW = datetime(2026, 9, 7, 12, tzinfo=timezone.utc)


def source(**changes):
    return {"key": "product", "label": "Product", "state": "HEALTHY", "required": True,
            "lastSyncAt": (NOW - timedelta(hours=1)).isoformat(),
            "freshnessDeadlineAt": (NOW + timedelta(hours=1)).isoformat(), **changes}


class SourceMonitorTest(unittest.TestCase):
    def test_deadline_is_independent_of_stored_state_and_running_ingestion(self):
        self.assertEqual(health(source(freshnessDeadlineAt=NOW.isoformat()), NOW), "STALE")
        self.assertEqual(health(source(state="SYNCING"), NOW), "HEALTHY")
        self.assertEqual(health(source(state="ERROR"), NOW), "ERROR")
        self.assertEqual(health(source(lastSyncAt=None), NOW), "UNAVAILABLE")
        self.assertEqual(health(source(freshnessDeadlineAt=None), NOW), "UNAVAILABLE")
        self.assertEqual(health(source(lastSyncAt=(NOW + timedelta(minutes=6)).isoformat()), NOW), "UNAVAILABLE")
        self.assertEqual(health(source(required=False, state="UNCONFIGURED"), NOW), "UNCONFIGURED")

    def test_one_alert_per_state_and_one_recovery(self):
        state, sent, saved = {}, [], []
        send = lambda row, status: sent.append(status)
        persist = lambda value: saved.append(dict(value))
        for status in ["ERROR", "ERROR", "STALE", "STALE", "HEALTHY", "HEALTHY"]:
            deliver_transitions([source(state=status)], state, NOW, send, persist)
        self.assertEqual(sent, ["ERROR", "STALE", "HEALTHY"])
        self.assertEqual(len(saved), 3)

    def test_failed_delivery_remains_retryable(self):
        state = {}
        def fail(row, status):
            raise RuntimeError("Slack unavailable")
        with self.assertRaises(RuntimeError):
            deliver_transitions([source(state="ERROR")], state, NOW, fail, lambda value: None)
        self.assertEqual(state, {})
        self.assertEqual(len(list(transitions([source(state="ERROR")], state, NOW))), 1)

    def test_retry_start_is_not_recovery_and_a_failed_retry_does_not_flap(self):
        state, sent = {}, []
        send = lambda row, status: sent.append(status)
        for row in [
            source(state="ERROR"),
            source(state="SYNCING", latestRun={"status": "RUNNING"}),
            source(latestRun={"status": "RUNNING"}),
            source(state="ERROR", latestRun={"status": "COMPLETED"}),
            source(latestRun={"status": "COMPLETED"}),
            source(latestRun={"status": "COMPLETED"}),
        ]:
            deliver_transitions([row], state, NOW, send, lambda value: None)
        self.assertEqual(sent, ["ERROR", "HEALTHY"])

    def test_running_retry_does_not_hide_expired_deadline(self):
        pending = source(state="SYNCING", freshnessDeadlineAt=NOW.isoformat(), latestRun={"status": "RUNNING"})
        self.assertEqual(list(transitions([pending], {"product": {"status": "ERROR"}}, NOW))[0][1], "STALE")

    def test_missing_sources_do_not_produce_false_recovery(self):
        self.assertEqual(list(transitions([], {"product": {"status": "ERROR"}}, NOW)), [])

    def test_unconfiguration_closes_the_incident_without_a_recovery(self):
        state, sent, saved = {}, [], []
        send = lambda row, status: sent.append(status)
        persist = lambda value: saved.append(json.loads(json.dumps(value)))
        deliver_transitions([source(state="ERROR")], state, NOW, send, persist)
        deliver_transitions([source(required=False)], state, NOW, send, persist, delivery_allowed=False)
        self.assertEqual(saved[-1]["product"]["status"], "UNCONFIGURED")
        restored = saved[-1]
        deliver_transitions([source()], restored, NOW, send, persist)
        self.assertEqual(sent, ["ERROR"])
        deliver_transitions([source(state="ERROR")], restored, NOW, send, persist)
        deliver_transitions([source(state="ERROR")], restored, NOW, send, persist)
        self.assertEqual(sent, ["ERROR", "ERROR"])

    def test_first_or_repeated_unconfigured_checks_do_not_write_state(self):
        saved = []
        persist = lambda value: saved.append(value)
        deliver_transitions([source(required=False)], {}, NOW, None, persist)
        deliver_transitions([source(required=False)], {"product": {"status": "UNCONFIGURED"}}, NOW, None, persist)
        self.assertEqual(saved, [])

    def test_malformed_stale_duplicate_or_empty_response_is_rejected(self):
        for rows in [[], [source(), source()], [{"key": "product"}], [source(lastSyncAt=42)], [source(latestRun="invalid")], [source(dashboards="invalid")]]:
            with self.assertRaises(ValueError):
                validated_sources({"schemaVersion": 1, "checkedAt": NOW.isoformat(), "sources": rows}, NOW)
        with self.assertRaises(ValueError):
            validated_sources({"schemaVersion": 1, "checkedAt": (NOW - timedelta(minutes=6)).isoformat(), "sources": [source()]}, NOW)
        self.assertEqual(len(validated_sources({"schemaVersion": 1, "checkedAt": NOW.isoformat(), "sources": [source()]}, NOW)), 1)

    def test_message_contains_operator_evidence_without_active_mentions(self):
        text = message(source(label="<@all>", dashboards=[4], lastError="Endpoint unavailable", latestRun={"id": "run-1", "status": "FAILED"}), "ERROR", "https://atlas.pr.sync.so")
        for value in ["Atlas refresh failed", "Endpoint unavailable", "Freshness deadline:", "/dashboards/4", "Troubleshooting:"]:
            self.assertIn(value, text)
        self.assertNotIn("<@all>", text)
        self.assertNotIn("run-1", text)

    def test_recovery_is_three_lines_with_one_dashboard_and_readable_utc_time(self):
        text = message(source(label="GA4, Search Console, and PostHog", dashboards=[3, 15, 18], lastSyncAt="2026-09-12T11:46:08.079+02:00"), "HEALTHY", "https://atlas.pr.sync.so")
        self.assertEqual(text.splitlines(), [
            "✅ Atlas recovered — GA4, Search Console, and PostHog",
            "Last sync: 12 Sep 09:46 UTC",
            "Dashboard: https://atlas.pr.sync.so/dashboards/3",
        ])

    def test_missing_timestamp_and_dashboard_keep_a_useful_fallback(self):
        text = message(source(lastSyncAt=None, freshnessDeadlineAt=None), "UNAVAILABLE", "https://atlas.pr.sync.so")
        self.assertIn("Last sync: unknown", text)
        self.assertIn("Freshness deadline: unknown", text)
        self.assertIn("Troubleshooting:", text)
        self.assertIn("Troubleshooting:", message(source(), "HEALTHY", "https://atlas.pr.sync.so"))

    def test_state_is_atomic_and_private(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            save_state(path, {"product": {"status": "ERROR"}})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertIn("ERROR", path.read_text())

    def test_slack_backoff_survives_the_next_timer_run(self):
        payload = {"schemaVersion": 1, "checkedAt": datetime.now(timezone.utc).isoformat(), "sources": [source(state="ERROR")]}
        env = {"ATLAS_API_URL": "https://atlas.invalid", "ATLAS_QUERY_SECRET": "read", "ATLAS_ALERT_SLACK_CHANNEL": "C123", "SLACK_BOT_TOKEN": "slack"}
        with TemporaryDirectory() as directory, patch.dict("os.environ", env), patch("atlas_source_monitor.request_json", side_effect=[payload, RateLimited(900), payload]) as request:
            with self.assertRaises(RateLimited):
                run(state_dir=Path(directory))
            self.assertFalse((Path(directory) / "incidents.json").exists())
            self.assertIn("until", json.loads((Path(directory) / "slack-backoff.json").read_text()))
            run(state_dir=Path(directory))
            self.assertEqual(request.call_count, 3)

    def test_dry_run_reads_sources_without_state_or_slack_writes(self):
        payload = {"schemaVersion": 1, "checkedAt": datetime.now(timezone.utc).isoformat(), "sources": [source(state="ERROR")]}
        with TemporaryDirectory() as directory, patch.dict("os.environ", {"ATLAS_API_URL": "https://atlas.invalid", "ATLAS_QUERY_SECRET": "read"}), patch("atlas_source_monitor.request_json", return_value=payload) as request:
            run(dry_run=True, state_dir=Path(directory))
            self.assertEqual(request.call_count, 1)
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
