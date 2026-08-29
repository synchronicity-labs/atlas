import { createHash } from "node:crypto";

export type CsvRow = Record<string, string>;

export const PERSONA_LABELS = [
	"agency",
	"studio",
	"solo creator",
	"dev shop",
	"brand",
	"partner",
] as const;

export const COMPANY_ENRICHMENT_FIELDS = [
	"company_name",
	"employee_count",
	"industry",
	"company_type",
] as const;

const PRIOR_COMPANY_CONTEXT_FIELDS = [
	"monthly_traffic",
	"headcount_growth_6m_pct",
	"verified_description",
	"icp_verdict",
	"domain_quality",
	"icp_fit",
] as const;

const FORBIDDEN_PRIOR_FIELDS = new Set([
	"email",
	"sample_email",
	"person_email",
	"linkedin_url",
	"linkedin_profile",
	"persona_label",
]);

export function parseCsv(text: string): CsvRow[] {
	const records: string[][] = [];
	let record: string[] = [];
	let cell = "";
	let quoted = false;
	let closedQuote = false;
	const source = text.replace(/^\uFEFF/, "");
	for (let index = 0; index < source.length; index++) {
		const char = source[index];
		if (quoted) {
			if (char === '"' && source[index + 1] === '"') {
				cell += '"';
				index++;
			} else if (char === '"') {
				quoted = false;
				closedQuote = true;
			} else {
				cell += char;
			}
		} else if (char === '"' && cell === "" && !closedQuote) {
			quoted = true;
		} else if (char === ",") {
			record.push(cell);
			cell = "";
			closedQuote = false;
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && source[index + 1] === "\n") index++;
			record.push(cell);
			if (record.some((value) => value !== "")) records.push(record);
			record = [];
			cell = "";
			closedQuote = false;
		} else {
			if (closedQuote || char === '"') throw new Error("Invalid CSV quoting");
			cell += char;
		}
	}
	if (quoted) throw new Error("Unclosed CSV quote");
	if (cell !== "" || record.length > 0 || closedQuote) {
		record.push(cell);
		records.push(record);
	}
	const headers = records.shift();
	if (
		!headers?.length ||
		headers.some((header) => !header.trim()) ||
		new Set(headers).size !== headers.length
	) {
		throw new Error("CSV headers are missing or repeated");
	}
	return records.map((values, index) => {
		if (values.length !== headers.length) {
			throw new Error(`CSV row ${index + 2} has a different column count`);
		}
		return Object.fromEntries(
			headers.map((key, column) => [key, values[column] ?? ""]),
		);
	});
}

export function csvText(rows: CsvRow[], headers: string[]): string {
	const escapeCell = (value: string) => {
		const safe =
			/^[\t\r\n ]*[=+@-]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value)
				? `'${value}`
				: value;
		return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
	};
	return `${[
		headers,
		...rows.map((row) => headers.map((key) => row[key] ?? "")),
	]
		.map((row) => row.map(escapeCell).join(","))
		.join("\n")}\n`;
}

export function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function normalizeDomain(value: string): string {
	const domain = value.trim().toLowerCase();
	if (
		!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
			domain,
		)
	) {
		throw new Error("Invalid company domain in input");
	}
	return domain;
}

export function normalizeEmail(value: string): string {
	const email = value.trim().toLowerCase();
	const parts = email.split("@");
	if (
		parts.length !== 2 ||
		!parts[0] ||
		/\s/.test(email) ||
		[...email].some((char) => char.charCodeAt(0) < 32)
	) {
		throw new Error("Invalid person email in input");
	}
	normalizeDomain(parts[1] ?? "");
	return email;
}

export function customerId(row: CsvRow): string {
	const value = row.org_id ?? "";
	if (!/^cus_[A-Za-z0-9]+$/.test(value)) {
		throw new Error("Expected Stripe customer IDs in the input org_id column");
	}
	return value;
}

