import asyncio
import json
import os
import unittest
from unittest.mock import patch

from atlas_tools import _base_url, _validate_question, _validate_quarter, register_atlas_tools


class FakeMCP:
    def __init__(self):
        self.tools = {}

    def tool(self, name, description, annotations, structured_output=False):
        def register(function):
            self.tools[name] = (function, description, annotations, structured_output)
            return function

        return register


class AtlasToolsTests(unittest.TestCase):
    def configured(self):
        server = FakeMCP()
        env = {"ATLAS_API_URL": "https://atlas.example", "ATLAS_QUERY_SECRET": "server-secret"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(register_atlas_tools(server), 4)
        for _, _, annotations, structured_output in server.tools.values():
            get = annotations.get if isinstance(annotations, dict) else lambda key: getattr(annotations, key)
            self.assertTrue(get("readOnlyHint"))
            self.assertFalse(get("destructiveHint"))
            self.assertTrue(get("idempotentHint"))
            self.assertTrue(get("openWorldHint"))
            self.assertTrue(structured_output)
        return server

    def test_missing_or_unsafe_configuration_registers_nothing(self):
        for env in ({}, {"ATLAS_API_URL": "https://atlas.example"},
                    {"ATLAS_API_URL": "https://user:pass@atlas.example", "ATLAS_QUERY_SECRET": "x"},
                    {"ATLAS_API_URL": "https://atlas.example?secret=x", "ATLAS_QUERY_SECRET": "x"},
                    {"ATLAS_API_URL": "https://atlas.example?", "ATLAS_QUERY_SECRET": "x"}):
            server = FakeMCP()
            with patch.dict(os.environ, env, clear=True):
                self.assertEqual(register_atlas_tools(server), 0)
            self.assertEqual(server.tools, {})

    def test_validation_rejects_path_and_calendar_injection(self):
        for quarter in ("2026-Q5", "2026-Q1/../../sources", "2026-Q1?x=y"):
            with self.assertRaises(ValueError):
                _validate_quarter(quarter)
        for period in ("2026-13", "2026-02-30", "2026-01/../sources"):
            with self.assertRaises(ValueError):
                _validate_question(1, period, None)
        for timestamp in ("tomorrow", "2026-10-03T29:00:00Z"):
            with self.assertRaises(ValueError):
                _validate_question(1, None, timestamp)
        self.assertIsNone(_base_url("file:///etc/passwd"))

    def test_question_uses_fixed_route_encoded_query_and_server_secret(self):
        server = self.configured()
        captured = {}

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return None

            def read(self, size):
                return b'{"status":"unknown","provenance":{"saved":true}}'

        def open_request(request, timeout):
            captured.update(url=request.full_url, headers=dict(request.header_items()), method=request.get_method(), timeout=timeout)
            return Response()

        with patch("atlas_tools.urllib.request.build_opener") as build:
            build.return_value.open.side_effect = open_request
            result = asyncio.run(server.tools["atlas_question"][0](42, "2026-10", "2026-10-03T12:00:00Z"))
        self.assertEqual(json.loads(json.dumps(result)), {"status": "unknown", "provenance": {"saved": True}})
        self.assertEqual(captured["url"], "https://atlas.example/internal/atlas/questions/42?reportingPeriod=2026-10&asOf=2026-10-03T12%3A00%3A00Z")
        self.assertEqual(captured["headers"]["Authorization"], "Bearer server-secret")
        self.assertEqual(captured["method"], "GET")
        self.assertEqual(captured["timeout"], 45)

    def test_upstream_response_size_is_bounded(self):
        from atlas_tools import _MAX_RESPONSE_BYTES, _request

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return None

            def read(self, size):
                self.requested_size = size
                return b"x" * size

        response = Response()

        class Opener:
            def open(self, request, timeout):
                return response

        with patch("atlas_tools.urllib.request.build_opener", return_value=Opener()):
            with self.assertRaisesRegex(RuntimeError, "exceeded the 8 MiB limit"):
                _request("https://atlas.example", "server-secret", "/internal/atlas/catalog")
        self.assertEqual(response.requested_size, _MAX_RESPONSE_BYTES + 1)

    def test_catalog_search_uses_actual_catalog_question_shape_and_limit(self):
        server = self.configured()
        catalog = {"schemaVersion": 1, "questions": [
            {"number": 12, "publicNumber": 1200, "name": "Net retention", "connector": "stripe", "snapshot": {"status": "saved"}},
            {"number": 13, "name": "Net retention by cohort", "connector": "warehouse"},
            {"number": 14, "name": "Activation", "connector": "posthog"},
        ]}
        with patch("atlas_tools._request", return_value=catalog):
            result = asyncio.run(server.tools["atlas_search_questions"][0]("NET RETENTION", 1))
        self.assertEqual(result, {"schemaVersion": 1, "results": [catalog["questions"][0]]})

    def test_qbr_and_health_routes_are_fixed_and_errors_redact_upstream(self):
        server = self.configured()
        with patch("atlas_tools._request", side_effect=[{"quarter": "2026-Q3"}, {"sources": []}]) as request:
            self.assertEqual(asyncio.run(server.tools["atlas_qbr_report"][0]("2026-Q3"))["quarter"], "2026-Q3")
            self.assertEqual(asyncio.run(server.tools["atlas_source_health"][0]()), {"sources": []})
        self.assertEqual([call.args[2] for call in request.call_args_list], [
            "/internal/atlas/reports/qbr/2026-Q3", "/internal/atlas/sources"
        ])

        class Opener:
            def open(self, request, timeout):
                import urllib.error
                raise urllib.error.HTTPError(request.full_url, 403, "denied", {}, None)

        with patch("atlas_tools.urllib.request.build_opener", return_value=Opener()):
            from atlas_tools import _request
            with self.assertRaisesRegex(RuntimeError, "HTTP 403") as error:
                _request("https://atlas.example", "server-secret", "/internal/atlas/sources")
            self.assertNotIn("server-secret", str(error.exception))
            self.assertNotIn("atlas.example", str(error.exception))

    def test_qbr_summary_and_selected_details_preserve_contract(self):
        server = self.configured()
        observation = {"status": "reported", "value": 0, "snapshotId": "snapshot-1"}
        report = {
            "schemaVersion": "atlas.qbr.v1", "quarter": "2026-Q3",
            "definitionVersion": "7", "generatedAt": "2026-10-03T12:00:00Z",
            "metrics": {
                "retention": {
                    "label": "Retention", "unit": "%", "definition": "Exact definition",
                    "question": {"number": 81, "url": "https://atlas.example/questions/81"},
                    "notApplicable": False, "automated": False,
                    "preparation": {"owner": "Team", "supportingResults": [{"label": "source"}]},
                    "observations": {"2026-Q3": observation},
                },
                "adoption": {
                    "label": "Adoption", "unit": "users", "definition": "Definition",
                    "question": None, "notApplicable": True, "automated": True,
                    "preparation": {"supportingResults": []}, "observations": {},
                },
            },
        }
        with patch("atlas_tools._request", return_value=report):
            summary = asyncio.run(server.tools["atlas_qbr_report"][0]("2026-Q3"))
            detail = asyncio.run(server.tools["atlas_qbr_report"][0]("2026-Q3", ["retention"]))
        self.assertEqual(summary["view"], "summary")
        self.assertEqual(summary["schemaVersion"], report["schemaVersion"])
        self.assertEqual(summary["generatedAt"], report["generatedAt"])
        self.assertEqual(summary["metrics"]["retention"]["observations"]["2026-Q3"], observation)
        self.assertEqual(summary["metrics"]["retention"]["supportingResultCount"], 1)
        self.assertNotIn("preparation", summary["metrics"]["retention"])
        self.assertEqual(detail["metrics"], {"retention": report["metrics"]["retention"]})
        self.assertEqual(detail["view"], "detail")
        with patch("atlas_tools._request") as request:
            for ids in ([], [str(i) for i in range(11)]):
                with self.assertRaises(ValueError):
                    asyncio.run(server.tools["atlas_qbr_report"][0]("2026-Q3", ids))
            request.assert_not_called()
        with patch("atlas_tools._request", return_value=report):
            with self.assertRaisesRegex(ValueError, "unknown metric"):
                asyncio.run(server.tools["atlas_qbr_report"][0]("2026-Q3", ["unknown"]))


if __name__ == "__main__":
    unittest.main()
