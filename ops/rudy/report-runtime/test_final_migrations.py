import copy
import unittest

from apply_final_migrations import DELIVERIES, updates_for
from final_report_contracts import traffic_question_number, validate_traffic


class FinalMigrationsTest(unittest.TestCase):
    def jobs(self):
        jobs = {
            job_id: {"id": job_id, "prompt": "before", "enabled": True, "deliver": "local", "schedule": "keep", "model": "keep"}
            for job_id in DELIVERIES
        }
        jobs["c4d0695ffc3f"]["prompt"] = (
            "Post with message action=send, channel=slack, target=C0ACTQRBFAT.\n"
            "If Q235 is unavailable or not VERIFIED and fresh, use only the approved scoped readers as a clearly labeled fallback. Cite Q235 as the Atlas coverage gap."
        )
        for key in ("6d5d35907a5b", "b1ff759d416d"):
            jobs[key]["prompt"] = "Use message action=send, channel=slack, target=C0ACTQRBFAT. Post once. Do not post a thread reply."
        jobs["165f3db78c17"] = {"prompt": "Q239\nIf Q239 is unavailable, stale, failed, or not VERIFIED, fallback", "deliver": "local"}
        return jobs

    def test_only_changes_delivery_and_prompt(self):
        jobs = self.jobs()
        before = copy.deepcopy(jobs)
        updates = updates_for(jobs, 999)
        self.assertEqual(jobs, before)
        self.assertEqual(len(updates), 6)
        self.assertNotIn("deliver", updates["165f3db78c17"])
        for job_id, update in updates.items():
            self.assertLessEqual(set(update), {"prompt", "deliver"})
            jobs[job_id].update(update)
        self.assertEqual(traffic_question_number(jobs), 999)

    def test_refuses_changed_prompts_and_running_claims(self):
        jobs = self.jobs()
        jobs["6d5d35907a5b"]["prompt"] = "new human instructions"
        with self.assertRaises(RuntimeError):
            updates_for(jobs, 999)
        jobs = self.jobs()
        jobs["6d5d35907a5b"]["run_claim"] = {"by": "worker"}
        with self.assertRaises(RuntimeError):
            updates_for(jobs, 999)

    def test_refuses_wrong_question_population(self):
        for number in (28, 31, 40, 236):
            with self.assertRaises(ValueError):
                updates_for(self.jobs(), number)

    def test_refuses_wrong_source_even_with_fresh_results(self):
        columns = ["source", "source_scope", "period_start", "window_end", "source_data_through", "source_time_zone"]
        rows = []
        for source, scope in (("ga4", "525331485"), ("search_console", "sc-domain:lipsync.com")):
            for start, end in (("2026-08-10", "2026-08-17"), ("2026-08-17", "2026-08-24")):
                rows.append([source, scope, start, end, end, "America/Los_Angeles"])
        payload = {"result": {"columns": [{"name": name} for name in columns], "rows": rows}}
        validate_traffic(payload)
        rows[0][1] = "other-site"
        with self.assertRaises(ValueError):
            validate_traffic(payload)


if __name__ == "__main__":
    unittest.main()