export function validateWindow(start: string, end: string): void {
	if (
		![start, end].every((value) =>
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value),
		)
	) {
		throw new Error("Use explicit ISO UTC timestamps ending in Z");
	}
	const interval = Date.parse(end) - Date.parse(start);
	if (!Number.isFinite(interval) || interval <= 0 || interval > 92 * 86400000) {
		throw new Error("The observation window must be between 0 and 92 days");
	}
	for (const value of [start, end]) {
		if (
			new Date(value).toISOString() !== value.replace(/(?<!\.\d{3})Z$/, ".000Z")
		) {
			throw new Error("Invalid UTC calendar date");
		}
	}
}

export function prepareInputs(
	companies: CsvRow[],
	people: CsvRow[],
	labels: CsvRow[],
) {
	if (!companies.length || !people.length || !labels.length)
		throw new Error("All three input files must have rows");
	for (const [rows, fields] of [
		[companies, ["email_domain", "orgs", "total_lifetime_rev"]],
		[people, ["org_id", "email", "lifetime_rev", "first_paid"]],
		[
			labels,
			["org_id", "email_domain", "lifetime_rev", "first_paid", "persona_label"],
		],
	] as const) {
		if (fields.some((field) => !Object.hasOwn(rows[0] ?? {}, field)))
			throw new Error("Input file is missing required columns");
	}
	const companyBridge: CsvRow[] = companies.map((row) => ({
		...row,
		enrichment_key: normalizeDomain(row.email_domain ?? ""),
	}));
	const companyRows: CsvRow[] = [
		...new Set(companyBridge.map((row) => row.enrichment_key ?? "")),
	].map((domain) => ({ email_domain: domain, enrichment_key: domain }));
	const emails = new Map<string, CsvRow>();
	const personBridge: CsvRow[] = people.map((row) => {
		const email = normalizeEmail(row.email ?? "");
		const enrichmentKey = `person_${hash(email).slice(0, 24)}`;
		if (!emails.has(email))
			emails.set(email, {
				enrichment_key: enrichmentKey,
				email,
				email_domain: email.split("@")[1] ?? "",
			});
		return {
			...row,
			stripe_customer_id: customerId(row),
			enrichment_key: enrichmentKey,
			email_domain: email.split("@")[1] ?? "",
		};
	});
	const labelRows: CsvRow[] = labels.map((row) => {
		customerId(row);
		normalizeDomain(row.email_domain ?? "");
		if (
			row.persona_label &&
			!PERSONA_LABELS.includes(
				row.persona_label as (typeof PERSONA_LABELS)[number],
			)
		) {
			throw new Error(
				"Unknown human persona label; do not silently replace it",
			);
		}
		return {
			...row,
			stripe_customer_id: customerId(row),
			reviewed_by: row.reviewed_by ?? "",
			evidence_url: row.evidence_url ?? "",
			review_notes: row.review_notes ?? "",
		};
	});
	for (const rows of [people, labels]) {
		if (new Set(rows.map(customerId)).size !== rows.length)
			throw new Error("Repeated customer ID within an input file");
	}
	return {
		companyRows,
		companyBridge,
		personRows: [...emails.values()],
		personBridge,
		labelRows,
	};
}

