import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def request(path):
    base_url = os.environ.get("ATLAS_API_URL", "").rstrip("/")
    secret = os.environ.get("ATLAS_QUERY_SECRET", "")
    if not base_url or not secret:
        raise RuntimeError("Atlas is not configured for this Rudy runtime.")
    req = urllib.request.Request(
        f"{base_url}{path}",
        headers={"Authorization": f"Bearer {secret}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"Atlas returned HTTP {error.code}: {detail}") from error


def search_catalog(catalog, term):
    needle = term.casefold()
    results = []
    for metric in catalog.get("metrics", []):
        text = " ".join(
            str(metric.get(key, "")) for key in ("key", "name", "description", "ownerTeam")
        ).casefold()
        if needle in text:
            results.append({"kind": "metric", **metric})
    for question in catalog.get("questions", []):
        text = " ".join(
            str(question.get(key, "")) for key in ("number", "name", "description", "connector")
        ).casefold()
        if needle in text:
            results.append({"kind": "question", **question})
    return {"schemaVersion": catalog.get("schemaVersion"), "results": results}


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("catalog")
    question = subparsers.add_parser("question")
    question.add_argument("number", type=int)
    question.add_argument("--period")
    search = subparsers.add_parser("search")
    search.add_argument("term")
    args = parser.parse_args()

    if args.command == "catalog":
        result = request("/internal/atlas/catalog")
    elif args.command == "question":
        query = ""
        if args.period:
            query = "?" + urllib.parse.urlencode({"period": args.period})
        result = request(f"/internal/atlas/questions/{args.number}{query}")
    else:
        result = search_catalog(request("/internal/atlas/catalog"), args.term)
    json.dump(result, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
