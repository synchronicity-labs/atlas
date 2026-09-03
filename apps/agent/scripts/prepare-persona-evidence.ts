import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	type CsvRow,
	chunks,
	companyInvoiceMappingSql,
	csvText,
	generationEvidenceSql,
	hash,
	mappingStatus,
	PERSONA_LABELS,
	parseCsv,
	prepareInputs,
	productMembershipSql,
	validateGenerationEvidence,
	validateWindow,
} from "../agent/lib/persona-evidence";

const { values } = parseArgs({
	options: {
		companies: { type: "string" },
		people: { type: "string" },
		labels: { type: "string" },
		out: { type: "string" },
		start: { type: "string" },
		end: { type: "string" },
		fetch: { type: "boolean", default: false },
		resume: { type: "boolean", default: false },
	},
});

const required = (
	key: "companies" | "people" | "labels" | "out" | "start" | "end",
) => {
	const value = values[key];
	if (!value) throw new Error(`Missing --${key}`);
	return value;
};

const start = required("start");
const end = required("end");
validateWindow(start, end);
if (Date.parse(end) > Date.now())
	throw new Error("Observation end cannot be in the future");
const out = resolve(required("out"));
await mkdir(out, { recursive: true, mode: 0o700 });
const outputExists = (await readdir(out)).length > 0;
if (outputExists && !values.resume)
	throw new Error(
		"Output directory is not empty; use a new directory or --resume",
	);
await chmod(out, 0o700);

const inputs = await Promise.all(
	["companies", "people", "labels"].map(async (kind) => {
		const path = required(kind as "companies" | "people" | "labels");
		const text = await readFile(path, "utf8");
		return {
			kind,
			name: basename(path),
			sha256: hash(text),
			rows: parseCsv(text),
		};
	}),
);
const prepared = prepareInputs(
	inputs[0]?.rows ?? [],
	inputs[1]?.rows ?? [],
	inputs[2]?.rows ?? [],
);
const inputSummary = inputs.map(({ kind, name, sha256, rows }) => ({
	kind,
	name,
	sha256,
	rows: rows.length,
}));
const runKey = hash(JSON.stringify({ inputs: inputSummary, start, end }));
try {
	const old = JSON.parse(await readFile(resolve(out, "manifest.json"), "utf8"));
	if (old.runKey !== runKey)
		throw new Error("Resume requires the same input files and UTC window");
} catch (error) {
	if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
		throw error;
	if (outputExists)
		throw new Error(
			"Existing output has no manifest; use a new output directory",
		);
}
if (values.resume) {
	try {
		const reviewed = parseCsv(
			await readFile(resolve(out, "human_labels.csv"), "utf8"),
		);
		const original = new Map(
			prepared.labelRows.map((row) => [row.org_id, row]),
		);
		if (
			reviewed.length !== original.size ||
			new Set(reviewed.map((row) => row.org_id)).size !== original.size ||
			reviewed.some(
				(row) =>
					!original.has(row.org_id) ||
					[
						"stripe_customer_id",
						"email_domain",
						"lifetime_rev",
						"first_paid",
					].some((field) => row[field] !== original.get(row.org_id)?.[field]),
			)
		) {
			throw new Error(
				"Human review keys or source columns changed; keep the reviewed file and use a new output directory",
			);
		}
		prepared.labelRows = prepareInputs(
			inputs[0]?.rows ?? [],
			inputs[1]?.rows ?? [],
			reviewed,
		).labelRows;
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}
}
await writeFile(
	resolve(out, "manifest.json"),
	JSON.stringify(
		{
			version: 1,
			runKey,
			status: "running",
			startedAt: new Date().toISOString(),
			window: { start, endExclusive: end, timezone: "UTC" },
			inputs: inputSummary,
		},
		null,
		2,
	),
	{ mode: 0o600 },
);

const files: { file: string; rows?: number; sha256: string }[] = [];
const write = async (file: string, content: string, rowCount?: number) => {
	await writeFile(resolve(out, file), content, { mode: 0o600 });
	await chmod(resolve(out, file), 0o600);
	files.push({ file, rows: rowCount, sha256: hash(content) });
};
const writeCsv = async (file: string, rows: CsvRow[], headers: string[]) =>
	write(file, csvText(rows, [...new Set(headers)]), rows.length);

