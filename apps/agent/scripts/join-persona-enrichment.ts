import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	csvText,
	hash,
	joinEnrichmentResults,
	parseCsv,
} from "../agent/lib/persona-evidence";

const { values } = parseArgs({
	options: {
		kind: { type: "string" },
		bridge: { type: "string" },
		results: { type: "string" },
		out: { type: "string" },
	},
});
if (values.kind !== "company" && values.kind !== "person")
	throw new Error("Use --kind company or person");
if (!values.bridge || !values.results || !values.out)
	throw new Error("Supply --bridge, --results and --out");
const out = resolve(values.out);
if ([values.bridge, values.results].some((path) => resolve(path) === out))
	throw new Error("Output cannot replace either input");
const bridgeText = await readFile(values.bridge, "utf8");
const resultsText = await readFile(values.results, "utf8");
const bridge = parseCsv(bridgeText);
const results = parseCsv(resultsText);
const rows = joinEnrichmentResults(bridge, results, values.kind);
const content = csvText(rows, [
	...new Set(rows.flatMap((row) => Object.keys(row))),
]);
await writeFile(out, content, { flag: "wx", mode: 0o600 });
await chmod(out, 0o600);
console.log(
	JSON.stringify({
		output: out,
		inputRows: bridge.length,
		providerRows: results.length,
		outputRows: rows.length,
		rowsWithResult: rows.filter((row) => row.clay_result_present === "true")
			.length,
		rowsWithoutResult: rows.filter((row) => row.clay_result_present === "false")
			.length,
		reviewStatus: "unreviewed",
		bridgeSha256: hash(bridgeText),
		resultsSha256: hash(resultsText),
		outputSha256: hash(content),
	}),
);
