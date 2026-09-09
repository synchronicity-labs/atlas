import argparse
import json
from pathlib import Path
import re
import subprocess
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clickhouse-url", required=True)
    parser.add_argument("--baseline", required=True)
    args = parser.parse_args()
    table = "atlas_attribution_eval_" + uuid.uuid4().hex

    def query(sql):
        request = urllib.request.Request(args.clickhouse_url, data=sql.encode())
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read().decode()

    path = "apps/api/src/metabase/product-eligibility.service.ts"
    baseline = subprocess.check_output(["git", "show", args.baseline + ":" + path], text=True)
    current = Path(path).read_text()

    def extract(source, name):
        sql = re.search(r"queryText: `(with " + name + r" as \([\s\S]*?)`,", source, re.I)[1]
        sql = sql.replace("${start}", "2026-03-01 00:00:00").replace("${end}", "2026-09-01 00:00:00")
        sql = sql.replace("${PAGE_SIZE}", "1000000").replace("${offset}", "0").replace("${MAX_ATTRIBUTION_ROWS}", "1000000")
        return sql.replace("sync_prod.sync_usage3", table)

    before = extract(baseline, "professional")
    after = extract(current, "attributed")
    query(f"""CREATE TABLE {table} (
        generationId String, generationCreatedAt DateTime,
        organizationId String, organizationPlanType Nullable(String),
        userId Nullable(String), apiKeyId Nullable(String),
        generationCostMillicents UInt64
    ) ENGINE=Memory""")
    rows = []

    def add(org, ids, dates, costs, plan="creator", users=None):
        for i, generation_id in enumerate(ids):
            rows.append({
                "generationId": generation_id,
                "generationCreatedAt": dates[i],
                "organizationId": org,
                "organizationPlanType": plan,
                "userId": users[i] if users else None,
                "apiKeyId": "key" if i % 2 else None,
                "generationCostMillicents": costs[i],
            })

    days = ["2026-03-01 00:00:00", "2026-03-02 10:00:00", "2026-03-02 11:00:00"]
    add("qualifies", ["a", "b", "c"], days, [3_000_000, 3_000_000, 4_000_000], users=[None, "", "user"])
    add("duplicates-not-three", ["a", "a", "b"], days, [5_000_000] * 3, users=["u1", "u2", "u1"])
    add("duplicates-qualifies", ["a", "a", "b", "c"], days + ["2026-03-03 00:00:00"], [3_000_000] * 4)
    add("one-day", ["a", "b", "c"], [days[0]] * 3, [5_000_000] * 3)
    add("below-value", ["a", "b", "c"], days, [3_000_000, 3_000_000, 3_999_999])
    add("enterprise", ["a", "b", "c"], days, [5_000_000] * 3, plan="enterprise")
    add("", ["a", "b", "c"], days, [5_000_000] * 3)
    add("null-plan", ["a", "b", "c"], days, [5_000_000] * 3, plan=None)
    add("before-bound", ["a", "b", "c"], ["2026-02-28 23:59:59"] + days[1:], [5_000_000] * 3)
    add("end-bound", ["a", "b", "c"], days[:2] + ["2026-09-01 00:00:00"], [5_000_000] * 3)
    add("large-value", ["a", "b", "c"], days, [4_000_000_000] * 3)
    try:
        query(f"INSERT INTO {table} FORMAT JSONEachRow\n" + "\n".join(json.dumps(row) for row in rows))
        results = [json.loads(query(sql + " FORMAT JSON"))["data"] for sql in [before, after]]
        assert results[0] == results[1], "Ordered SQL fixture parity failed"
        assert {row["organizationId"] for row in results[0]} == {"qualifies", "duplicates-qualifies", "large-value"}
        assert all(int(row["source_row_count"]) == len(results[0]) for row in results[0])
        query(f"TRUNCATE TABLE {table}")
        assert all(json.loads(query(sql + " FORMAT JSON"))["data"] == [] for sql in [before, after])
        print(json.dumps({"parity": "passed", "fixtureRows": len(rows), "outputRows": len(results[0]), "cases": ["exact monthly distinct IDs", "duplicates across days and principals", "cost threshold", "active day threshold", "plan filter", "null principals", "empty organization", "date edges", "large costs", "empty result"]}))
    finally:
        query(f"DROP TABLE {table}")


if __name__ == "__main__":
    main()