export function buildCompanyEnrichmentPlan(
	companies: CsvRow[],
	priorRows: CsvRow[],
): CsvRow[] {
	if (!companies.length)
		throw new Error("Company enrichment requires current company domains");
	const currentDomains = new Set<string>();
	for (const company of companies) {
		const domain = normalizeDomain(company.email_domain ?? "");
		if ((company.enrichment_key ?? domain) !== domain)
			throw new Error("Current company enrichment key must equal its domain");
		if (currentDomains.has(domain))
			throw new Error("Current company domain list contains duplicates");
		currentDomains.add(domain);
	}
	const priorByDomain = new Map<string, CsvRow>();
	for (const prior of priorRows) {
		for (const key of Object.keys(prior)) {
			if (key.startsWith("clay_") || FORBIDDEN_PRIOR_FIELDS.has(key))
				throw new Error("Prior company cache contains a forbidden field");
		}
		const domain = normalizeDomain(prior.email_domain ?? "");
		if (priorByDomain.has(domain))
			throw new Error("Prior company cache contains duplicate domains");
		if (
			!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
				prior.prior_source_generated_at ?? "",
			) ||
			!Number.isFinite(Date.parse(prior.prior_source_generated_at ?? "")) ||
			!/^https:\/\//.test(prior.prior_source_url ?? "")
		)
			throw new Error("Prior company cache is missing valid provenance");
		if (
			prior.employee_count &&
			(!Number.isSafeInteger(Number(prior.employee_count)) ||
				Number(prior.employee_count) < 0)
		)
			throw new Error("Prior company employee count is invalid");
		if (
			prior.company_type &&
			!["agency", "brand", "studio", "tech"].includes(prior.company_type)
		)
			throw new Error("Prior company type is outside the approved Clay labels");
		priorByDomain.set(domain, prior);
	}
	return companies.map((company) => {
		const domain = normalizeDomain(company.email_domain ?? "");
		const prior = priorByDomain.get(domain);
		const missingFields = COMPANY_ENRICHMENT_FIELDS.filter(
			(field) => !prior?.[field]?.trim(),
		);
		return {
			email_domain: domain,
			enrichment_key: domain,
			company_domain_url: `https://${domain}`,
			...Object.fromEntries(
				[...COMPANY_ENRICHMENT_FIELDS, ...PRIOR_COMPANY_CONTEXT_FIELDS].map(
					(field) => [field, prior?.[field] ?? ""],
				),
			),
			prior_enrichment_present: prior ? "true" : "false",
			prior_source_generated_at: prior?.prior_source_generated_at ?? "",
			prior_source_url: prior?.prior_source_url ?? "",
			...Object.fromEntries(
				COMPANY_ENRICHMENT_FIELDS.map((field) => [
					`need_${field}`,
					missingFields.includes(field) ? "true" : "false",
				]),
			),
			missing_company_fields: missingFields.join("|"),
		};
	});
}

export function chunks<T>(items: T[], size: number): T[][] {
	if (!Number.isInteger(size) || size <= 0)
		throw new Error("Invalid batch size");
	return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
		items.slice(index * size, (index + 1) * size),
	);
}

export function sqlLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

export function companyInvoiceMappingSql(
	domains: string[],
	end: string,
	cursor = "",
): string {
	if (!domains.length || domains.length > 10000)
		throw new Error("Company lookup requires a bounded input domain list");
	const domainList = domains.map(normalizeDomain).map(sqlLiteral).join(",");
	return `with scoped as (
		select customerId as stripe_customer_id,
			lowerUTF8(arrayElement(splitByChar('@', trimBoth(JSONExtractString(payload, 'customer_email'))), -1)) as email_domain,
			max(createdAt) as last_invoice_created_at,
			countDistinct(id) as invoice_count
		from sync_prod.sync_stripe_invoices
		where createdAt < parseDateTimeBestEffort(${sqlLiteral(end)}, 'UTC')
			and position(JSONExtractString(payload, 'customer_email'), '@') > 0
			and email_domain in (${domainList}) and startsWith(customerId, 'cus_')
		group by stripe_customer_id, email_domain
	)
	select *, concat(email_domain, '/', stripe_customer_id) as mapping_key
	from scoped where mapping_key > ${sqlLiteral(cursor)} order by mapping_key limit 500`;
}

export function productMembershipSql(ids: string[]): string {
	if (
		!ids.length ||
		ids.length > 100 ||
		ids.some((id) => !/^cus_[A-Za-z0-9]+$/.test(id))
	) {
		throw new Error(
			"Membership lookup requires 1 to 100 explicit Stripe customer IDs",
		);
	}
	return `select o.stripe_customer_id, o.id::text as product_organization_id,
		o.name as organization_name, o.plan, o.billing_version,
		o.created_at, o.first_subscribed_at, o.active as organization_active,
		count(distinct m.user_id) as member_count,
		count(distinct case when u.id is not null and not coalesce(u.banned, false)
			and not coalesce(u.is_anonymous, false)
			and lower(u.email::text) not like '%@sync.so' and lower(u.email::text) not like '%@sync.labs'
			then m.user_id end) as non_banned_non_internal_member_count,
		count(distinct case when u.banned then m.user_id end) as banned_member_count,
		count(distinct case when u.disabled then m.user_id end) as disabled_member_count,
		count(distinct case when u.is_anonymous then m.user_id end) as anonymous_member_count,
		count(distinct case when lower(u.email::text) like '%@sync.so' or lower(u.email::text) like '%@sync.labs'
			then m.user_id end) as internal_member_count,
		count(distinct case when u.id is null then m.user_id end) as unresolved_member_count
	from public.organizations o
	left join public.user_organizations m on m.organization_id = o.id
	left join auth.users u on u.id = m.user_id
	where o.stripe_customer_id in (${ids.map(sqlLiteral).join(",")})
	group by o.id, o.stripe_customer_id, o.name, o.plan, o.billing_version, o.created_at, o.first_subscribed_at, o.active
	order by o.stripe_customer_id, o.id limit 2000`;
}