await writeCsv("clay_companies.csv", prepared.companyRows, [
	"email_domain",
	"enrichment_key",
]);
await writeCsv("clay_companies_join.csv", prepared.companyBridge, [
	...Object.keys(inputs[0]?.rows[0] ?? {}),
	"enrichment_key",
]);
await writeCsv("clay_people_unique.csv", prepared.personRows, [
	"enrichment_key",
	"email",
	"email_domain",
]);
await writeCsv("clay_people_join.csv", prepared.personBridge, [
	...Object.keys(inputs[1]?.rows[0] ?? {}),
	"stripe_customer_id",
	"enrichment_key",
	"email_domain",
]);
await writeCsv("human_labels.csv", prepared.labelRows, [
	...new Set(prepared.labelRows.flatMap(Object.keys)),
]);

const attempts: {
	database: number;
	querySha256: string;
	rows: number;
	startedAt: string;
	completedAt: string;
	cached: boolean;
}[] = [];
const failures: { stage: string; batch?: number; error: string }[] = [];
const cacheDir = resolve(out, "query-cache");
await mkdir(cacheDir, { recursive: true, mode: 0o700 });

async function query(
	database: number,
	sql: string,
	cap = 2000,
): Promise<CsvRow[]> {
	if (!values.fetch) throw new Error("Source access requires --fetch");
	const key = hash(JSON.stringify({ database, sql }));
	const cachePath = resolve(cacheDir, `${key}.json`);
	if (values.resume) {
		try {
			const saved = JSON.parse(await readFile(cachePath, "utf8"));
			if (
				saved.querySha256 !== key ||
				saved.database !== database ||
				!Array.isArray(saved.rows)
			)
				throw new Error("Invalid query cache");
			attempts.push({ ...saved.attempt, cached: true });
			return saved.rows;
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
		}
	}
	const baseUrl = process.env.METABASE_BASE_URL;
	const apiKey = process.env.METABASE_API_KEY;
	if (!baseUrl || !apiKey)
		throw new Error("Metabase credentials are not configured");
	const startedAt = new Date().toISOString();
	let response: Response;
	try {
		response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/dataset`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
			body: JSON.stringify({
				database,
				type: "native",
				native: { query: sql },
				constraints: { "max-results": 2000, "max-results-bare-rows": 2000 },
			}),
			signal: AbortSignal.timeout(120000),
		});
	} catch {
		throw new Error(
			`Source request failed or timed out (query ${key.slice(0, 12)})`,
		);
	}
	const result = await response.json();
	if (
		!response.ok ||
		result.status !== "completed" ||
		!Array.isArray(result.data?.rows)
	) {
		await writeFile(
			resolve(cacheDir, `${key}.failure.json`),
			JSON.stringify(
				{
					database,
					sql,
					status: response.status,
					error:
						result.error ?? result.message ?? "Source query did not complete",
				},
				null,
				2,
			),
			{ mode: 0o600 },
		);
		throw new Error(
			`Source query did not complete (query ${key.slice(0, 12)}); no partial data used`,
		);
	}
	if (result.data.rows_truncated || result.data.rows.length >= cap) {
		throw new Error(
			`Source result reached its row cap (query ${key.slice(0, 12)}); no partial data used`,
		);
	}
	const columns = result.data.cols.map(
		(column: { name: string }) => column.name,
	) as string[];
	const rows = result.data.rows.map((row: unknown[]) =>
		Object.fromEntries(
			columns.map((column, index) => [
				column,
				row[index] == null ? "" : String(row[index]),
			]),
		),
	);
	const attempt = {
		database,
		querySha256: key,
		rows: rows.length,
		startedAt,
		completedAt: new Date().toISOString(),
		cached: false,
	};
	attempts.push(attempt);
	await writeFile(
		cachePath,
		JSON.stringify({ database, querySha256: key, sql, attempt, rows }, null, 2),
		{ mode: 0o600 },
	);
	return rows;
}

const invoiceMappings: CsvRow[] = [];
const memberships: CsvRow[] = [];
const generations: CsvRow[] = [];
const successfulCustomerLookups = new Set<string>();
const successfulGenerationLookups = new Set<string>();
let companyLookupComplete = false;

if (values.fetch) {
	console.log(
		JSON.stringify({
			stage: "company_invoice_mapping",
			domains: prepared.companyRows.length,
		}),
	);
	try {
		let cursor = "";
		for (let page = 0; page < 200; page++) {
			const rows = await query(
				166,
				companyInvoiceMappingSql(
					prepared.companyRows.map((row) => row.enrichment_key ?? ""),
					end,
					cursor,
				),
			);
			if (!rows.length) {
				companyLookupComplete = true;
				break;
			}
			const next = rows.at(-1)?.mapping_key;
			if (!next || next <= cursor)
				throw new Error("Company mapping cursor did not advance");
			invoiceMappings.push(...rows);
			cursor = next;
			console.log(
				JSON.stringify({
					stage: "company_invoice_mapping",
					page: page + 1,
					mappings: invoiceMappings.length,
				}),
			);
		}
		if (!companyLookupComplete)
			throw new Error("Company mapping exceeded its bounded page count");
	} catch (error) {
		failures.push({ stage: "company_invoice_mapping", error: String(error) });
	}
	const customerIds = [
		...new Set([
			...prepared.personBridge.map((row) => row.stripe_customer_id ?? ""),
			...prepared.labelRows.map((row) => row.stripe_customer_id ?? ""),
			...invoiceMappings.map((row) => row.stripe_customer_id ?? ""),
		]),
	].sort();
	const customerBatches = chunks(customerIds, 100);
	let consecutiveFailures = 0;
	for (const [index, batch] of customerBatches.entries()) {
		try {
			const rows = await query(34, productMembershipSql(batch));
			memberships.push(...rows);
			for (const id of batch) successfulCustomerLookups.add(id);
			consecutiveFailures = 0;
		} catch (error) {
			failures.push({
				stage: "product_membership",
				batch: index,
				error: String(error),
			});
			consecutiveFailures++;
		}
		console.log(
			JSON.stringify({
				stage: "product_membership",
				batch: index + 1,
				total: customerBatches.length,
				organizations: memberships.length,
				failedBatches: failures.length,
			}),
		);
		if (consecutiveFailures >= 3) break;
	}
	const organizationIds = [
		...new Set(memberships.map((row) => row.product_organization_id ?? "")),
	].sort();
	const generationBatches = chunks(organizationIds, 40);
	consecutiveFailures = 0;
	for (const [index, batch] of generationBatches.entries()) {
		try {
			const rows = await query(34, generationEvidenceSql(batch, start, end));
			validateGenerationEvidence(rows, batch);
			generations.push(...rows);
			for (const id of batch) successfulGenerationLookups.add(id);
			consecutiveFailures = 0;
		} catch (error) {
			failures.push({
				stage: "generation_evidence",
				batch: index,
				error: String(error),
			});
			consecutiveFailures++;
		}
		console.log(
			JSON.stringify({
				stage: "generation_evidence",
				batch: index + 1,
				total: generationBatches.length,
				aggregateRows: generations.length,
				failedBatches: failures.length,
			}),
		);
		if (consecutiveFailures >= 3) break;
	}
}

const byCustomer = new Map<string, CsvRow[]>();
for (const row of memberships) {
	const key = row.stripe_customer_id ?? "";
	byCustomer.set(key, [...(byCustomer.get(key) ?? []), row]);
}
const accountSources = [
	...prepared.personBridge.map((row) => ({
		org_id: row.org_id,
		email_domain: row.email_domain,
		input_kind: "person",
		stripe_customer_id: row.stripe_customer_id,
	})),
	...prepared.labelRows.map((row) => ({
		org_id: row.org_id,
		email_domain: row.email_domain,
		input_kind: "human_label",
		stripe_customer_id: row.stripe_customer_id,
	})),
	...invoiceMappings.map((row) => ({
		org_id: "",
		email_domain: row.email_domain,
		input_kind: "company_invoice_domain_evidence",
		stripe_customer_id: row.stripe_customer_id,
	})),
];
const accountBridge: CsvRow[] = accountSources.flatMap((source) => {
	const matched = byCustomer.get(source.stripe_customer_id ?? "") ?? [];
	return (matched.length ? matched : [{}]).map(
		(org) =>
			({
				...source,
				product_organization_id: org.product_organization_id ?? "",
				mapping_status: successfulCustomerLookups.has(
					source.stripe_customer_id ?? "",
				)
					? mappingStatus(matched.length)
					: "not_checked",
				mapping_source: matched.length
					? "Product organizations.stripe_customer_id"
					: "",
			}) as CsvRow,
	);
});

const domainCoverage: CsvRow[] = prepared.companyRows.map((row) => {
	const matched = invoiceMappings.filter(
		(invoice) => invoice.email_domain === row.enrichment_key,
	);
	const customers = new Set(
		matched.map((invoice) => invoice.stripe_customer_id ?? ""),
	);
	const orgs = new Set(
		[...customers].flatMap((id) =>
			(byCustomer.get(id) ?? []).map(
				(org) => org.product_organization_id ?? "",
			),
		),
	);
	const customersChecked = [...customers].every((id) =>
		successfulCustomerLookups.has(id),
	);
	return {
		...row,
		matched_invoice_customers: companyLookupComplete
			? String(customers.size)
			: "",
		mapped_product_organizations:
			companyLookupComplete && customersChecked ? String(orgs.size) : "",
		lookup_status: !companyLookupComplete
			? "incomplete"
			: customers.size
				? "invoice_domain_evidence_found"
				: "no_invoice_domain_evidence",
		product_mapping_status:
			companyLookupComplete && customersChecked ? "completed" : "not_checked",
	};
});

const summaries = new Map(
	generations
		.filter((row) => row.breakdown === "organization")
		.map((row) => [row.product_organization_id, row]),
);
const organizationEvidence: CsvRow[] = memberships.map((row) => {
	const orgId = row.product_organization_id ?? "";
	const summary = summaries.get(orgId);
	const checked = successfulGenerationLookups.has(orgId);
	const count = summary?.completed_generations ?? (checked ? "0" : "");
	const durationCount =
		summary?.valid_duration_generations ?? (checked ? "0" : "");
	return {
		...row,
		observation_start_utc: start,
		observation_end_exclusive_utc: end,
		generation_lookup_status: checked ? "completed" : "not_checked",
		completed_generations: count,
		valid_duration_generations: durationCount,
		missing_or_invalid_duration_generations:
			summary?.missing_or_invalid_duration_generations ?? (checked ? "0" : ""),
		generated_hours: summary?.generated_seconds
			? String(Number(summary.generated_seconds) / 3600)
			: checked && count === "0"
				? "0"
				: "",
		average_output_seconds: summary?.average_output_seconds ?? "",
		median_output_seconds: summary?.median_output_seconds ?? "",
		p90_output_seconds: summary?.p90_output_seconds ?? "",
		generations_with_segments:
			summary?.generations_with_segments ?? (checked ? "0" : ""),
		duration_coverage_pct:
			Number(count) > 0
				? String((Number(durationCount) / Number(count)) * 100)
				: "",
		persona_label: "",
		behavior_label: "",
	};
});
const modelAndSurface = generations
	.filter((row) => row.breakdown !== "organization")
	.map((row) => ({
		...row,
		observation_start_utc: start,
		observation_end_exclusive_utc: end,
		generation_share_pct: String(
			(Number(row.completed_generations) /
				Number(
					summaries.get(row.product_organization_id)?.completed_generations,
				)) *
				100,
		),
	}));

await writeCsv("account_product_bridge.csv", accountBridge, [
	"input_kind",
	"org_id",
	"email_domain",
	"stripe_customer_id",
	"product_organization_id",
	"mapping_status",
	"mapping_source",
]);
const labelContext = prepared.labelRows.map((row) => {
	const organizations = byCustomer.get(row.stripe_customer_id ?? "") ?? [];
	return {
		org_id: row.org_id ?? "",
		email_domain: row.email_domain ?? "",
		stripe_customer_id: row.stripe_customer_id ?? "",
		product_organization_ids: organizations
			.map((org) => org.product_organization_id)
			.join(" | "),
		product_organization_names: organizations
			.map((org) => org.organization_name)
			.join(" | "),
		mapping_status: successfulCustomerLookups.has(row.stripe_customer_id ?? "")
			? mappingStatus(organizations.length)
			: "not_checked",
	};
});
await writeCsv(
	"account_review_context.csv",
	labelContext,
	Object.keys(labelContext[0] ?? {}),
);
await writeCsv("company_domain_coverage.csv", domainCoverage, [
	...Object.keys(prepared.companyRows[0] ?? {}),
	"matched_invoice_customers",
	"mapped_product_organizations",
	"lookup_status",
	"product_mapping_status",
]);
await writeCsv("invoice_domain_evidence.csv", invoiceMappings, [
	"email_domain",
	"stripe_customer_id",
	"last_invoice_created_at",
	"invoice_count",
	"mapping_key",
]);
await writeCsv(
	"organization_evidence.csv",
	organizationEvidence,
	Object.keys(
		organizationEvidence[0] ?? {
			product_organization_id: "",
			generation_lookup_status: "",
		},
	),
);
await writeCsv(
	"model_and_surface_mix.csv",
	modelAndSurface,
	Object.keys(
		modelAndSurface[0] ?? {
			product_organization_id: "",
			breakdown: "",
			dimension: "",
		},
	),
);

const summary = {
	companyInputRows: prepared.companyBridge.length,
	companyDomains: prepared.companyRows.length,
	duplicateCompanyEnrichmentsAvoided:
		prepared.companyBridge.length - prepared.companyRows.length,
	personInputRows: prepared.personBridge.length,
	uniquePersonEmails: prepared.personRows.length,
	duplicatePersonEnrichmentsAvoided:
		prepared.personBridge.length - prepared.personRows.length,
	humanLabelAccounts: prepared.labelRows.length,
	completedHumanLabels: prepared.labelRows.filter((row) => row.persona_label)
		.length,
	companyLookupComplete,
	companyDomainsWithInvoiceEvidence: domainCoverage.filter(
		(row) => Number(row.matched_invoice_customers) > 0,
	).length,
	checkedStripeCustomers: successfulCustomerLookups.size,
	mappedStripeCustomers: byCustomer.size,
	mappedProductOrganizations: memberships.length,
	multiOrganizationCustomers: [...byCustomer.values()].filter(
		(rows) => rows.length > 1,
	).length,
	checkedProductOrganizationsForGenerations: successfulGenerationLookups.size,
	organizationsWithCompletedGenerations: summaries.size,
	completedGenerations: organizationEvidence.reduce(
		(total, row) => total + Number(row.completed_generations || 0),
		0,
	),
	missingOrInvalidDurationGenerations: organizationEvidence.reduce(
		(total, row) =>
			total + Number(row.missing_or_invalid_duration_generations || 0),
		0,
	),
	sourceFailures: failures.length,
	clayEnrichmentRun: false,
	classificationRun: false,
};

await write(
	"README.md",
	`# Customer persona evidence (OPS-86)

This is a preparation and source-evidence pack, not a verified persona classifier. No Clay enrichment was run and no human labels were invented.

## Join keys

The supplied org_id columns are Stripe customer IDs (cus_*), not Product organization UUIDs. They are preserved unchanged. account_product_bridge.csv adds the actual Product organization ID using organizations.stripe_customer_id. One customer can map to more than one organization; do not collapse these rows without a rule.

The company input contains domains, not customer IDs. invoice_domain_evidence.csv finds those domains in Stripe invoice billing emails. This is historical billing-domain evidence, not proof of current employment or company ownership. Missing invoice evidence is not proof that the company is absent. The supplied lifetime revenue figures are preserved, not recomputed or certified here.

Company mapping searches invoices of all statuses created before the observation end. It finds accounts connected to the supplied domains, including accounts outside Matt's positive-revenue panel. This wider mapping is useful evidence, not a reproduction of his fixed revenue population. Do not attribute the supplied domain revenue to every mapped organization or treat these accounts as a new revenue cohort.

## Files

- clay_companies.csv: ${summary.companyDomains} domains. Enrich company name, industry, employee count and company type. Preserve email_domain and enrichment_key.
- clay_companies_join.csv: every original company input row with its domain and supplied revenue preserved. Joins enrichment results through enrichment_key, avoiding ${summary.duplicateCompanyEnrichmentsAvoided} duplicate domain lookup without silently adding or dropping revenue.
- clay_people_unique.csv: ${summary.uniquePersonEmails} unique full emails. Enrich professional role/title and company. Preserve enrichment_key. Match only public professional information; keep uncertain matches unknown.
- clay_people_join.csv: maps each enrichment result back to all ${summary.personInputRows} original account rows, preserving org_id and email. This avoids ${summary.duplicatePersonEnrichmentsAvoided} repeated lookups.
- human_labels.csv: the original top 100 with labels and join keys preserved. Allowed labels: ${PERSONA_LABELS.join(", ")}. Edit labels only in this file. A person who knows the account supplies the label, reviewer, evidence and notes. Leave unknown accounts blank. Resume preserves human edits and rejects changes to source keys or revenue columns. Do not supply these labels to the classifier being evaluated.
- account_review_context.csv: Product organization names and IDs for the top 100, to help the reviewer identify each customer. This generated lookup is not a second label file.
- account_product_bridge.csv: source-backed customer-to-Product mapping, with missing and one-to-many mappings visible.
- company_domain_coverage.csv: one row per input domain, including missing source evidence.
- organization_evidence.csv: current membership counts and completed-generation observations by actual Product organization ID.
- model_and_surface_mix.csv: model/surface counts and shares, keyed to the same organization ID.
- query-cache/: private, resumable source results and exact read-only SQL. Do not commit or share publicly.
- manifest.json: input/output SHA-256 hashes, source query hashes, run times, failures and summary counts.

## Meaning and limits

Generation window: [${start}, ${end}), in UTC. A generation belongs to the window when finished_at falls inside it. Only final COMPLETED, non-deleted Product records count. Duration uses output_media_length in seconds, not input video length. Missing/invalid duration is blank, counted separately and never replaced with a guessed duration. The measured window is not a claim that the upstream source is complete through its end.

Member counts are current distinct organization members, not purchased seats or historical team size. Banned, disabled, anonymous, internal and unresolved members are shown separately; those counts can overlap. Disabled users are not silently removed. These are evidence summaries for the supplied customer population, not clean-population KPI certification. Generation summaries include completed records in those organizations, without claiming every generation's author is an eligible member.

A successful source query with no matching generations means zero observed completions in the window. A failed lookup stays blank/not_checked. Mapping failure is never reported as zero members. Multiple customer IDs can map to the same organization, so aggregate organization_evidence.csv rather than summing bridge rows.

No videos, prompts, media URLs or individual membership lists were downloaded. Duration/model/surface cannot prove ads vs UGC vs film. Behavioral labels remain blank until the categories, evidence and evaluation are agreed. Mixed use and unknown must remain possible.

## Remaining gates

1. Confirm Clay workspace access, provider choices and a credit budget before uploading or running the bulk enrichment. Companies first if limited. No exact cost has been approved.
2. A customer-aware reviewer labels the top 100. This revenue-weighted sample measures top-account accuracy; it is not representative of all customers.
3. Agree behavioral categories and a limited review sample before large-scale classification. Do not change onboarding requirements as part of this work.
4. Review missing and one-to-many mappings. No arbitrary best match is selected.

All files contain private customer information. Store them securely and only share with approved recipients/providers.

## Join Clay results

Export Clay with enrichment_key and the original email_domain (companies) or email (people). Keep match status, provider, evidence URL and lookup date alongside the enriched fields. Use apps/agent/scripts/join-persona-enrichment.ts with --kind company or person, --bridge pointing to the corresponding original join CSV, --results pointing to the Clay export, and --out pointing to a new output CSV. The importer rejects unknown, duplicate or changed keys, preserves every original row, prefixes provider fields, and marks results unreviewed rather than automatically treating them as correct. Missing results remain not_returned.
`,
);
await writeFile(
	resolve(out, "manifest.json"),
	JSON.stringify(
		{
			version: 1,
			runKey,
			status: failures.length
				? "partial"
				: values.fetch
					? "completed"
					: "prepared",
			generatedAt: new Date().toISOString(),
			window: { start, endExclusive: end, timezone: "UTC" },
			inputs: inputSummary,
			summary,
			files,
			attempts,
			failures,
		},
		null,
		2,
	),
	{ mode: 0o600 },
);
console.log(JSON.stringify({ output: out, ...summary }));
if (failures.length) process.exitCode = 2;
