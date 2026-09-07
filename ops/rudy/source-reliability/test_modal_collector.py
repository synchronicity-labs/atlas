import unittest
from datetime import date, datetime, timezone

from modal_collector import aggregate, windows


class ModalCollectorTest(unittest.TestCase):
    def test_first_day_skips_the_empty_current_window(self):
        self.assertEqual(windows(date(2026, 9, 1)), [(date(2026, 8, 1), date(2026, 9, 1))])

    def test_year_rollover_and_previous_complete_days(self):
        self.assertEqual(windows(date(2027, 1, 2)), [(date(2026, 12, 1), date(2027, 1, 1)), (date(2027, 1, 1), date(2027, 1, 2))])

    def test_aggregates_without_raw_function_names_or_identifiers(self):
        payload = aggregate([(date(2026, 9, 1), date(2026, 9, 7), [
            {"interval_start": "2026-09-02T00:00:00Z", "object_id": "sync-v3.0.0-modal-prod-private", "cost": 1.25},
            {"Interval Start": "2026-09-03", "Description": "sync-v3.0.0-modal-prod", "Cost": 0},
        ])], datetime(2026, 9, 7, tzinfo=timezone.utc))
        self.assertEqual(payload["rows"], [{"month": "2026-09", "model": "sync-3", "costUsd": 1.25}])

    def test_empty_missing_invalid_or_out_of_window_data_is_not_zero(self):
        for entries in [[], [{}], [{"interval_start": "2026-08-01", "cost": 1}],
                        [{"interval_start": "2026-09-01", "cost": "nan"}],
                        [{"interval_start": "2026-09-01", "cost": -1}]]:
            with self.assertRaises(ValueError):
                aggregate([(date(2026, 9, 1), date(2026, 9, 7), entries)], datetime(2026, 9, 7, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