export function generationEvidenceSql(
	ids: string[],
	start: string,
	end: string,
): string {
	validateWindow(start, end);
	if (
		!ids.length ||
		ids.length > 40 ||
		ids.some(
			(id) =>
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
					id,
				),
		)
	) {
		throw new Error(
			"Generation lookup requires 1 to 40 explicit Product organization UUIDs",
		);
	}
	return `with scoped as (
		select organization_id, coalesce(model_name, 'unknown') as model,
			case when source = 'studio' then 'app' when source = 'api' or (coalesce(source, '') = '' and api_key_id is not null) then 'api'
				when source like '%-plugin' then 'plugins' when source like 'mcp%' then 'mcp'
				when source = 'agent' then 'agent' else coalesce(nullif(source, ''), 'unknown') end as surface,
			output_media_length, finished_at, segments
		from public.generations
		where organization_id in (${ids.map(sqlLiteral).join(",")})
			and finished_at >= ${sqlLiteral(start)}::timestamptz and finished_at < ${sqlLiteral(end)}::timestamptz
			and status = 'COMPLETED' and deleted_at is null
	)
	select organization_id::text as product_organization_id,
		case when grouping(model) = 0 then 'model' when grouping(surface) = 0 then 'surface' else 'organization' end as breakdown,
		coalesce(model, surface, 'all') as dimension,
		count(*) as completed_generations,
		count(*) filter (where output_media_length > 0 and output_media_length < 'Infinity'::numeric) as valid_duration_generations,
		count(*) filter (where output_media_length is null or not (output_media_length > 0 and output_media_length < 'Infinity'::numeric)) as missing_or_invalid_duration_generations,
		sum(case when output_media_length > 0 and output_media_length < 'Infinity'::numeric then output_media_length end) as generated_seconds,
		avg(case when output_media_length > 0 and output_media_length < 'Infinity'::numeric then output_media_length end) as average_output_seconds,
		percentile_cont(0.5) within group (order by case when output_media_length > 0 and output_media_length < 'Infinity'::numeric then output_media_length::double precision end) as median_output_seconds,
		percentile_cont(0.9) within group (order by case when output_media_length > 0 and output_media_length < 'Infinity'::numeric then output_media_length::double precision end) as p90_output_seconds,
		count(*) filter (where segments is not null and segments <> '[]'::jsonb and segments <> 'null'::jsonb) as generations_with_segments,
		min(finished_at) as first_completion_in_window, max(finished_at) as last_completion_in_window
	from scoped group by grouping sets ((organization_id), (organization_id, model), (organization_id, surface))
	order by organization_id, breakdown, dimension limit 2000`;
}

export function mappingStatus(count: number): string {
	return count === 0
		? "unmapped"
		: count === 1
			? "one_product_org"
			: "multiple_product_orgs";
}

