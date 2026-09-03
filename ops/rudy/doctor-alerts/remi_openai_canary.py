#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

RETRYABLE_HTTP = {408, 429, 500, 502, 503, 504}
ATTEMPTS = 4


def request_models(key, opener=urllib.request.urlopen, sleep=time.sleep):
    request = urllib.request.Request(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    for attempt in range(ATTEMPTS):
        try:
            with opener(request, timeout=20) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code not in RETRYABLE_HTTP or attempt == ATTEMPTS - 1:
                raise
        except (TimeoutError, urllib.error.URLError):
            if attempt == ATTEMPTS - 1:
                raise
        sleep(0.5 * (2**attempt))
    raise RuntimeError("OpenAI model check exhausted retries")


def main():
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        print("FAIL missing OPENAI_API_KEY")
        raise SystemExit(1)
    try:
        payload = request_models(key)
    except urllib.error.HTTPError as exc:
        print(f"FAIL OpenAI HTTP {exc.code}")
        raise SystemExit(1)
    except Exception as exc:
        print(f"FAIL OpenAI {type(exc).__name__}")
        raise SystemExit(1)
    models = {
        str(item.get("id") or "")
        for item in payload.get("data") or []
        if isinstance(item, dict)
    }
    if "gpt-5.6-sol" not in models:
        print("FAIL gpt-5.6-sol unavailable")
        raise SystemExit(1)
    print("OK OpenAI key and gpt-5.6-sol available")


if __name__ == "__main__":
    main()
