import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	csvText,
	finalizeCompanyEnrichment,
	hash,
	parseCsv,
} from "../agent/lib/persona-evidence";

const { values } = parseArgs({
	options: {
		input: { type: "string" },
		out: { type: "string" },
		summary: { type: "string" },
	},
});
if (!values.input || !values.out || !values.summary)
	throw new Error("Supply --input, --out and --summary");
const input = resolve(values.input);
const out = resolve(values.out);
const summaryPath = resolve(values.summary);
if (new Set([input, out, summaryPath]).size !== 3)
	throw new Error("Input, output and summary paths must be different");
const inputText = await readFile(input, "utf8");
const result = finalizeCompanyEnrichment(parseCsv(inputText));
const headers = [
	"email_domain",
	"enrichment_key",
	"company_name",
	"employee_count",
	"industry",
	"company_type",
	"company_name_source",
	"employee_count_source",
	"industry_source",
	"company_type_status",
	"company_match_status",
	"company_match_review_status",
];
const outputText = csvText(result.rows, headers);
const summaryText = `${JSON.stringify(
	{
		version: 1,
		generatedAt: new Date().toISOString(),
		inputSha256: hash(inputText),
		outputSha256: hash(outputText),
		...result.summary,
		notes: [
			"Prior sheet values take precedence. Clay fills only missing company name, employee count, and industry fields.",
			"A Clay transport row is not treated as a company match when the provider returned Company Not Found.",
			"Company type remains unclassified because it needs the separate agency, brand, studio, or tech classification.",
			"The final evidence file excludes revenue, person email, human labels, and raw provider payloads.",
		],
	},
	null,
	2,
)}\n`;
await Promise.all([
	writeFile(out, outputText, { flag: "wx", mode: 0o600 }),
	writeFile(summaryPath, summaryText, { flag: "wx", mode: 0o600 }),
]);
await Promise.all([chmod(out, 0o600), chmod(summaryPath, 0o600)]);
console.log(summaryText.trim());
