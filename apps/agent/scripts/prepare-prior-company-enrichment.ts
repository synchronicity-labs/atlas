import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	buildCompanyEnrichmentPlan,
	COMPANY_ENRICHMENT_FIELDS,
	csvText,
	hash,
	parseCsv,
} from "../agent/lib/persona-evidence";

const { values } = parseArgs({
	options: {
		companies: { type: "string" },
		prior: { type: "string" },
		out: { type: "string" },
	},
});

const required = (key: "companies" | "prior" | "out") => {
	const value = values[key];
	if (!value) throw new Error(`Missing --${key}`);
	return value;
};

const [companyText, priorText] = await Promise.all([
	readFile(resolve(required("companies")), "utf8"),
	readFile(resolve(required("prior")), "utf8"),
]);
const plan = buildCompanyEnrichmentPlan(
	parseCsv(companyText),
	parseCsv(priorText),
);
const out = resolve(required("out"));
await mkdir(out, { recursive: true, mode: 0o700 });
if ((await readdir(out)).length)
	throw new Error("Output directory is not empty; use a new directory");
await chmod(out, 0o700);

const headers = [
	"email_domain",
	"enrichment_key",
	"company_domain_url",
	...COMPANY_ENRICHMENT_FIELDS,
	"monthly_traffic",
	"headcount_growth_6m_pct",
	"verified_description",
	"icp_verdict",
	"domain_quality",
	"icp_fit",
	"prior_enrichment_present",
	"prior_source_generated_at",
	"prior_source_url",
	...COMPANY_ENRICHMENT_FIELDS.map((field) => `need_${field}`),
	"missing_company_fields",
];
const writePrivate = async (file: string, content: string) => {
	const path = resolve(out, file);
	await writeFile(path, content, { mode: 0o600 });
	await chmod(path, 0o600);
};
await writePrivate("company_enrichment_seed.csv", csvText(plan, headers));
await writePrivate(
	"clay_company_enrichment_input.csv",
	csvText(plan, [
		"email_domain",
		"enrichment_key",
		"company_domain_url",
		...COMPANY_ENRICHMENT_FIELDS,
		...COMPANY_ENRICHMENT_FIELDS.map((field) => `need_${field}`),
	]),
);

const fieldCounts: Record<string, number> = {};
for (const field of COMPANY_ENRICHMENT_FIELDS) {
	const rows = plan
		.filter((row) => row[`need_${field}`] === "true")
		.map((row) => ({
			email_domain: row.email_domain ?? "",
			enrichment_key: row.enrichment_key ?? "",
		}));
	fieldCounts[field] = rows.length;
	await writePrivate(
		`clay_need_${field}.csv`,
		csvText(rows, ["email_domain", "enrichment_key"]),
	);
}

const reusableAllCoreFields = plan.filter((row) =>
	["company_name", "employee_count", "industry"].every(
		(field) => row[`need_${field}`] === "false",
	),
).length;
const summary = {
	version: 1,
	generatedAt: new Date().toISOString(),
	companyInputSha256: hash(companyText),
	priorCacheSha256: hash(priorText),
	companyDomains: plan.length,
	priorOverlap: plan.filter((row) => row.prior_enrichment_present === "true")
		.length,
	reusableAllCoreFields,
	needsClayByField: fieldCounts,
	notes: [
		"Reuse is field-specific. A domain can reuse one old field and still request another.",
		"The prior sheet has no approved company_type field, so company type needs fresh enrichment.",
		"clay_company_enrichment_input.csv is the minimal bulk input and omits revenue, person emails, labels, and prior analysis context.",
		"company_domain_url is a Clay lookup input; enrichment_key remains the normalized domain used for safe joins.",
		"Person emails and human persona labels are not included in these files.",
	],
};
await writePrivate(
	"reuse_summary.json",
	`${JSON.stringify(summary, null, 2)}\n`,
);
console.log(JSON.stringify(summary));
