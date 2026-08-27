import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { astVisitor, locationOf, parse } from "pgsql-ast-parser";
import { MetabaseClient } from "./metabase.client";
import { metabaseConfig } from "./metabase.config";

export function compactEligibilityQuery(): string {
	return `select
  u.id::text as user_id,
  lower(coalesce(u.email, '')) as email,
  lower(coalesce(uo.role, '')) as membership_role,
  o.id::text as organization_id,
  o.stripe_customer_id::text as customer_id,
  count(*) over()::bigint as source_row_count
from auth.users u
left join public.user_organizations uo on uo.user_id = u.id
left join public.organizations o on o.id = uo.organization_id
where lower(coalesce(u.email, '')) like '%@sync.so'
  or lower(coalesce(u.email, '')) like '%@sync.labs'
order by u.id, o.id
limit 2000`;
}

const USER_TABLES = [
	"sync_prod.sync_usage3",
	"sync_prod.sync_usage_integration_tts",
	"sync_prod.sync_usage_integration_dubbing",
] as const;

const ORGANIZATION_TABLES = [
	"sync_prod.sync_stripe_invoice_items",
	"sync_prod.sync_stripe_invoices",
	"sync_prod.sync_stripe_invoices_paid",
	"sync_prod.sync_stripe_invoices_pipe",
	"sync_prod.sync_stripe_subscriptions_with_plan",
	"sync_prod.sync_stripe_payments",
	"sync_prod.sync_stripe_subscription_cancellations",
] as const;

const CUSTOMER_TABLES = ["sync_prod.paid_customer_monthly_revenue"] as const;

export type TinybirdEligibilitySnapshot = {
	capturedAt: Date;
	contentHash: string;
	excludedUserIds: string[];
	excludedOrganizationIds: string[];
	excludedCustomerIds: string[];
	complete: boolean;
	sourceRows: number;
	returnedRows: number;
	scope: "ALL_IDENTITIES" | "SUBSCRIBED_ORGANIZATIONS";
	policy: "PRODUCT_ACTIVITY" | "MONEY";
};

export type GovernedTinybirdQuery = {
	queryText: string;
	applied: boolean;
	eligibility: {
		capturedAt: string;
		contentHash: string;
		excludedUsers: number;
		excludedOrganizations: number;
		excludedCustomers: number;
		complete: boolean;
		sourceRows: number;
		returnedRows: number;
		scope?: "ALL_IDENTITIES" | "SUBSCRIBED_ORGANIZATIONS";
		policy?: "PRODUCT_ACTIVITY" | "MONEY";
		enforcement?: "POSTGRES_LIVE_JOIN" | "TINYBIRD_ID_EXCLUSIONS";
		limitation?: "BANNED_NEVER_SUBSCRIBED_JOIN_REQUIRED";
	};
};

export type EligibilityRow = {
	userId: string;
	email: string;
	banned: boolean;
	disabled: boolean;
	isAnonymous: boolean;
	membershipRole: string;
	organizationId: string;
	customerId: string;
	hasSubscribed: boolean;
};

@Injectable()
export class TinybirdEligibilityService {
	private readonly baseCache = new Map<
		string,
		{
			expiresAt: number;
			capturedAt: Date;
			sourceRows: number;
			rows: EligibilityRow[];
		}
	>();

	async current(): Promise<TinybirdEligibilitySnapshot> {
		return this.load("ALL_IDENTITIES", "PRODUCT_ACTIVITY");
	}

	async currentForPaidActivity(): Promise<TinybirdEligibilitySnapshot> {
		return this.load("SUBSCRIBED_ORGANIZATIONS", "PRODUCT_ACTIVITY");
	}

	async currentForRevenue(): Promise<TinybirdEligibilitySnapshot> {
		return this.load("SUBSCRIBED_ORGANIZATIONS", "MONEY");
	}

