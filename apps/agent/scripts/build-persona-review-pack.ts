import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	buildPersonaReviewPack,
	csvText,
	hash,
	parseCsv,
} from "../agent/lib/persona-evidence";

const { values } = parseArgs({
	options: {
		labels: { type: "string" },
		mappings: { type: "string" },
		organizations: { type: "string" },
		mix: { type: "string" },
		companies: { type: "string" },
		out: { type: "string" },
		summary: { type: "string" },
	},
});
const required = [
	"labels",
	"mappings",
	"organizations",
	"mix",
	"companies",
	"out",
	"summary",
] as const;
if (required.some((key) => !values[key])) {
	throw new Error(
		"Supply --labels, --mappings, --organizations, --mix, --companies, --out and --summary",
	);
}
const paths = Object.fromEntries(
	required.map((key) => [key, resolve(values[key] ?? "")]),
) as Record<(typeof required)[number], string>;
if (new Set(Object.values(paths)).size !== required.length) {
	throw new Error("Every input and output path must be different");
}
const inputEntries = await Promise.all(
	(["labels", "mappings", "organizations", "mix", "companies"] as const).map(
		async (key) => [key, await readFile(paths[key], "utf8")] as const,
	),
);
const inputText = Object.fromEntries(inputEntries) as Record<
	(typeof inputEntries)[number][0],
	string
>;
const result = buildPersonaReviewPack({
	labels: parseCsv(inputText.labels),
	mappings: parseCsv(inputText.mappings),
	organizations: parseCsv(inputText.organizations),
	mix: parseCsv(inputText.mix),
	companies: parseCsv(inputText.companies),
});
const headers = [
	"stripe_customer_id",
	"email_domain",
	"lifetime_revenue",
	"first_paid",
	"product_mapping_status",
	"product_organization_ids",
	"organization_names",
	"plans",
	"billing_versions",
	"eligible_members",
	"completed_generations",
	"generated_hours",
	"behavior_observation_status",
	"top_model",
	"top_model_share_pct",
	"top_surface",
	"top_surface_share_pct",
	"company_name",
	"company_employee_count",
	"company_industry",
	"company_match_status",
	"suggested_persona",
	"persona_suggestion_confidence",
	"persona_suggestion_evidence",
	"persona_label",
	"review_status",
	"reviewed_by",
	"evidence_url",
	"review_notes",
];
const outputText = csvText(result.rows, headers);
const summaryText = `${JSON.stringify(
	{
		version: 2,
		generatedAt: new Date().toISOString(),
		inputSha256: Object.fromEntries(
			Object.entries(inputText).map(([key, value]) => [key, hash(value)]),
		),
		outputSha256: hash(outputText),
		...result.summary,
		notes: [
			"Suggestions are review aids. They never overwrite a human persona label.",
			"Accuracy is not measurable until reviewed human labels exist and can be compared with suggestions.",
			"The review pack contains only the 100 selected accounts. It never downloads the full identity population.",
			"A completed behavior observation can contain zero completed generations. Zero is not treated as missing evidence.",
		],
	},
	null,
	2,
)}\n`;
await Promise.all([
	writeFile(paths.out, outputText, { flag: "wx", mode: 0o600 }),
	writeFile(paths.summary, summaryText, { flag: "wx", mode: 0o600 }),
]);
await Promise.all([chmod(paths.out, 0o600), chmod(paths.summary, 0o600)]);
console.log(summaryText.trim());
