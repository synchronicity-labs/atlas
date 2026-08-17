export type CatalogKind =
	| "KPI"
	| "VIEW"
	| "DIAGNOSTIC"
	| "ROADMAP_MEASURE"
	| "UNCLASSIFIED";

export type CatalogReadinessHint =
	| "CATALOGED"
	| "NEEDS_DEFINITION"
	| "NEEDS_SOURCE"
	| "NEEDS_EVIDENCE"
	| "READY_TO_IMPLEMENT";

export type CatalogAmbiguity = {
	key: string;
	label: string;
};

export type CatalogSheet = {
	id: number;
	title: string;
	index: number;
	rows: unknown[][];
};

export type CatalogCandidate = {
	externalKey: string;
	sourceTabId: number;
	sourceTabName: string;
	sourceTabIndex: number;
	sourceRange: string;
	sourceRow: number;
	title: string;
	description: string | null;
	ownerTeam: string | null;
	sourceHint: string | null;
	trackability: string | null;
	kind: CatalogKind;
	readinessHint: CatalogReadinessHint;
	rawRow: string[];
	ambiguities: CatalogAmbiguity[];
};

const TYPE_PATTERN = /^(primary|input|lagging|guardrail|view)$/i;
const TAG_PATTERN =
	/\[(primary|input|lagging|guardrail|view|analysis|diagnostic)\]/i;
const SECTION_PATTERN =
	/^(gtm|sales|marketing|customer success(?: \(enterprise\))?|cs|productions|engineering|research|operations|people ops|finance|legal|physical operations|platform|ml)$/i;
const CONNECTED_SOURCE_PATTERN =
	/\b(ga4|google analytics|posthog|metabase|tinybird|stripe|hubspot|search console|postgres|database|data warehouse)\b/i;

function text(value: unknown): string {
	if (value === null || value === undefined) return "";
	return String(value).replace(/\s+/g, " ").trim();
}

function rowValues(row: unknown[]): string[] {
	const values = row.map(text);
	while (values.at(-1) === "") values.pop();
	return values;
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(TAG_PATTERN, "$1")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 120);
}

function kindFrom(type: string, title: string): CatalogKind {
	const normalized = type.toLowerCase();
	if (normalized === "view" || /^\s*↳/.test(title)) return "VIEW";
	if (/^(primary|input|lagging|guardrail)$/.test(normalized)) return "KPI";
	if (/^(analysis|diagnostic)$/.test(normalized)) return "DIAGNOSTIC";
	if (/diagnostic|analysis|breakdown/i.test(title)) return "DIAGNOSTIC";
	return "UNCLASSIFIED";
}

function titleFrom(values: string[]): string | null {
	const taggedIndex = values.findIndex((value) => TAG_PATTERN.test(value));
	if (taggedIndex >= 0) {
		const tagged = values[taggedIndex] ?? "";
		const inline = tagged
			.replace(TAG_PATTERN, "")
			.replace(/^\s*[-:–—]+/, "")
			.trim();
		if (inline) return inline;
		const after = values.slice(taggedIndex + 1).find(isPossibleTitle);
		if (after) return after;
	}

	const typeIndex = values.findIndex((value) => TYPE_PATTERN.test(value));
	if (typeIndex >= 0) {
		const after = values.slice(typeIndex + 1).find(isPossibleTitle);
		if (after) return after;
	}

	return values.find(isPossibleTitle) ?? null;
}