	private async load(
		scope: TinybirdEligibilitySnapshot["scope"],
		policy: TinybirdEligibilitySnapshot["policy"],
	): Promise<TinybirdEligibilitySnapshot> {
		const base = await this.baseRows();
		return buildTinybirdEligibility(
			base.rows,
			base.capturedAt,
			base.sourceRows,
			scope,
			policy,
		);
	}

	private async baseRows() {
		const cacheKey = "compact-internal-exclusions";
		const cached = this.baseCache.get(cacheKey);
		if (cached && cached.expiresAt > Date.now()) {
			return cached;
		}
		const config = metabaseConfig();
		if (!config) throw new Error("Metabase is not configured.");
		const result = await new MetabaseClient(config).preview({
			language: "SQL",
			queryText: compactEligibilityQuery(),
			databaseExternalId: "34",
		});
		const rows = result.rows.map((values) =>
			Object.fromEntries(
				result.columns.map((column, index) => [
					column.name,
					values[index] ?? null,
				]),
			),
		);
		const sourceRows = number(rows[0]?.source_row_count, rows.length);
		const capturedAt = new Date();
		const value = {
			expiresAt: Date.now() + 5 * 60 * 1000,
			capturedAt,
			sourceRows,
			rows: rows.map((row) => ({
				userId: text(row.user_id),
				email: text(row.email),
				banned: false,
				disabled: false,
				isAnonymous: false,
				membershipRole: text(row.membership_role),
				organizationId: text(row.organization_id),
				customerId: text(row.customer_id),
				hasSubscribed: false,
			})),
		};
		this.baseCache.set(cacheKey, value);
		return value;
	}

	govern(
		queryText: string,
		databaseExternalId: string | null,
		eligibility: TinybirdEligibilitySnapshot,
	): GovernedTinybirdQuery {
		return governTinybirdQuery(queryText, databaseExternalId, eligibility);
	}
}

export function buildTinybirdEligibility(
	rows: EligibilityRow[],
	capturedAt: Date,
	sourceRows = rows.length,
	scope: TinybirdEligibilitySnapshot["scope"] = "ALL_IDENTITIES",
	policy: TinybirdEligibilitySnapshot["policy"] = scope ===
	"SUBSCRIBED_ORGANIZATIONS"
		? "MONEY"
		: "PRODUCT_ACTIVITY",
): TinybirdEligibilitySnapshot {
	const subscribedByUser = new Map<string, boolean>();
	for (const row of rows) {
		subscribedByUser.set(
			row.userId,
			Boolean(subscribedByUser.get(row.userId)) || row.hasSubscribed,
		);
	}
	const excludedUserIds = sortedUnique(
		rows
			.filter((row) =>
				isIneligible(row, policy, Boolean(subscribedByUser.get(row.userId))),
			)
			.map((row) => row.userId),
	);
	const ownerRows = rows.filter(
		(row) =>
			isIneligible(row, policy, Boolean(subscribedByUser.get(row.userId))) &&
			(row.membershipRole === "owner" || row.membershipRole === ""),
	);
	const excludedOrganizationIds = sortedUnique(
		ownerRows.map((row) => row.organizationId),
	);
	const excludedCustomerIds = sortedUnique(
		ownerRows.map((row) => row.customerId),
	);
	const payload = {
		excludedUserIds,
		excludedOrganizationIds,
		excludedCustomerIds,
		complete: sourceRows === rows.length,
		sourceRows,
		returnedRows: rows.length,
		scope,
		policy,
	};
	return {
		capturedAt,
		contentHash: createHash("sha256")
			.update(JSON.stringify(payload))
			.digest("hex"),
		...payload,
	};
}

