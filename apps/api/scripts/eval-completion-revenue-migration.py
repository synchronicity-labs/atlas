import argparse
import json
from pathlib import Path
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--postgres-container", required=True)
    args = parser.parse_args()
    schema = "revenue_migration_eval_" + uuid.uuid4().hex

    def sql(statement, expected_success=True):
        result = subprocess.run(
            ["docker", "exec", "-i", args.postgres_container, "psql", "-U", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"],
            input=f'SET search_path TO "{schema}";\n' + statement,
            text=True, capture_output=True,
        )
        if (result.returncode == 0) != expected_success:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    source = Path("packages/db/prisma/migrations/20260824190000_stripe_subscription_and_collection_reconciliation/migration.sql").read_text()
    original = source.split("atlas-weekly-revenue-version-product-run-rate-v6", 1)[1].split("$query$", 2)[1]
    migration = Path("packages/db/prisma/migrations/20260909210000_completion_ordered_revenue_usage/migration.sql").read_text()
    sql(f'CREATE SCHEMA "{schema}"')
    try:
        sql('''CREATE TABLE "question" (id text PRIMARY KEY, number integer);
CREATE TABLE "questionVersion" (
  id text PRIMARY KEY, "questionId" text, version integer,
  "queryLanguage" text, "queryText" text, display text,
  visualization jsonb, "sourceCardExternalId" text,
  "createdBy" text, "createdAt" timestamptz
);
INSERT INTO "question" VALUES ('q1102', 1102), ('q1103', 1103);
INSERT INTO "questionVersion" VALUES
('original', 'q1102', 6, 'SQL', $fixture$''' + original + '''$fixture$, 'smartscalar', '{}', NULL, 'original', now()),
('other', 'q1103', 1, 'SQL', 'select 1', 'table', '{}', NULL, 'original', now());''')
        sql(migration)
        rows = json.loads(sql('SELECT json_agg(v ORDER BY v.version) FROM "questionVersion" v WHERE "questionId" = \'q1102\''))
        assert len(rows) == 2
        before, after = rows
        assert before["queryText"] == original
        expected = original.replace(
            "from sync_prod.sync_usage3\n  cross join bounds\n), topups as (",
            'from sync_prod.sync_usage_by_completion\n  cross join bounds\n  where "generationEndedAt" >= bounds.month_start\n    and "generationEndedAt" < bounds.data_through\n), topups as (',
        )
        assert after["queryText"] == expected
        assert after["version"] == 7
        for field in ["questionId", "queryLanguage", "display", "visualization", "sourceCardExternalId"]:
            assert before[field] == after[field]
        sql(migration)
        assert sql('SELECT count(*) FROM "questionVersion"') == "3"
        assert sql('SELECT "queryText" FROM "questionVersion" WHERE id = \'other\'') == "select 1"
        sql('DELETE FROM "questionVersion" WHERE id = \'atlas-revenue-version-product-run-rate-completion\'; UPDATE "questionVersion" SET "queryText" = \'select 2\' WHERE id = \'original\';')
        sql(migration, expected_success=False)
        assert sql('SELECT count(*) FROM "questionVersion"') == "2"
        print(json.dumps({"parity": "passed", "cases": ["preserves original version", "changes only usage source and matching date bounds", "preserves question metadata", "next version", "idempotence", "unrelated question unchanged", "rejects unexpected latest SQL"]}))
    finally:
        sql(f'DROP SCHEMA "{schema}" CASCADE')


if __name__ == "__main__":
    main()
