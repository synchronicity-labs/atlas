import { VerificationStatus } from "@crm/db";
import type {
	HubspotSalesQuery,
	HubspotSalesResult,
} from "@crm/db/hubspot-sales";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";

const PIPELINES = ["989457121", "1984250589"];
const PRIVATE_COLUMNS = [
	"domain",
	"email",
	"user_id",
	"organization_id",
	"workspace_id",
];

export function pilotAdoptionVerificationChecks(input: {
	result: HubspotSalesResult;
	query: HubspotSalesQuery;
	queryText: string;
	registryCount: number;
	dataThrough: Date;
}): PublishVerificationCheck[] {
	const rows = input.result.rows.map((row) =>
		Object.fromEntries(
			input.result.columns.map((column, index) => [column.name, row[index]]),
		),
	);
	const mappings = rows.map((row) => String(row.workspace_mapping ?? ""));
	const nonNegative = rows.every((row) =>
		[
			"matched_workspaces",
			"users",
			"active_users_24h",
			"pending_invites",
			"generations_24h",
			"generations_to_date",
			"completed_generations",
			"failed_generations",
			"output_hours",
		].every((key) => number(row[key]) >= 0),
	);
	const subsets = rows.every(
		(row) =>
			number(row.active_users_24h) <= number(row.users) &&
			number(row.generations_24h) <= number(row.generations_to_date) &&
			number(row.completed_generations) + number(row.failed_generations) <=
				number(row.generations_to_date),
	);
	const normalizedSql = input.queryText.toLowerCase().replaceAll(/\s+/g, " ");
	const dataThrough = input.dataThrough.toISOString();
	return [
		check(
			"active_registry_parity",
			rows.length === input.registryCount &&
				rows.every((row) => row.pilot_status === "active"),
			"Every approved active HubSpot pilot must appear exactly once in the result.",
			{ registry: input.registryCount, returned: rows.length },
		),
		check(
			"deal_stage_mapping",
			JSON.stringify([...input.query.pipelines].sort()) ===
				JSON.stringify([...PIPELINES].sort()),
			"The question must use the approved Enterprise and Studio pilot pipelines.",
			{ pipelines: input.query.pipelines },
		),
		check(
			"account_identity_join",
			mappings.every((value) =>
				["domain_verified", "not_verified"].includes(value),
			) &&
				normalizedSql.includes(
					"split_part(lower(u.email::text), '@', 2) = r.domain",
				),
			"Workspace identity must use exact company-domain evidence and must keep unmatched pilots visible.",
			{
				domainVerified: mappings.filter((value) => value === "domain_verified")
					.length,
				notVerified: mappings.filter((value) => value === "not_verified")
					.length,
			},
		),
		check(
			"usage_population_exclusions",
			nonNegative &&
				subsets &&
				normalizedSql.includes("coalesce(u.banned, false) = false") &&
				normalizedSql.includes("coalesce(u.disabled, false) = false") &&
				normalizedSql.includes("coalesce(u.is_anonymous, false) = false") &&
				normalizedSql.includes("'sync.so', 'sync.labs', 'synclabs.so'"),
			"Pilot adoption must exclude internal, banned, disabled, and anonymous users, and all counts must reconcile.",
			{ nonNegative, subsets },
		),
		check(
			"sensitive_detail_boundary",
			input.result.columns.every(
				(column) => !PRIVATE_COLUMNS.includes(column.name),
			),
			"The governed result must exclude domains, emails, and user, organization, or workspace identifiers.",
			{ columns: input.result.columns.map((column) => column.name) },
		),
		check(
			"oldest_complete_watermark",
			input.dataThrough.getTime() > 0 &&
				input.dataThrough.getTime() <= Date.now() &&
				rows.every((row) => timestamp(row.data_through) === dataThrough),
			"Every row must use the HubSpot source watermark, which is older than the live product query.",
			{ dataThrough },
		),
	];
}

function timestamp(value: unknown): string | null {
	const parsed = new Date(String(value ?? ""));
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function number(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : -1;
}

function check(
	name: string,
	passed: boolean,
	reason: string,
	actualValue: unknown,
): PublishVerificationCheck {
	return {
		name,
		status: passed ? VerificationStatus.PASSED : VerificationStatus.FAILED,
		reason,
		actualValue,
	};
}
