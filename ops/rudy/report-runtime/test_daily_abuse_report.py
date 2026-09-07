import unittest
from unittest.mock import patch

import daily_abuse_report as report


class AbuseReportTest(unittest.TestCase):
    def test_signup_reasons_keep_an_explicit_remainder(self):
        rows = [
            {"dimension_value": f"reason {i}", "blocked_attempts": i + 1, "related_count": 1}
            for i in range(20)
        ]
        with patch.object(report, "section_rows", return_value=rows):
            text, total = report.section_signups_blocked()
        self.assertEqual(total, 210)
        self.assertIn("reason 19: 20", text)
        self.assertIn("120 blocked signups across 15 reasons", text)
        self.assertEqual(len(text.splitlines()), 8)

    def test_top_reasons_keep_totals_and_sort_by_count(self):
        rows = [
            {"reason": f"reason {i}", "metrics": {"users": i + 1}}
            for i in range(800)
        ]
        with patch.object(report, "section_rows", return_value=rows):
            text, total = report.section_ban_sweep()
        self.assertEqual(total, sum(range(1, 801)))
        self.assertLess(len(text.encode()), 1000)
        self.assertIn("reason 799: 800", text)
        self.assertIn("316,410 users across 795 reasons", text)
        self.assertLess(text.index("reason 799"), text.index("reason 798"))

    def test_reason_text_is_single_line_and_short(self):
        text = report.top_reasons([
            {"reason": "long\n" + "🎉" * 10000, "metrics": '{"users": 42}'}
        ])[0]
        self.assertNotIn("\n", text)
        self.assertLess(len(text.encode()), 700)
        self.assertTrue(text.endswith("42"))

    def test_full_report_stays_bounded_for_multibyte_text(self):
        for text in ["small", "🎉" * 40000, ("long " + "🎉" * 100 + "\n") * 800]:
            detail = report.bounded_detail(text)
            self.assertLessEqual(len(detail.encode()), report.DETAIL_LIMIT_BYTES)
            self.assertTrue(detail.endswith(report.DETAIL_LINK))
        self.assertIn("omitted", report.bounded_detail("🎉" * 40000))

    def test_empty_report_and_small_reason_sets_are_not_marked_omitted(self):
        with patch.object(report, "section_rows", return_value=[]):
            text, count = report.section_ban_sweep()
        self.assertEqual(count, 0)
        self.assertIn("(none)", text)
        self.assertNotIn("omitted", report.bounded_detail(text))
        self.assertNotIn("Other reasons", "\n".join(report.top_reasons([
            {"reason": "example", "metrics": {"users": 3}}
        ])))


if __name__ == "__main__":
    unittest.main()
