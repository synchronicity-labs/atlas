import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch


PLUGIN = pathlib.Path(__file__).parent / "atlas-cron-governance" / "__init__.py"
SPEC = importlib.util.spec_from_file_location("atlas_cron_governance", PLUGIN)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AtlasCronGovernanceTest(unittest.TestCase):
    def setUp(self):
        MODULE._PLANS.clear()

    def test_recurring_cron_requires_preflight(self):
        result = MODULE._on_pre_tool_call(
            tool_name="cronjob",
            args={"action": "create", "schedule": "0 9 * * 1", "prompt": "Report"},
            session_id="s1",
        )
        self.assertEqual(result["action"], "block")

    def test_one_off_does_not_require_preflight(self):
        result = MODULE._on_pre_tool_call(
            tool_name="cronjob",
            args={"action": "create", "schedule": "2026-09-01T09:00:00Z"},
            session_id="s1",
        )
        self.assertIsNone(result)

    @patch.object(MODULE, "_request")
    def test_verified_question_allows_recurring_report(self, request):
        request.return_value = {
            "question": {"status": "ACTIVE", "purpose": "CERTIFIED"},
            "result": {"trustStatus": "VERIFIED"},
            "freshness": {"status": "fresh"},
        }
        token = MODULE._store_plan(
            "s1", {"mode": "search", "query": "revenue", "eligible_numbers": [15]}
        )
        result = MODULE._on_pre_tool_call(
            tool_name="cronjob",
            args={
                "action": "create",
                "schedule": "0 9 * * 1",
                "prompt": f"ATLAS_PLAN: token={token} canonical=Q15",
                "skills": [MODULE.ATLAS_SKILL],
            },
            session_id="s1",
        )
        self.assertIsNone(result)
        self.assertNotIn("s1", MODULE._PLANS)

        result = MODULE._on_pre_tool_call(
            tool_name="cronjob",
            args={
                "action": "create",
                "schedule": "0 9 * * 1",
                "prompt": f"ATLAS_PLAN: token={token} canonical=Q15",
                "skills": [MODULE.ATLAS_SKILL],
            },
            session_id="s1",
        )
        self.assertEqual(result["action"], "block")

    def test_draft_question_never_allows_cron(self):
        MODULE._store_plan(
            "s1", {"mode": "draft", "query": "new metric", "eligible_numbers": []}
        )
        result = MODULE._on_pre_tool_call(
            tool_name="cronjob",
            args={"action": "create", "schedule": "0 9 * * 1", "prompt": "Report"},
            session_id="s1",
        )
        self.assertEqual(result["action"], "block")

    @patch.object(MODULE, "_request")
    def test_search_returns_plan_token_and_eligibility(self, request):
        request.side_effect = [
            {
                "schemaVersion": "atlas.catalog.v1",
                "questions": [
                    {
                        "number": 15,
                        "name": "Weekly revenue",
                        "description": "Product revenue by week",
                        "metric": {"name": "Revenue"},
                    }
                ],
            },
            {
                "question": {"status": "ACTIVE", "purpose": "CERTIFIED"},
                "result": {"trustStatus": "VERIFIED"},
                "freshness": {"status": "fresh"},
            },
        ]
        result = json.loads(
            MODULE.handle_plan(
                {"action": "search", "query": "weekly product revenue"},
                session_id="s1",
            )
        )
        self.assertTrue(result["planToken"])
        self.assertTrue(result["candidates"][0]["eligible"])

    @patch.object(MODULE, "_broker")
    def test_reviewed_draft_is_published_and_allows_the_cron(self, broker):
        broker.side_effect = [
            {
                "question": {
                    "number": 283,
                    "status": "DRAFT",
                    "purpose": "RECONCILIATION",
                },
                "cronEligible": False,
            },
            {
                "question": {
                    "number": 283,
                    "status": "ACTIVE",
                    "purpose": "CERTIFIED",
                },
                "cronEligible": True,
                "cronBlocked": False,
            },
        ]
        result = json.loads(
            MODULE.handle_plan(
                {
                    "action": "create_draft",
                    "request_key": "weekly-cancellation-feedback-incentive",
                    "name": "Weekly cancellation feedback incentive adoption",
                    "business_definition": "Complete weekly incentive outcomes.",
                    "decision_use": "Product decides whether to widen the offer.",
                    "owner_team": "Product",
                    "cadence": "weekly",
                    "acceptance_checks": ["Reconcile Product and PostHog."],
                },
                session_id="s1",
            )
        )
        self.assertTrue(result["cronEligible"])
        self.assertFalse(result["cronBlocked"])
        self.assertIn("canonical=Q283", result["instructions"]["canonical"])
        self.assertEqual(MODULE._PLANS["s1"]["eligible_numbers"], [283])

    @patch.object(MODULE, "_broker")
    def test_unreviewed_draft_remains_blocked(self, broker):
        broker.return_value = {
            "question": {"number": 284, "status": "DRAFT"},
            "cronEligible": False,
        }
        result = json.loads(
            MODULE.handle_plan(
                {
                    "action": "create_draft",
                    "request_key": "weekly-unknown-report",
                    "business_definition": "A new governed weekly report.",
                },
                session_id="s1",
            )
        )
        self.assertTrue(result["cronBlocked"])
        self.assertEqual(MODULE._PLANS["s1"]["mode"], "draft")


if __name__ == "__main__":
    unittest.main()
