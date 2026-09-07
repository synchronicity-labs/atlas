import json
import math
import time
import urllib.error
import urllib.request
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse


def https_origin(value):
    try:
        origin = urlparse(value)
        port = origin.port
        valid = (origin.scheme == "https" and origin.hostname and origin.username is None
                 and origin.path in {"", "/"} and "?" not in value and "#" not in value
                 and not any(character.isspace() or ord(character) < 32 or character == "\\" for character in value)
                 and (port is None or 0 < port <= 65535))
    except ValueError:
        valid = False
    if not valid:
        raise RuntimeError("Atlas requires an HTTPS origin without user information, path, query, or fragment")
    return f"https://{origin.netloc}"


class RateLimited(RuntimeError):
    def __init__(self, retry_after):
        super().__init__("Request rate limited")
        self.retry_after = retry_after


def retry_delay(value):
    try:
        delay = float(value)
    except (ValueError, TypeError):
        try:
            delay = parsedate_to_datetime(value).timestamp() - time.time()
        except (ValueError, TypeError, AttributeError, OverflowError):
            return 60
    return max(1, math.ceil(delay)) if math.isfinite(delay) else 60


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Authenticated request refused a redirect")


def request_json(url, token, payload=None):
    request = urllib.request.Request(
        url,
        data=None if payload is None else json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="GET" if payload is None else "POST",
    )
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            raw = response.read(2_000_001)
    except urllib.error.HTTPError as error:
        if error.code == 429:
            raise RateLimited(retry_delay(error.headers.get("Retry-After"))) from None
        raise RuntimeError(f"HTTP {error.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RuntimeError("Request unavailable or timed out") from None
    if len(raw) > 2_000_000:
        raise RuntimeError("Response exceeds the size limit")
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise RuntimeError("Response is not valid JSON") from None
    if not isinstance(result, dict):
        raise RuntimeError("Response is not an object")
    return result
