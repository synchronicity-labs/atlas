#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request


def main():
    if len(sys.argv) != 1:
        raise RuntimeError("atlas authoring broker accepts JSON on stdin only")
    payload = sys.stdin.buffer.read(32_769)
    if len(payload) > 32_768:
        raise RuntimeError("Atlas draft request is too large")
    body = json.loads(payload)
    if not isinstance(body, dict):
        raise RuntimeError("Atlas draft request must be an object")
    operation = body.pop("operation", "create")
    if operation == "create":
        path = "/internal/atlas/authoring/questions"
    elif operation == "publish":
        question_number = body.pop("questionNumber", None)
        if not isinstance(question_number, int) or question_number < 1:
            raise RuntimeError("Atlas publication requires a question number")
        path = f"/internal/atlas/authoring/questions/{question_number}/publish"
    else:
        raise RuntimeError("Atlas authoring operation is not allowed")
    timeout = 180 if operation == "publish" else 45
    base_url = os.environ.get("ATLAS_API_URL", "").rstrip("/")
    secret = os.environ.get("ATLAS_AUTHORING_SECRET", "")
    if not base_url or not secret:
        raise RuntimeError("Atlas authoring is not configured")
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=json.dumps(body, separators=(",", ":")).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:1_000]
        raise RuntimeError(f"Atlas returned HTTP {error.code}: {detail}") from error
    json.dump(result, sys.stdout, separators=(",", ":"), sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"error": str(error)}, sys.stdout, separators=(",", ":"))
        sys.stdout.write("\n")
        raise SystemExit(1)
