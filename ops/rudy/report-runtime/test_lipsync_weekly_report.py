import unittest

from lipsync_weekly_report import verified_rows


class LipsyncWeeklyReportTest(unittest.TestCase):
    def test_keeps_a_fresh_verified_result_after_the_latest_refresh_fails(self):
        payload = {
            "question": {"number": 236, "purpose": "CERTIFIED"},
            "freshness": {"status": "fresh"},
            "result": {
                "trustStatus": "VERIFIED",
                "columns": [{"name": "week_start"}],
                "rows": [["2026-08-17"], ["2026-08-24"]],
            },
            "provenance": {"source": {"state": "ERROR"}},
        }

        self.assertEqual(len(verified_rows(payload)), 2)


if __name__ == "__main__":
    unittest.main()