export function governTinybirdQuery(
	queryText: string,
	databaseExternalId: string | null,
	eligibility: TinybirdEligibilitySnapshot,
): GovernedTinybirdQuery {
	if (databaseExternalId === "34") {
		const governed = governProductPostgresQuery(queryText, eligibility.policy);
		return {
			queryText: governed.queryText,
			applied: governed.applied,
			eligibility: {
				...eligibilityEvidence(eligibility),
				complete: governed.applied,
				enforcement: "POSTGRES_LIVE_JOIN",
			},
		};
	}
	if (databaseExternalId !== "166" || !eligibility.complete) {
		return {
			queryText,
			applied: false,
			eligibility: eligibilityEvidence(eligibility),
		};
	}
	let governed = queryText;
	let applied = false;
	for (const table of USER_TABLES) {
		const result = wrapTable(
			governed,
			table,
			userPredicate(
				eligibility.excludedUserIds,
				eligibility.excludedOrganizationIds,
			),
		);
		governed = result.queryText;
		applied ||= result.applied;
	}
	for (const table of ORGANIZATION_TABLES) {
		const result = wrapTable(
			governed,
			table,
			knownExclusionPredicate(
				'"organizationId"',
				eligibility.excludedOrganizationIds,
			),
		);
		governed = result.queryText;
		applied ||= result.applied;
	}
	for (const table of CUSTOMER_TABLES) {
		const result = wrapTable(
			governed,
			table,
			knownExclusionPredicate("customer_id", eligibility.excludedCustomerIds),
		);
		governed = result.queryText;
		applied ||= result.applied;
	}
	const requiresBannedNeverSubscribedJoin =
		eligibility.policy === "PRODUCT_ACTIVITY" &&
		!hasSubscribedPopulation(queryText);
	return {
		queryText: governed,
		applied,
		eligibility: eligibilityEvidence(
			eligibility,
			requiresBannedNeverSubscribedJoin
				? "BANNED_NEVER_SUBSCRIBED_JOIN_REQUIRED"
				: undefined,
		),
	};
}

export function governProductPostgresQuery(
	queryText: string,
	policy: TinybirdEligibilitySnapshot["policy"],
): { queryText: string; applied: boolean } {
	if (hasEmbeddedProductPopulation(queryText)) {
		const normalized = normalizeEmbeddedProductPopulation(queryText, policy);
		return {
			queryText:
				policy === "PRODUCT_ACTIVITY"
					? prependPostgresCommonTableExpressions(normalized, [
							subscribedUserPopulation(),
						])
					: normalized,
			applied: true,
		};
	}
	const rewritten = rewriteProductTables(
		normalizeEmbeddedProductPopulation(queryText, policy),
	);
	if (!rewritten || rewritten.tables.size === 0) {
		return { queryText, applied: false };
	}
	const usesGenerations = rewritten.tables.has("generations");
	const usesFeedback = rewritten.tables.has("generation_feedback");
	const usesScores = rewritten.tables.has("generation_score");
	const usesOrganizations = rewritten.tables.has("organizations");
	const organizationCohortTables = [
		"organization_features",
		"org_movement_months",
	].filter((table) => rewritten.tables.has(table));

	const commonTableExpressions =
		policy === "PRODUCT_ACTIVITY" ? [subscribedUserPopulation()] : [];
	if (usesOrganizations || organizationCohortTables.length > 0) {
		commonTableExpressions.push(productOrganizationPopulation(policy));
	}
	if (usesGenerations) {
		commonTableExpressions.push(productGenerationPopulation(policy));
	}
	if (usesFeedback) {
		commonTableExpressions.push(
			productGenerationPopulation(policy, "generation_feedback"),
		);
	}
	if (usesScores) {
		commonTableExpressions.push(
			productGenerationPopulation(policy, "generation_score"),
		);
	}
	for (const table of organizationCohortTables) {
		commonTableExpressions.push(`atlas_population_${table} as (
	select atlas_cohort.*
	from public.${table} atlas_cohort
	where exists (
		select 1 from atlas_population_organizations atlas_eligible_org
		where atlas_eligible_org.id = atlas_cohort.organization_id
	)
)`);
	}

	return {
		queryText: prependPostgresCommonTableExpressions(
			rewritten.queryText,
			commonTableExpressions,
		),
		applied: true,
	};
}

