import copy
import unittest

from rudy_atlas_cron_canary import canonical_readiness_failures


class CanaryReadinessTest(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "question": {"purpose": "CERTIFIED"},
            "freshness": {
                "status": "fresh",
                "checkedAt": "2026-08-28T12:40:00Z",
                "deadlineAt": "2026-08-28T22:40:00Z",
            },
            "result": {"trustStatus": "VERIFIED"},
            "provenance": {"source": {"state": "HEALTHY"}},
        }

    def test_fresh_snapshot_remains_usable_while_source_syncs(self):
        for state in ("HEALTHY", "SYNCING"):
            self.payload["provenance"]["source"]["state"] = state
            self.assertEqual(canonical_readiness_failures({243: self.payload}, {243}), [])

    def test_stale_result_is_a_real_failure_with_its_refresh_deadline(self):
        self.payload["freshness"]["status"] = "stale"
        failure, = canonical_readiness_failures({243: self.payload}, {243})
        self.assertIn("Q243: stale", failure)
        self.assertIn("checked=2026-08-28T12:40:00Z", failure)
        self.assertIn("deadline=2026-08-28T22:40:00Z", failure)

    def test_missing_results_and_failed_verification_still_fail(self):
        for result in (None, {"trustStatus": "FAILED"}, {"trustStatus": "PENDING"}):
            payload = copy.deepcopy(self.payload)
            payload["result"] = result
            self.assertEqual(len(canonical_readiness_failures({243: payload}, {243})), 1)

    def test_source_failure_still_fails_with_a_fresh_snapshot(self):
        self.payload["provenance"]["source"]["state"] = "ERROR"
        self.assertEqual(len(canonical_readiness_failures({243: self.payload}, {243})), 1)


if __name__ == "__main__":
    unittest.main()