export function validateGenerationEvidence(
	rows: readonly CsvRow[],
	organizationIds: readonly string[],
): void {
	const scope = new Set(organizationIds);
	const groups = new Map<string, CsvRow[]>();
	const keys = new Set<string>();
	for (const row of rows) {
		const id = row.product_organization_id ?? "";
		if (
			!scope.has(id) ||
			!["organization", "model", "surface"].includes(row.breakdown ?? "")
		) {
			throw new Error(
				"Generation evidence returned an unexpected organization or breakdown",
			);
		}
		const key = JSON.stringify([id, row.breakdown, row.dimension]);
		if (keys.has(key))
			throw new Error("Generation evidence returned a repeated aggregate");
		keys.add(key);
		const count = Number(row.completed_generations);
		const valid = Number(row.valid_duration_generations);
		const missing = Number(row.missing_or_invalid_duration_generations);
		const segments = Number(row.generations_with_segments);
		if (
			[count, valid, missing, segments].some(
				(value) => !Number.isSafeInteger(value) || value < 0,
			) ||
			count < 1 ||
			valid + missing !== count ||
			segments > count
		) {
			throw new Error("Generation counts do not reconcile");
		}
		for (const field of [
			"generated_seconds",
			"average_output_seconds",
			"median_output_seconds",
			"p90_output_seconds",
		]) {
			if (
				valid > 0
					? !row[field] ||
						!Number.isFinite(Number(row[field])) ||
						Number(row[field]) <= 0
					: Boolean(row[field])
			) {
				throw new Error("Generation duration evidence is missing or invalid");
			}
		}
		groups.set(id, [...(groups.get(id) ?? []), row]);
	}
	for (const group of groups.values()) {
		const summaries = group.filter((row) => row.breakdown === "organization");
		if (summaries.length !== 1)
			throw new Error("Generation breakdown is missing its organization total");
		const total = summaries[0];
		for (const breakdown of ["model", "surface"]) {
			const parts = group.filter((row) => row.breakdown === breakdown);
			if (!parts.length)
				throw new Error("Generation evidence is missing a breakdown");
			for (const field of [
				"completed_generations",
				"valid_duration_generations",
				"missing_or_invalid_duration_generations",
				"generations_with_segments",
			]) {
				if (
					parts.reduce((sum, row) => sum + Number(row[field]), 0) !==
					Number(total?.[field])
				) {
					throw new Error(
						"Generation breakdown does not reconcile to its organization total",
					);
				}
			}
			const seconds = parts.reduce(
				(sum, row) => sum + Number(row.generated_seconds || 0),
				0,
			);
			if (
				Math.abs(seconds - Number(total?.generated_seconds || 0)) >
				Math.max(0.000001, seconds * 1e-9)
			) {
				throw new Error("Generation duration breakdown does not reconcile");
			}
		}
	}
}

export function joinEnrichmentResults(
	bridge: CsvRow[],
	results: CsvRow[],
	kind: "company" | "person",
): CsvRow[] {
	if (!bridge.length || bridge.some((row) => !row.enrichment_key))
		throw new Error("Missing enrichment keys in the original join file");
	if (
		bridge.some((row) =>
			Object.keys(row).some((key) => key.startsWith("clay_")),
		)
	)
		throw new Error(
			"Use the original join file, not a previously enriched output",
		);
	const allowed = new Set(bridge.map((row) => row.enrichment_key));
	const byKey = new Map<string, CsvRow>();
	for (const result of results) {
		const key = result.enrichment_key ?? "";
		if (!allowed.has(key))
			throw new Error("Clay returned an unknown or missing enrichment key");
		if (byKey.has(key))
			throw new Error(
				"Clay returned multiple results for one enrichment key; review the match before joining",
			);
		if (
			kind === "company" &&
			normalizeDomain(result.email_domain ?? "") !== key
		)
			throw new Error("Clay changed the company domain join key");
		if (
			kind === "person" &&
			`person_${hash(normalizeEmail(result.email ?? "")).slice(0, 24)}` !== key
		)
			throw new Error("Clay changed the person email join key");
		byKey.set(key, result);
	}
	return bridge.map((original) => {
		const result = byKey.get(original.enrichment_key ?? "");
		return {
			...original,
			clay_result_present: result ? "true" : "false",
			clay_review_status: result ? "unreviewed" : "not_returned",
			...Object.fromEntries(
				Object.entries(result ?? {})
					.filter(
						([key]) =>
							!["enrichment_key", "email", "email_domain"].includes(key),
					)
					.map(([key, value]) => [`clay_field_${key}`, value]),
			),
		};
	});
}

const CLAY_COMPANY_FIELDS = {
	company_name: "clay_field_Name",
	employee_count: "clay_field_Employee Count",
	industry: "clay_field_Industry",
} as const;

export type CompanyEnrichmentSummary = {
	inputRows: number;
	uniqueKeys: number;
	clayMatches: number;
	clayNotFound: number;
	fullyEnrichedCore: number;
	companyTypePending: number;
	coverage: Record<string, number>;
	sources: Record<string, Record<string, number>>;
};