function hasEmbeddedProductPopulation(queryText: string): boolean {
	const normalized = queryText.toLowerCase();
	return (
		/\bclean_users\s+as\s*\(/.test(normalized) &&
		/\bfrom\s+auth\.users\b/.test(normalized) &&
		/\bjoin\s+clean_users\b/.test(normalized) &&
		normalized.includes("is_anonymous") &&
		normalized.includes("@sync.so") &&
		normalized.includes("@sync.labs")
	);
}

function isIneligible(
	row: EligibilityRow,
	policy: TinybirdEligibilitySnapshot["policy"],
	hasSubscribed: boolean,
): boolean {
	const internal =
		row.email.endsWith("@sync.so") || row.email.endsWith("@sync.labs");
	if (internal) return true;
	return policy === "PRODUCT_ACTIVITY" && row.banned && !hasSubscribed;
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort();
}

function userPredicate(userIds: string[], organizationIds: string[]): string {
	const knownUser = knownExclusionPredicate('"userId"', userIds);
	const knownOrganization = knownExclusionPredicate(
		'"organizationId"',
		organizationIds,
	);
	return `(("userId" is null or "userId" = '' or ${knownUser}) and ${knownOrganization})`;
}

function eligibilityEvidence(
	eligibility: TinybirdEligibilitySnapshot,
	limitation?: "BANNED_NEVER_SUBSCRIBED_JOIN_REQUIRED",
) {
	return {
		capturedAt: eligibility.capturedAt.toISOString(),
		contentHash: eligibility.contentHash,
		excludedUsers: eligibility.excludedUserIds.length,
		excludedOrganizations: eligibility.excludedOrganizationIds.length,
		excludedCustomers: eligibility.excludedCustomerIds.length,
		complete: eligibility.complete && !limitation,
		sourceRows: eligibility.sourceRows,
		returnedRows: eligibility.returnedRows,
		scope: eligibility.scope,
		policy: eligibility.policy,
		enforcement: "TINYBIRD_ID_EXCLUSIONS" as const,
		...(limitation ? { limitation } : {}),
	};
}

function subscribedUserPopulation(): string {
	return `atlas_subscribed_users as (
	select distinct atlas_population_membership.user_id
	from public.user_organizations atlas_population_membership
	join public.organizations atlas_population_organization
		on atlas_population_organization.id = atlas_population_membership.organization_id
	where atlas_population_organization.first_subscribed_at is not null
)`;
}

function productGenerationPopulation(
	policy: TinybirdEligibilitySnapshot["policy"],
	table:
		| "generations"
		| "generation_feedback"
		| "generation_score" = "generations",
): string {
	const populationRule =
		policy === "PRODUCT_ACTIVITY"
			? `and (
		coalesce(atlas_population_user.banned, false) = false
		or atlas_population_user.id in (select user_id from atlas_subscribed_users)
	)`
			: "";
	return `atlas_population_${table} as not materialized (
	select atlas_population_generation.*
  from public.${table} atlas_population_generation
	join auth.users atlas_population_user
    on atlas_population_user.id = atlas_population_generation.user_id
	where coalesce(atlas_population_user.is_anonymous, false) = false
		and lower(coalesce(atlas_population_user.email, '')) not like '%@sync.so'
		and lower(coalesce(atlas_population_user.email, '')) not like '%@sync.labs'
		${populationRule}
)`;
}

function productOrganizationPopulation(
	policy: TinybirdEligibilitySnapshot["policy"],
): string {
	const populationRule =
		policy === "PRODUCT_ACTIVITY"
			? `and (
			coalesce(atlas_population_user.banned, false) = false
			or atlas_population_user.id in (select user_id from atlas_subscribed_users)
		)`
			: "";
	return `atlas_population_organizations as (
	select atlas_population_organization.*
  from public.organizations atlas_population_organization
  where exists (
    select 1
    from public.user_organizations atlas_population_membership
		join auth.users atlas_population_user
      on atlas_population_user.id = atlas_population_membership.user_id
    where atlas_population_membership.organization_id = atlas_population_organization.id
		and coalesce(atlas_population_user.is_anonymous, false) = false
		and lower(coalesce(atlas_population_user.email, '')) not like '%@sync.so'
		and lower(coalesce(atlas_population_user.email, '')) not like '%@sync.labs'
		${populationRule}
	)
)`;
}

function normalizeEmbeddedProductPopulation(
	queryText: string,
	policy: TinybirdEligibilitySnapshot["policy"],
): string {
	let normalized = queryText;
	const dirtyPopulation =
		/coalesce\(\s*(?:([a-z_][\w$]*)\.)?banned\s*,\s*false\s*\)\s+or\s+coalesce\(\s*(?:\1\.)?disabled\s*,\s*false\s*\)\s+or\s+coalesce\(\s*(?:\1\.)?is_anonymous\s*,\s*false\s*\)/gi;
	normalized = normalized.replace(dirtyPopulation, (_match, alias?: string) => {
		const qualifier = alias ? `${alias}.` : "";
		return policy === "PRODUCT_ACTIVITY"
			? `(coalesce(${qualifier}banned, false) and ${qualifier}id not in (select user_id from atlas_subscribed_users)) or coalesce(${qualifier}is_anonymous, false)`
			: `coalesce(${qualifier}is_anonymous, false)`;
	});
	const cleanBanned =
		/coalesce\(\s*(?:([a-z_][\w$]*)\.)?banned\s*,\s*false\s*\)\s*=\s*false/gi;
	normalized = normalized.replace(cleanBanned, (_match, alias?: string) => {
		if (policy === "MONEY") return "true";
		const qualifier = alias ? `${alias}.` : "";
		return `(coalesce(${qualifier}banned, false) = false or ${qualifier}id in (select user_id from atlas_subscribed_users))`;
	});
	return normalized.replace(
		/coalesce\(\s*(?:[a-z_][\w$]*\.)?disabled\s*,\s*false\s*\)\s*=\s*false/gi,
		"true",
	);
}

function parseProductQuery(queryText: string) {
	try {
		return {
			statements: parse(queryText, { locationTracking: true }),
			columnListAliases: new Set<number>(),
		};
	} catch {
		const identifier = String.raw`(?:"(?:[^"]|"")*"|[a-z_][\w$]*)`;
		const columnLists = new RegExp(
			`(${identifier})\\s*(\\(\\s*${identifier}(?:\\s*,\\s*${identifier})*\\s*\\))(?=\\s+as\\s*\\()`,
			"gi",
		);
		const columnListAliases = new Set<number>();
		const parseText = queryText.replace(
			columnLists,
			(match, _alias: string, columns: string, offset: number) => {
				columnListAliases.add(offset);
				return match.slice(0, -columns.length) + " ".repeat(columns.length);
			},
		);
		if (!columnListAliases.size) throw new Error("Unsupported Product SQL.");
		return {
			statements: parse(parseText, { locationTracking: true }),
			columnListAliases,
		};
	}
}

function rewriteProductTables(
	queryText: string,
): { queryText: string; tables: Set<string> } | null {
	const sourceTables = new Set([
		"generations",
		"generation_feedback",
		"generation_score",
		"organizations",
		"organization_features",
		"org_movement_months",
	]);
	const reservedNames = new Set([
		"atlas_subscribed_users",
		...[...sourceTables].map((table) => `atlas_population_${table}`),
	]);
	const tables = new Set<string>();
	const edits: { start: number; end: number; text: string }[] = [];
	let commonTableNames = new Set<string>();
	try {
		const { statements, columnListAliases } = parseProductQuery(queryText);
		const statement = statements[0];
		if (statements.length !== 1 || !statement) return null;
		const visitor = astVisitor((visit) => ({
			statement(statement) {
				if (
					![
						"select",
						"with",
						"with recursive",
						"union",
						"union all",
						"values",
					].includes(statement.type)
				) {
					throw new Error(
						"Only read-only queries can use population rewriting.",
					);
				}
				visit.super().statement(statement);
			},
			with(statement) {
				const outerNames = commonTableNames;
				commonTableNames = new Set(outerNames);
				for (const binding of statement.bind) {
					const aliasLocation = locationOf(binding.alias);
					if (aliasLocation) columnListAliases.delete(aliasLocation.start);
					if (reservedNames.has(binding.alias.name)) {
						throw new Error("Query uses a reserved population name.");
					}
					visit.statement(binding.statement);
					commonTableNames.add(binding.alias.name);
				}
				visit.statement(statement.in);
				commonTableNames = outerNames;
			},
			withRecursive(statement) {
				if (reservedNames.has(statement.alias.name)) {
					throw new Error("Query uses a reserved population name.");
				}
				const outerNames = commonTableNames;
				commonTableNames = new Set([...outerNames, statement.alias.name]);
				visit.statement(statement.bind);
				visit.statement(statement.in);
				commonTableNames = outerNames;
			},
			tableRef(table) {
				if (
					!sourceTables.has(table.name) ||
					(table.schema && table.schema !== "public") ||
					(!table.schema && commonTableNames.has(table.name))
				)
					return;
				const location = locationOf(table);
				if (!location) throw new Error("Missing SQL source location.");
				tables.add(table.name);
				edits.push({
					...location,
					text: `atlas_population_${table.name}${table.alias ? "" : ` as "${table.name}"`}`,
				});
			},
			ref(reference) {
				if (
					reference.table?.schema !== "public" ||
					!sourceTables.has(reference.table.name)
				)
					return;
				const location = locationOf(reference.table);
				if (!location) throw new Error("Missing SQL reference location.");
				edits.push({ ...location, text: `"${reference.table.name}"` });
			},
		}));
		visitor.statement(statement);
		if (columnListAliases.size) return null;
		let rewritten = queryText;
		for (const edit of edits.sort((left, right) => right.start - left.start)) {
			rewritten =
				rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
		}
		return { queryText: rewritten, tables };
	} catch {
		return null;
	}
}

function prependPostgresCommonTableExpressions(
	queryText: string,
	commonTableExpressions: string[],
): string {
	const prefix = commonTableExpressions.join(",\n");
	const leadingComments =
		queryText.match(
			/^(?:(?:\s*--[^\r\n]*(?:\r?\n|$))|(?:\s*\/\*[\s\S]*?\*\/))*\s*/,
		)?.[0] ?? "";
	const statement = queryText.slice(leadingComments.length);
	if (/^with\s+recursive\b/i.test(statement)) {
		return `${leadingComments}${statement.replace(
			/^\s*with\s+recursive\b/i,
			`with recursive ${prefix},`,
		)}`;
	}
	if (/^with\b/i.test(statement)) {
		return `${leadingComments}${statement.replace(/^with\b/i, `with ${prefix},`)}`;
	}
	return `${leadingComments}with ${prefix}\n${statement}`;
}

export function hasSubscribedPopulation(queryText: string): boolean {
	const normalized = queryText.toLowerCase().replaceAll(/\s+/g, " ");
	return (
		/"?organizationplantype"?[^\n)]*\bin\s*\(\s*'[^']+'/.test(normalized) ||
		/"?organizationplantype"?\s+is\s+not\s+null/.test(normalized) ||
		/"?organizationplantype"?\s*(?:!=|<>)\s*''/.test(normalized) ||
		/"?stripesubscriptionid"?\s+is\s+not\s+null/.test(normalized)
	);
}

function knownExclusionPredicate(column: string, values: string[]): string {
	if (values.length === 0) return "1 = 1";
	return `${column} not in (${values.map(sqlString).join(", ")})`;
}

function wrapTable(queryText: string, table: string, predicate: string) {
	const pattern = new RegExp(
		`\\b${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
		"gi",
	);
	let applied = false;
	const next = queryText.replace(pattern, (match) => {
		applied = true;
		return `(select * from ${match} where ${predicate})`;
	});
	return { queryText: next, applied };
}

function sqlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown, fallback: number): number {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
