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


def pending_state():
    return {"product": {"status": "PENDING", "pendingError": {
        "since": (NOW - timedelta(minutes=30)).isoformat(),
    }}}


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
        state, sent, saved = pending_state(), [], []
        send = lambda row, status: sent.append(status)
        persist = lambda value: saved.append(dict(value))
        for status in ["ERROR", "ERROR", "STALE", "STALE", "HEALTHY", "HEALTHY"]:
            deliver_transitions([source(state=status)], state, NOW, send, persist)
        self.assertEqual(sent, ["ERROR", "STALE", "HEALTHY"])
        self.assertEqual(len(saved), 3)

    def test_failed_delivery_remains_retryable(self):
        state = pending_state()
        original = json.loads(json.dumps(state))
        def fail(row, status):
            raise RuntimeError("Slack unavailable")
        with self.assertRaises(RuntimeError):
            deliver_transitions([source(state="ERROR")], state, NOW, fail, lambda value: None)
        self.assertEqual(state, original)
        self.assertEqual(len(list(transitions([source(state="ERROR")], state, NOW))), 1)

    def test_retry_start_is_not_recovery_and_a_failed_retry_does_not_flap(self):
        state, sent = pending_state(), []
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
        state, sent, saved = pending_state(), [], []
        send = lambda row, status: sent.append(status)
        persist = lambda value: saved.append(json.loads(json.dumps(value)))
        deliver_transitions([source(state="ERROR")], state, NOW, send, persist)
        deliver_transitions([source(required=False)], state, NOW, send, persist, delivery_allowed=False)
        self.assertEqual(saved[-1]["product"]["status"], "UNCONFIGURED")
        restored = saved[-1]
        deliver_transitions([source()], restored, NOW, send, persist)
        self.assertEqual(sent, ["ERROR"])
        deliver_transitions([source(state="ERROR")], restored, NOW, send, persist)
        deliver_transitions([source(state="ERROR")], restored, NOW + timedelta(minutes=30), send, persist)
        self.assertEqual(sent, ["ERROR", "ERROR"])

    def test_transient_error_and_success_never_alert_or_recover(self):
        for initial in [{}, {"product": {"status": "HEALTHY", "notifiedAt": NOW.isoformat()}}]:
            state, sent = initial, []
            send = lambda row, status: sent.append(status)
            deliver_transitions([source(state="ERROR")], state, NOW, send, lambda value: None)
            self.assertEqual(health(source(state="ERROR"), NOW), "ERROR")
            self.assertIn("pendingError", state["product"])
            deliver_transitions([source()], state, NOW + timedelta(minutes=15), send, lambda value: None)
            self.assertEqual(sent, [])
            self.assertNotIn("pendingError", state.get("product", {}))

    def test_persistent_error_survives_restart_then_recovers_once(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "incidents.json"
            state, sent = {}, []
            send = lambda row, status: sent.append(status)
            persist = lambda value: save_state(path, value)
            deliver_transitions([source(state="ERROR")], state, NOW, send, persist)
            state = json.loads(path.read_text())
            for minutes in [29, 30, 35]:
                deliver_transitions([source(state="ERROR")], state, NOW + timedelta(minutes=minutes), send, persist)
                self.assertEqual(sent, [] if minutes == 29 else ["ERROR"])
            for minutes in [40, 45]:
                deliver_transitions([source()], state, NOW + timedelta(minutes=minutes), send, persist)
            self.assertEqual(sent, ["ERROR", "HEALTHY"])

    def test_pending_retry_does_not_reset_failure_streak(self):
        state, sent = {}, []
        send = lambda row, status: sent.append(status)
        for minutes, row in [
            (0, source(state="ERROR")),
            (15, source(state="SYNCING", latestRun={"status": "RUNNING"})),
            (20, source(latestRun={"status": "RUNNING"})),
            (30, source(state="ERROR")),
        ]:
            deliver_transitions([row], state, NOW + timedelta(minutes=minutes), send, lambda value: None)
        self.assertEqual(sent, ["ERROR"])

    def test_failed_refresh_timestamps_cannot_postpone_the_alert(self):
        state, sent = {}, []
        send = lambda row, status: sent.append(status)
        for minutes, status in [(0, "ERROR"), (10, "ERROR"), (15, "SYNCING"), (20, "ERROR"), (30, "ERROR"), (45, "ERROR")]:
            observed = NOW + timedelta(minutes=minutes)
            row = source(state=status, lastSyncAt=observed.isoformat(),
                         freshnessDeadlineAt=(observed + timedelta(hours=8)).isoformat(),
                         latestRun={"status": "RUNNING" if status == "SYNCING" else "FAILED"})
            deliver_transitions([row], state, observed, send, lambda value: None)
            self.assertEqual(sent, ["ERROR"] if minutes >= 30 else [])

    def test_completed_healthy_observation_restarts_failure_grace(self):
        state, sent = {}, []
        send = lambda row, status: sent.append(status)
        for minutes, status in [(0, "ERROR"), (15, "HEALTHY"), (20, "ERROR"), (30, "ERROR"), (50, "ERROR")]:
            row = source(state=status, latestRun={"status": "COMPLETED" if status == "HEALTHY" else "FAILED"})
            deliver_transitions([row], state, NOW + timedelta(minutes=minutes), send, lambda value: None)
            self.assertEqual(sent, ["ERROR"] if minutes == 50 else [])

    def test_missing_or_stale_data_and_monitor_outage_alert_immediately(self):
        for row, expected in [
            (source(state="ERROR", freshnessDeadlineAt=NOW.isoformat()), "STALE"),
            (source(state="ERROR", lastSyncAt=None), "UNAVAILABLE"),
            (source(state="ERROR", freshnessDeadlineAt=None), "UNAVAILABLE"),
            (source(key="__monitor__", state="ERROR"), "ERROR"),
        ]:
            sent = []
            deliver_transitions([row], {}, NOW, lambda row, status: sent.append(status), lambda value: None)
            self.assertEqual(sent, [expected])

    def test_legacy_incident_stays_open_during_retry_and_recovers_once(self):
        state = {"product": {"status": "ERROR", "notifiedAt": NOW.isoformat()}}
        sent = []
        for row in [source(state="ERROR"), source(state="SYNCING"), source(), source()]:
            deliver_transitions([row], state, NOW, lambda row, status: sent.append(status), lambda value: None)
        self.assertEqual(sent, ["HEALTHY"])

    def test_pending_observations_are_persisted_during_slack_backoff(self):
        state, saved, sent = {}, [], []
        send = lambda row, status: sent.append(status)
        persist = lambda value: saved.append(json.loads(json.dumps(value)))
        deliver_transitions([source(state="ERROR")], state, NOW, send, persist, delivery_allowed=False)
        self.assertEqual(saved[-1]["product"]["pendingError"]["since"], NOW.isoformat())
        deliver_transitions([source()], state, NOW + timedelta(minutes=15), send, persist, delivery_allowed=False)
        self.assertEqual(saved[-1], {})
        deliver_transitions([source()], state, NOW + timedelta(minutes=20), send, persist)
        self.assertEqual(sent, [])

    def test_first_or_repeated_unconfigured_checks_do_not_write_state(self):
        saved = []
        persist = lambda value: saved.append(value)
        deliver_transitions([source(required=False)], {}, NOW, None, persist)
        deliver_transitions([source(required=False)], {"product": {"status": "UNCONFIGURED"}}, NOW, None, persist)
        self.assertEqual(saved, [])

    def test_disabling_a_reenabled_pending_source_clears_the_old_streak(self):
        state = {"product": {"status": "UNCONFIGURED"}}
        sent = []
        send = lambda row, status: sent.append(status)
        for minutes, row in [(0, source(state="ERROR")), (15, source(required=False)), (30, source(state="ERROR"))]:
            deliver_transitions([row], state, NOW + timedelta(minutes=minutes), send, lambda value: None)
        self.assertEqual(sent, [])
        self.assertEqual(state["product"]["pendingError"]["since"], (NOW + timedelta(minutes=30)).isoformat())

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
