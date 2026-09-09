import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MetabaseClient } from "../src/metabase/metabase.client";
import { metabaseConfig } from "../src/metabase/metabase.config";
import { ProductEligibilityService } from "../src/metabase/product-eligibility.service";

const config = metabaseConfig();
if (!config)
	throw new Error("METABASE_BASE_URL and METABASE_API_KEY are required.");
const baseline = process.argv[2];
const output = process.argv[3];
if (!baseline || !output) {
	throw new Error(
		"Usage: benchmark-product-attribution.ts <baseline-git-ref> <output.json>",
	);
}
const source = execFileSync(
	"git",
	["show", `${baseline}:apps/api/src/metabase/product-eligibility.service.ts`],
	{ encoding: "utf8" },
);
const original = source.match(
	/queryText: `(with professional as \([\s\S]*?)`,/i,
)?.[1];
if (!original) throw new Error("Baseline attribution SQL was not found.");
const queryText = original
	.replace(/\$\{start\}/g, "2026-03-01 00:00:00")
	.replace(/\$\{end\}/g, "2026-09-01 00:00:00")
	.replace(/limit \$\{PAGE_SIZE\} offset \$\{offset\}\s*$/, "limit 1000000");
const client = new MetabaseClient(config);
const service = new ProductEligibilityService({} as never, {} as never);
const runs: Array<{
	variant: string;
	rows: number;
	elapsedMs: number;
	sha256: string;
}> = [];
let expected: string | undefined;
for (let repeat = 0; repeat < 3; repeat += 1) {
	for (const variant of repeat % 2
		? ["after", "before"]
		: ["before", "after"]) {
		const started = performance.now();
		const result =
			variant === "before"
				? await client
						.exportRows({ databaseExternalId: "166", queryText })
						.then((rows) => {
							if (
								!rows.length ||
								rows.some((row) => Number(row.source_row_count) !== rows.length)
							) {
								throw new Error("Baseline export is empty or incomplete.");
							}
							return rows.map((row) => ({
								period: String(row.period).trim().slice(0, 7),
								organizationId: String(row.organizationId).trim(),
								activityDate: String(row.activity_date).trim().slice(0, 10),
								userId: String(row.user_id).trim(),
								apiKeyId: String(row.api_key_id).trim(),
								generations: Number(row.generations),
								accruedValueUsd: Number(row.accrued_value_usd),
								lastActivityAt: new Date(String(row.last_activity_at)),
							}));
						})
				: (await service["attributionRows"](client, ["2026-03", "2026-08"]))
						.rows;
		const elapsedMs = performance.now() - started;
		const serialized = JSON.stringify(result);
		expected ??= serialized;
		if (serialized !== expected)
			throw new Error(`Ordered export parity failed for ${variant}.`);
		runs.push({
			variant,
			rows: result.length,
			elapsedMs,
			sha256: createHash("sha256").update(serialized).digest("hex"),
		});
		await Bun.sleep(3_000);
	}
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
	output,
	`${JSON.stringify(
		{
			baseline,
			period: "2026-03-01 through 2026-09-01, exclusive",
			parity: "Exact ordered application rows, all fields and source count",
			measurement:
				"One complete export per variant; baseline SQL uses the export endpoint to avoid replaying 50 production scans",
			incidentBaselineRequests: 50,
			afterRequests: 1,
			runs,
		},
		null,
		2,
	)}\n`,
);
