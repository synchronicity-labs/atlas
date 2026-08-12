import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { MetabaseClient } from "./metabase.client";
import { metabaseConfig } from "./metabase.config";

const ELIGIBILITY_QUERY = `select
  u.id::text as user_id,
  lower(coalesce(u.email, '')) as email,
  coalesce(u.banned, false) as banned,
  coalesce(u.disabled, false) as disabled,
  coalesce(u.is_anonymous, false) as is_anonymous,
  lower(coalesce(uo.role, '')) as membership_role,
  o.id::text as organization_id,
  o.stripe_customer_id::text as customer_id
from auth.users u
left join public.user_organizations uo on uo.user_id = u.id
left join public.organizations o on o.id = uo.organization_id
where coalesce(u.banned, false)
  or coalesce(u.disabled, false)
  or coalesce(u.is_anonymous, false)
  or lower(coalesce(u.email, '')) like '%@sync.so'
  or lower(coalesce(u.email, '')) like '%@sync.labs'
order by u.id, o.id`;

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
};

@Injectable()
export class TinybirdEligibilityService {
	async current(): Promise<TinybirdEligibilitySnapshot> {
		const config = metabaseConfig();
		if (!config) throw new Error("Metabase is not configured.");
		const result = await new MetabaseClient(config).preview({
			language: "SQL",
			queryText: ELIGIBILITY_QUERY,
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
		return buildTinybirdEligibility(
			rows.map((row) => ({
				userId: text(row.user_id),
				email: text(row.email),
				banned: bool(row.banned),
				disabled: bool(row.disabled),
				isAnonymous: bool(row.is_anonymous),
				membershipRole: text(row.membership_role),
				organizationId: text(row.organization_id),
				customerId: text(row.customer_id),
			})),
			new Date(),
		);
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
): TinybirdEligibilitySnapshot {
	const excludedUserIds = sortedUnique(
		rows.filter(isIneligible).map((row) => row.userId),
	);
	const ownerRows = rows.filter(
		(row) =>
			isIneligible(row) &&
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
	let governed = queryText;
	let applied = false;
	for (const table of USER_TABLES) {
		const result = wrapTable(
			governed,
			table,
			userPredicate(eligibility.excludedUserIds),
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
	return {
		queryText: databaseExternalId === "166" ? governed : queryText,
		applied: databaseExternalId === "166" && applied,
		eligibility: {
			capturedAt: eligibility.capturedAt.toISOString(),
			contentHash: eligibility.contentHash,
			excludedUsers: eligibility.excludedUserIds.length,
			excludedOrganizations: eligibility.excludedOrganizationIds.length,
			excludedCustomers: eligibility.excludedCustomerIds.length,
		},
	};
}

function isIneligible(row: EligibilityRow): boolean {
	return (
		row.banned ||
		row.disabled ||
		row.isAnonymous ||
		row.email.endsWith("@sync.so") ||
		row.email.endsWith("@sync.labs")
	);
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort();
}

function userPredicate(values: string[]): string {
	const known = knownExclusionPredicate('"userId"', values);
	return `"userId" is not null and "userId" != '' and ${known}`;
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

function bool(value: unknown): boolean {
	return value === true || value === 1 || value === "1" || value === "true";
}
