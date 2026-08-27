import copy
import unittest
from unittest.mock import patch

import atlas_report_controls as controls


class ReportControlsTest(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "question": {"purpose": "CERTIFIED"},
            "freshness": {"status": "fresh"},
            "result": {"trustStatus": "VERIFIED"},
            "provenance": {"source": {"state": "HEALTHY"}},
        }

    def test_accepts_canonical(self):
        with patch.object(controls, "question", return_value=self.payload):
            self.assertEqual(controls.canonical(237), self.payload)

    def test_refuses_degraded_or_uncertified_results(self):
        for path, bad in [
            (("question", "purpose"), "RECONCILIATION"),
            (("freshness", "status"), "stale"),
            (("result", "trustStatus"), "PENDING"),
            (("result", "trustStatus"), "FAILED"),
            (("provenance", "source", "state"), "ERROR"),
        ]:
            payload = copy.deepcopy(self.payload)
            target = payload
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = bad
            with self.subTest(path=path, state=bad):
                with patch.object(controls, "question", return_value=payload):
                    with self.assertRaises(RuntimeError):
                        controls.canonical(237)

    def test_rejects_truncated_rows(self):
        with self.assertRaises(ValueError):
            controls.rows({"result": {"columns": [{"name": "a"}, {"name": "b"}], "rows": [[1]]}})


if __name__ == "__main__":
    unittest.main()
