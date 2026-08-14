import datetime as dt
import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("publish_weekly_metrics.py")
SPEC = importlib.util.spec_from_file_location("publish_weekly_metrics", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def question(number, name, period, data_through, trust, columns, rows, verification="PASSED"):
    return {
        "question": {"number": number, "name": name},
        "result": {
            "reportingPeriod": period,
            "dataThrough": data_through,
            "trustStatus": trust,
            "columns": [{"name": column} for column in columns],
            "rows": rows,
        },
        "freshness": {
            "status": "fresh" if trust == "VERIFIED" else "pending",
            "reason": None if trust == "VERIFIED" else "Metric verification is not complete.",
        },
        "provenance": {
            "metricRun": {
                "verifications": [
                    {
                        "name": "exclude_banned_anonymous_internal",
                        "status": verification,
                        "evidence": {
                            "reason": "The governed eligibility join is incomplete."
                        },
                    }
                ]
            }
        },
    }


class PublishWeeklyMetricsTest(unittest.TestCase):
    def setUp(self):
        self.questions = [
            question(
                15,
                "Monthly professional organizations",
                "2026-07",
                "2026-08-01T00:00:00.000Z",
                "VERIFIED",
                ["period", "value"],
                [["2026-06-01", 496], ["2026-07-01", 527]],
            ),
            question(
                1102,
                "Current product run-rate",
                "2026-08",
                "2026-08-14T08:07:00.000Z",
                "PENDING",
                ["period_start", "product_run_rate"],
                [["2026-08-01", 1098951.0029]],
                "PENDING",
            ),
            question(
                1105,
                "Latest complete-month usage NDR",
                "2026-07",
                "2026-08-01T00:00:00.000Z",
                "PENDING",
                ["period_start", "usage_ndr_pct"],
                [["2026-07-01", 106.486]],
                "PENDING",
            ),
        ]

    def test_builds_linked_update_with_values_and_trust(self):
        now = dt.datetime(2026, 8, 14, 12, 0, tzinfo=dt.timezone.utc)
        body, marker, health = MODULE.build_update(self.questions, now)

        self.assertIn("**527**", body)
        self.assertIn("**$1,098,951 / month**", body)
        self.assertIn("**106.5%**", body)
        self.assertIn("https://atlas.pr.sync.so/questions/15", body)
        self.assertIn("The governed eligibility join is incomplete", body)
        self.assertEqual(marker, "atlas-weekly-metrics:2026-W33")
        self.assertEqual(health, "atRisk")

    def test_all_verified_is_on_track(self):
        for item in self.questions:
            item["result"]["trustStatus"] = "VERIFIED"
            item["freshness"] = {"status": "fresh", "reason": None}
            item["provenance"]["metricRun"]["verifications"][0]["status"] = "PASSED"

        self.assertEqual(MODULE.trust_health(self.questions), "onTrack")

    def test_result_value_uses_latest_row(self):
        self.assertEqual(MODULE.result_value(self.questions[0], "value"), 527)


if __name__ == "__main__":
    unittest.main()
