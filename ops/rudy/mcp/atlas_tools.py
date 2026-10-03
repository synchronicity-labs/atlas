import asyncio
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from typing import Any, Dict, List, Optional


_QUARTER = re.compile(r"^\d{4}-Q[1-4]$")
_PERIOD = re.compile(r"^(\d{4})-(\d{2})(?:-(\d{2}))?$")
_MAX_QUESTION = 2_147_483_647
_MAX_SEARCH_LENGTH = 200
_MAX_LIMIT = 100
_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
_TIMEOUT = 45


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def _base_url(value):
    try:
        parsed = urllib.parse.urlsplit(value)
        parsed.port
        if (
            "?" in value
            or "#" in value
            or parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            return None
        return value.rstrip("/")
    except (AttributeError, ValueError):
        return None


def _validate_quarter(quarter):
    if not isinstance(quarter, str) or not _QUARTER.fullmatch(quarter):
        raise ValueError("quarter must match YYYY-Q1 through YYYY-Q4")


def _validate_question(number, reporting_period, as_of):
    if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= _MAX_QUESTION:
        raise ValueError("number must be a positive 32-bit integer")
    if reporting_period is not None:
        match = _PERIOD.fullmatch(reporting_period) if isinstance(reporting_period, str) else None
        if not match:
            raise ValueError("reporting_period must be YYYY-MM or YYYY-MM-DD")
        try:
            date(int(match[1]), int(match[2]), int(match[3] or 1))
        except ValueError as error:
            raise ValueError("reporting_period must be a valid ISO date") from error
    if as_of is not None:
        if not isinstance(as_of, str) or "T" not in as_of:
            raise ValueError("as_of must be an ISO timestamp")
        try:
            datetime.fromisoformat(as_of.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("as_of must be a valid ISO timestamp") from error


def _request(base_url, secret, path, params=None):
    url = base_url + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {secret}", "Accept": "application/json"},
        method="GET",
    )
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=_TIMEOUT) as response:
            payload = response.read(_MAX_RESPONSE_BYTES + 1)
            if len(payload) > _MAX_RESPONSE_BYTES:
                raise RuntimeError("Atlas response exceeded the 8 MiB limit")
            return json.loads(payload.decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Atlas request failed with HTTP {error.code}") from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError):
        raise RuntimeError("Atlas request failed") from None


def register_atlas_tools(mcp):
    base_url = _base_url(os.environ.get("ATLAS_API_URL", ""))
    secret = os.environ.get("ATLAS_QUERY_SECRET", "")
    if not base_url or not secret:
        return 0

    try:
        from mcp.types import ToolAnnotations

        annotations = ToolAnnotations(
            readOnlyHint=True,
            destructiveHint=False,
            idempotentHint=True,
            openWorldHint=True,
        )
    except ImportError:
        annotations = {
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": True,
        }

    def tool(name, description):
        return mcp.tool(
            name=name,
            description=description,
            annotations=annotations,
            structured_output=True,
        )

    @tool("atlas_qbr_report", "Read a compact Atlas QBR summary or selected metric details.")
    async def atlas_qbr_report(
        quarter: str, metric_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        _validate_quarter(quarter)
        if metric_ids is not None:
            if not isinstance(metric_ids, list) or not metric_ids or len(metric_ids) > 10:
                raise ValueError("metric_ids must contain between 1 and 10 metric IDs")
            if any(not isinstance(metric_id, str) or not metric_id for metric_id in metric_ids):
                raise ValueError("metric_ids must contain non-empty strings")
        report = await asyncio.to_thread(
            _request, base_url, secret, f"/internal/atlas/reports/qbr/{quarter}"
        )
        if metric_ids is None:
            metrics = {}
            for metric_id, metric in report.get("metrics", {}).items():
                preparation = metric.get("preparation") or {}
                metrics[metric_id] = {
                    key: metric.get(key)
                    for key in (
                        "label", "unit", "definition", "question", "notApplicable",
                        "automated", "observations",
                    )
                }
                metrics[metric_id]["supportingResultCount"] = len(
                    preparation.get("supportingResults", [])
                )
            return {
                **{key: value for key, value in report.items() if key != "metrics"},
                "view": "summary",
                "howToFetchDetails": "Pass metric_ids with up to 10 metric IDs to fetch their complete metric objects, including preparation and supporting results.",
                "metrics": metrics,
            }
        report_metrics = report.get("metrics", {})
        unknown = [metric_id for metric_id in metric_ids if metric_id not in report_metrics]
        if unknown:
            raise ValueError("metric_ids contains an unknown metric ID")
        return {
            **{key: value for key, value in report.items() if key != "metrics"},
            "view": "detail",
            "metrics": {metric_id: report_metrics[metric_id] for metric_id in metric_ids},
        }

    @tool("atlas_search_questions", "Search Atlas catalog questions by text.")
    async def atlas_search_questions(query: str, limit: int = 20) -> Dict[str, Any]:
        if not isinstance(query, str) or not query.strip() or len(query) > _MAX_SEARCH_LENGTH:
            raise ValueError(f"query must contain 1 to {_MAX_SEARCH_LENGTH} characters")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= _MAX_LIMIT:
            raise ValueError(f"limit must be between 1 and {_MAX_LIMIT}")
        catalog = await asyncio.to_thread(_request, base_url, secret, "/internal/atlas/catalog")
        needle = query.casefold()
        results = []
        for question in catalog.get("questions", []):
            text = " ".join(
                str(question.get(key, ""))
                for key in ("number", "publicNumber", "name", "description", "connector")
            ).casefold()
            if needle in text:
                results.append(question)
                if len(results) == limit:
                    break
        return {"schemaVersion": catalog.get("schemaVersion"), "results": results}

    @tool("atlas_question", "Read a saved Atlas question and its immutable result snapshot.")
    async def atlas_question(
        number: int, reporting_period: Optional[str] = None, as_of: Optional[str] = None
    ) -> Dict[str, Any]:
        _validate_question(number, reporting_period, as_of)
        params = {}
        if reporting_period is not None:
            params["reportingPeriod"] = reporting_period
        if as_of is not None:
            params["asOf"] = as_of
        path = f"/internal/atlas/questions/{number}"
        return await asyncio.to_thread(_request, base_url, secret, path, params or None)

    @tool("atlas_source_health", "Read Atlas source freshness and latest sync status.")
    async def atlas_source_health() -> Dict[str, Any]:
        return await asyncio.to_thread(_request, base_url, secret, "/internal/atlas/sources")

    return 4