function isPossibleTitle(value: string): boolean {
	if (!value || TYPE_PATTERN.test(value) || SECTION_PATTERN.test(value))
		return false;
	if (/^https?:\/\//i.test(value)) return false;
	if (/^[\d.,$%+-]+$/.test(value)) return false;
	return value.length >= 3 && value.length <= 180;
}

function descriptionFrom(values: string[], title: string): string | null {
	const candidate = values.find(
		(value) =>
			value !== title &&
			!TYPE_PATTERN.test(value) &&
			!/^https?:\/\//i.test(value) &&
			value.length > Math.max(24, title.length),
	);
	return candidate ?? null;
}

function ambiguitiesFor(title: string, description: string | null) {
	const value = `${title} ${description ?? ""}`.toLowerCase();
	const ambiguities: CatalogAmbiguity[] = [];
	const isBurnAndRunway = /\bnet burn\b|\brunway\b/.test(value);
	if (isBurnAndRunway) {
		ambiguities.push({
			key: "burn_and_runway_basis",
			label:
				"Decide which cash accounts count toward runway, what to leave out of net burn (financing and transfers between our own accounts), and whether runway uses last month, the last 3 months, or Finance's forecast.",
		});
	}
	if (
		/\b(sows?|msas?)\b.*\bsigned\b|\bsigned\b.*\b(sows?|msas?)\b/.test(value)
	) {
		ambiguities.push({
			key: "signed_document_event",
			label:
				"Confirm which document and signature event counts, its effective date, and deduplication rule.",
		});
	}
	if (
		/\b(breakdown|classification|classified|segment(?:ation)?)\b/.test(value)
	) {
		ambiguities.push({
			key: "classification_dimensions",
			label:
				"Confirm the categories, classification rules, and which records can remain unclassified.",
		});
	}
	if (/\bnew logos?\b/.test(value)) {
		ambiguities.push({
			key: "new_logo_identity",
			label:
				"Confirm the canonical company identity, close event, segment source, and duplicate-account rule.",
		});
	}
	if (/\benterprise usage\b/.test(value)) {
		ambiguities.push({
			key: "enterprise_usage_contract",
			label:
				"Confirm the account join, usage unit, commitment basis, contract window, and comparison method.",
		});
	}
	if (/\bmanual health|qualitative read|health check\b/.test(value)) {
		ambiguities.push({
			key: "qualitative_health_scale",
			label:
				"Confirm the health scale, required evidence, scoring owner, and update cadence before automating it.",
		});
	}
	if (
		/\bhuman qc\b|\bhuman readable pattern\b|\bfailure case\b|\bpipeline failure\b/.test(
			value,
		)
	) {
		ambiguities.push({
			key: "failure_taxonomy_ground_truth",
			label:
				"Confirm the failure taxonomy, ground-truth label, evaluation set, and acceptance threshold.",
		});
	}
	if (/\b(active|activated|professional|used)\b/.test(value)) {
		ambiguities.push({
			key: "qualifying_event",
			label: "Confirm the entity, qualifying event, threshold, and window.",
		});
	}
	if (/\b(user|org|organization|team|logo|customer|payer)\b/.test(value)) {
		ambiguities.push({
			key: "identity_and_population",
			label:
				"Confirm identity joins, eligibility, exclusions, and deduplication.",
		});
	}
	if (
		!isBurnAndRunway &&
		/\b(revenue|arr|run rate|margin|ndr|cac|paid|booked|cash|accrued)\b/.test(
			value,
		)
	) {
		ambiguities.push({
			key: "economic_basis",
			label:
				"Confirm the economic event, amount basis, timestamp, and adjustments.",
		});
	}
	if (
		/\b(conversion|retention|returning|requalification|churn)\b/.test(value)
	) {
		ambiguities.push({
			key: "cohort_and_denominator",
			label:
				"Confirm cohort entry, numerator, denominator, and observation window.",
		});
	}
	if (
		/\b(quality|success|completion|turnaround|time spent|iterations?)\b/.test(
			value,
		)
	) {
		ambiguities.push({
			key: "outcome_and_clock",
			label:
				"Confirm the qualifying outcome, clock boundaries, retries, and pauses.",
		});
	}
	return ambiguities;
}

function readinessHint(
	kind: CatalogKind,
	sourceHint: string | null,
	trackability: string | null,
	ambiguities: CatalogAmbiguity[],
): CatalogReadinessHint {
	if (ambiguities.length > 0) return "NEEDS_DEFINITION";
	if (kind === "VIEW") return "CATALOGED";
	const source = sourceHint?.toLowerCase() ?? "";
	const availability = trackability?.toLowerCase() ?? "";
	if (
		!source ||
		/\bmanual\b/.test(source) ||
		/\b(not yet|no|barely|partial(?:ly)?)\b/.test(availability)
	) {
		return "NEEDS_SOURCE";
	}
	if (!CONNECTED_SOURCE_PATTERN.test(source)) return "NEEDS_SOURCE";
	return "READY_TO_IMPLEMENT";
}

function candidatesFromKpiSheet(sheet: CatalogSheet): CatalogCandidate[] {
	const headers = rowValues(sheet.rows[0] ?? []).map((value) =>
		value.toLowerCase(),
	);
	const sourceColumn = headers.indexOf("source");
	const trackabilityColumn = headers.findIndex((value) =>
		value.startsWith("trackable today"),
	);
	let inheritedOwner: string | null = null;
	const occurrences = new Map<string, number>();
	const candidates: CatalogCandidate[] = [];

	for (const [index, raw] of sheet.rows.entries()) {
		const values = rowValues(raw);
		if (values.length === 0 || index === 0) continue;
		const domain = values[0] ?? "";
		const title = values[1]?.trim() ?? "";
		const type = values[2]?.trim() ?? "";
		const description = values[3]?.trim() || null;

		if (domain && !SECTION_PATTERN.test(domain) && title)
			inheritedOwner = domain;
		if (domain && SECTION_PATTERN.test(domain)) inheritedOwner = domain;
		if (!title || /^https?:\/\//i.test(title) || SECTION_PATTERN.test(title)) {
			continue;
		}
		if (!type && !/^\s*↳/.test(title) && !inheritedOwner) continue;

		const cleanTitle = title.replace(/^\s*↳\s*/, "").trim();
		if (!cleanTitle) continue;
		const sourceHint =
			sourceColumn >= 0 ? text(raw[sourceColumn]) || null : null;
		const trackability =
			trackabilityColumn >= 0 ? text(raw[trackabilityColumn]) || null : null;
		const kind = !type && !domain ? "VIEW" : kindFrom(type, title);
		const ambiguities = ambiguitiesFor(cleanTitle, description);
		const base = `${sheet.id}:${slug(cleanTitle) || `row-${index + 1}`}`;
		const occurrence = (occurrences.get(base) ?? 0) + 1;
		occurrences.set(base, occurrence);
		candidates.push({
			externalKey: `${base}:${occurrence}`,
			sourceTabId: sheet.id,
			sourceTabName: sheet.title,
			sourceTabIndex: sheet.index,
			sourceRange: `A${index + 1}:AE${index + 1}`,
			sourceRow: index + 1,
			title: cleanTitle,
			description,
			ownerTeam: domain || inheritedOwner,
			sourceHint,
			trackability,
			kind,
			readinessHint: readinessHint(kind, sourceHint, trackability, ambiguities),
			rawRow: values,
			ambiguities,
		});
	}
	return candidates;
}

function candidatesFromTeamSheet(sheet: CatalogSheet): CatalogCandidate[] {
	const headerIndex = sheet.rows.findIndex((raw) =>
		rowValues(raw).some((value) =>
			/^(q3\s+)?success criteria\s*$|^milestone\s+\d+$/i.test(value),
		),
	);
	const headers =
		headerIndex >= 0 ? rowValues(sheet.rows[headerIndex] ?? []) : [];
	const successColumn = headers.findIndex((value) =>
		/^(q3\s+)?success criteria\s*$/i.test(value),
	);
	const measureColumn =
		successColumn >= 0
			? successColumn
			: headers.findIndex((value) => /^milestone\s+\d+$/i.test(value));
	const secondaryTitleColumn = headers.findIndex((value) =>
		/^(sub initiative|workstream)$/i.test(value),
	);
	const occurrences = new Map<string, number>();
	const candidates: CatalogCandidate[] = [];
	let inheritedInitiative = "";

	for (const [index, raw] of sheet.rows.entries()) {
		if (index === headerIndex) continue;
		const values = rowValues(raw);
		if (values.length === 0) continue;
		if (values[0]) inheritedInitiative = values[0];
		const combined = values.join(" ");
		const tag = TAG_PATTERN.exec(combined)?.[1] ?? null;
		if (!tag) continue;
		const success = measureColumn >= 0 ? text(raw[measureColumn]) : "";
		const taggedTitle = titleFrom(values);
		const secondaryTitle =
			secondaryTitleColumn >= 0 ? text(raw[secondaryTitleColumn]) : "";
		const contextTitle = [inheritedInitiative, secondaryTitle]
			.filter(Boolean)
			.join(" — ");
		const title = taggedTitle || contextTitle || success;
		if (!title) continue;
		const description = success || descriptionFrom(values, title);
		const kind = kindFrom(tag, combined);
		const ambiguities = ambiguitiesFor(title, description);
		const base = `${sheet.id}:${slug(title) || `row-${index + 1}`}`;
		const occurrence = (occurrences.get(base) ?? 0) + 1;
		occurrences.set(base, occurrence);
		candidates.push({
			externalKey: `${base}:${occurrence}`,
			sourceTabId: sheet.id,
			sourceTabName: sheet.title,
			sourceTabIndex: sheet.index,
			sourceRange: `A${index + 1}:AE${index + 1}`,
			sourceRow: index + 1,
			title,
			description,
			ownerTeam: sheet.title,
			sourceHint: null,
			trackability: null,
			kind,
			readinessHint: readinessHint(kind, null, null, ambiguities),
			rawRow: values,
			ambiguities,
		});
	}
	return candidates;
}

export function catalogCandidates(sheets: CatalogSheet[]): CatalogCandidate[] {
	return sheets.flatMap((sheet) =>
		sheet.title.toLowerCase() === "kpis"
			? candidatesFromKpiSheet(sheet)
			: candidatesFromTeamSheet(sheet),
	);
}

export function normalizedMetricName(value: string): string {
	return value
		.toLowerCase()
		.replace(/^\s*[%$#]+\s*/, "")
		.replace(/^of\s+/, "")
		.replace(/\bmonthly\b/g, "")
		.replace(/\baverage\b|\bavg\b/g, "")
		.replace(/\borganizations?\b/g, "org")
		.replace(/\bprofessional-org\b/g, "professional org")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
