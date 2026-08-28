import importlib.util
import json
import os
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class DoctorAlertsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = os.environ.get("RUDY_DOCTOR_SOURCE")
        if not path:
            raise unittest.SkipTest("Set RUDY_DOCTOR_SOURCE to the patched host Doctor")
        spec = importlib.util.spec_from_file_location("doctor_under_test", path)
        cls.doctor = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.doctor)

    def setUp(self):
        self.doctor.results.clear()

    def routing_results(self, journal, last_direct=None):
        config = {
            "model": {"provider": "openai-codex", "default": "gpt-5.6-sol"},
            "fallback_providers": [{"base_url": "https://api.openai.com/v1", "model": "gpt-5.6-sol"}],
        }

        def run(cmd, **kwargs):
            output = journal if cmd[0] == "journalctl" else "logged in"
            return subprocess.CompletedProcess(cmd, 0, output, "")

        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.object(self.doctor, "HERMES_HOME", directory),
                patch.object(self.doctor, "OPT", directory),
                patch.object(self.doctor.Path, "read_text", return_value="test fixture"),
                patch.object(self.doctor, "service_user_can", return_value=True),
                patch.object(self.doctor, "run", side_effect=run),
                patch.dict("sys.modules", {"yaml": types.SimpleNamespace(safe_load=lambda text: config)}),
                patch.object(self.doctor.sqlite3, "connect") as connect,
            ):
                connect.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = (last_direct,)
                self.doctor.check_inference_routing()
        return {name: (status, detail) for _, name, status, detail in self.doctor.results}

    def test_fallback_usage_is_a_notice_not_a_failure(self):
        results = self.routing_results("Error classified: reason=overloaded\nFallback activated: custom/gpt-5.6-sol")
        status, detail = results["paid OpenAI fallback used recently"]
        self.assertEqual(status, "WARN")
        self.assertIn("last reason=overloaded", detail)
        self.assertFalse(any(status == "FAIL" for status, _ in results.values()))

    def test_recent_direct_api_usage_is_still_visible(self):
        results = self.routing_results("", self.doctor.time.time() - 30)
        self.assertEqual(results["paid OpenAI fallback used recently"][0], "WARN")

    def test_auth_and_subscription_failures_still_fail(self):
        results = self.routing_results("Primary provider auth failed\nPrimary provider rate-limited (429): limit reached\nFallback activated: custom/gpt-5.6-sol")
        self.assertEqual(results["recent Codex OAuth failure"][0], "FAIL")
        self.assertEqual(results["recent Codex subscription limit"][0], "FAIL")

    def test_quiet_window_does_not_claim_a_primary_health_test(self):
        results = self.routing_results("", self.doctor.time.time() - 601)
        status, detail = results["paid OpenAI fallback used recently"]
        self.assertEqual(status, "OK")
        self.assertIn("not a primary-route health test", detail)

    def test_notice_is_deduplicated_and_expires_without_a_recovery_post(self):
        rows = [("routing", "paid OpenAI fallback used recently", "WARN", "one activation")]
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.object(self.doctor, "ALERT_STATE", str(Path(directory) / "state.json")),
                patch.object(self.doctor, "alert_slack", return_value=True) as post,
                patch.object(self.doctor, "alert_slack_recovery", return_value=True) as recovery,
            ):
                self.doctor.handle_alerts(rows, "routing-notices", notice=True)
                self.doctor.handle_alerts(rows, "routing-notices", notice=True)
                post.assert_called_once_with(rows, notice=True)
                self.doctor.handle_alerts([], "routing-notices", notice=True)
                recovery.assert_not_called()
                self.assertEqual(self.doctor._read_alert_state("routing-notices")["fingerprint"], "")

    def test_real_failure_and_recovery_are_not_hidden_by_notices(self):
        failure = [("routing", "Codex OAuth login", "FAIL", "login required")]
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.object(self.doctor, "ALERT_STATE", str(Path(directory) / "state.json")),
                patch.object(self.doctor, "alert_slack", return_value=True) as post,
                patch.object(self.doctor, "alert_slack_recovery", return_value=True) as recovery,
            ):
                self.doctor.handle_alerts(failure, "routing")
                self.doctor.handle_alerts([], "routing-notices", notice=True)
                self.doctor.handle_alerts([], "routing")
                post.assert_called_once_with(failure, notice=False)
                recovery.assert_called_once_with(["[routing] Codex OAuth login"])

    def test_legacy_fallback_alert_is_retired_without_false_recovery(self):
        with (
            patch.object(self.doctor, "_read_alert_state", return_value={"fingerprint": "old", "names": ["[routing] paid OpenAI fallback active"]}),
            patch.object(self.doctor, "_write_alert_state") as write,
            patch.object(self.doctor, "alert_slack_recovery") as recovery,
        ):
            self.doctor.handle_alerts([], "routing")
            write.assert_called_once_with("", [], "routing")
            recovery.assert_not_called()

    def test_atlas_readiness_failure_is_not_labelled_as_credentials(self):
        with patch.object(self.doctor, "PROBES", {"atlas_cron_migration": lambda: ("FAIL", "Q243 stale")}):
            self.doctor.check_creds()
        self.assertEqual(self.doctor.results, [("atlas", "report readiness", "FAIL", "Q243 stale")])

    def test_atlas_error_keeps_the_start_and_first_question(self):
        error = "Atlas report readiness: Q243 stale; " + "Q234 stale; " * 200
        result = subprocess.CompletedProcess([], 1, json.dumps({"ok": False, "error": error}), "")
        with patch.object(self.doctor, "run", return_value=result):
            status, detail = self.doctor.probe_atlas_cron_migration()
        self.assertEqual(status, "FAIL")
        self.assertTrue(detail.startswith("Atlas report readiness: Q243 stale"))
        self.assertIn("see canary output", detail)


if __name__ == "__main__":
    unittest.main()
