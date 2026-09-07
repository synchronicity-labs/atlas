import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

from modal_collector import aggregate, run, windows


class ModalCollectorTest(unittest.TestCase):
    def test_invalid_origin_is_rejected_before_collection_or_credential_delivery(self):
        for base in ["https://user@atlas.invalid", "https://atlas.invalid/path", "https://atlas.invalid?q=1", "https://atlas.invalid#part"]:
            with patch.dict("os.environ", {"ATLAS_API_URL": base, "ATLAS_MODAL_INGEST_SECRET": "secret"}), patch("modal_collector.collect") as collect, patch("modal_collector.request_json") as request:
                with self.assertRaises(RuntimeError):
                    run()
                collect.assert_not_called()
                request.assert_not_called()

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