export function finalizeCompanyEnrichment(rows: CsvRow[]): {
	rows: CsvRow[];
	summary: CompanyEnrichmentSummary;
} {
	if (!rows.length) throw new Error("Company enrichment output has no rows");
	const required = [
		"email_domain",
		"enrichment_key",
		"company_name",
		"employee_count",
		"industry",
		"company_type",
		"clay_field_Enrich company",
		...Object.values(CLAY_COMPANY_FIELDS),
	];
	if (required.some((field) => !Object.hasOwn(rows[0] ?? {}, field)))
		throw new Error("Company enrichment output is missing required fields");
	const keys = new Set<string>();
	let clayMatches = 0;
	let clayNotFound = 0;
	const finalized = rows.map((row) => {
		const domain = normalizeDomain(row.email_domain ?? "");
		if ((row.enrichment_key ?? "") !== domain || keys.has(domain))
			throw new Error(
				"Company enrichment output has an invalid or repeated key",
			);
		keys.add(domain);
		if (row.company_type?.trim())
			throw new Error(
				"Company type needs the separate approved classification",
			);
		const clayMatchValue = row["clay_field_Enrich company"]?.trim() ?? "";
		const clayName = row[CLAY_COMPANY_FIELDS.company_name]?.trim() ?? "";
		const companyMatchStatus =
			clayMatchValue === "❌ Company Not Found" ? "not_found" : "matched";
		if (
			(companyMatchStatus === "matched" && (!clayMatchValue || !clayName)) ||
			(companyMatchStatus === "not_found" && clayName)
		)
			throw new Error("Clay company match result is inconsistent");
		if (companyMatchStatus === "matched") clayMatches++;
		else clayNotFound++;
		const value = (field: keyof typeof CLAY_COMPANY_FIELDS) => {
			const prior = row[field]?.trim() ?? "";
			const clay = row[CLAY_COMPANY_FIELDS[field]]?.trim() ?? "";
			return {
				value: prior || (companyMatchStatus === "matched" ? clay : ""),
				source: prior
					? "prior_sheet"
					: companyMatchStatus === "matched" && clay
						? "clay"
						: "",
			};
		};
		const companyName = value("company_name");
		const employeeCount = value("employee_count");
		const industry = value("industry");
		if (
			employeeCount.value &&
			(!/^\d+$/.test(employeeCount.value) ||
				!Number.isSafeInteger(Number(employeeCount.value)))
		)
			throw new Error("Company employee count is invalid");
		return {
			email_domain: domain,
			enrichment_key: domain,
			company_name: companyName.value,
			employee_count: employeeCount.value,
			industry: industry.value,
			company_type: "",
			company_name_source: companyName.source,
			employee_count_source: employeeCount.source,
			industry_source: industry.source,
			company_type_status: "not_classified",
			company_match_status: companyMatchStatus,
			company_match_review_status:
				companyMatchStatus === "matched" ? "unreviewed" : "not_applicable",
		};
	});
	const fields = ["company_name", "employee_count", "industry"] as const;
	const sourceFields = {
		company_name: "company_name_source",
		employee_count: "employee_count_source",
		industry: "industry_source",
	} as const;
	const coverage = Object.fromEntries(
		fields.map((field) => [
			field,
			finalized.filter((row) => Boolean(row[field])).length,
		]),
	);
	const sources = Object.fromEntries(
		fields.map((field) => {
			const sourceField = sourceFields[field];
			return [
				field,
				Object.fromEntries(
					["prior_sheet", "clay", "missing"].map((source) => [
						source,
						finalized.filter((row) =>
							source === "missing"
								? !row[sourceField]
								: row[sourceField] === source,
						).length,
					]),
				),
			];
		}),
	);
	return {
		rows: finalized,
		summary: {
			inputRows: rows.length,
			uniqueKeys: keys.size,
			clayMatches,
			clayNotFound,
			fullyEnrichedCore: finalized.filter((row) =>
				fields.every((field) => Boolean(row[field])),
			).length,
			companyTypePending: finalized.length,
			coverage,
			sources,
		},
	};
}
