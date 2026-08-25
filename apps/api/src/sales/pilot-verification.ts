import { VerificationStatus } from "@crm/db";
import type {
	HubspotSalesQuery,
	HubspotSalesResult,
} from "@crm/db/hubspot-sales";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";

const PIPELINES = ["989457121", "1984250589"];

export function pilotSummaryVerificationChecks(
	result: HubspotSalesResult,
	query: HubspotSalesQuery,
): PublishVerificationCheck[] {
	const row = Object.fromEntries(
		result.columns.map((column, index) => [
			column.name,
			result.rows[0]?.[index],
		]),
	);
	const accounts = values(row.pilot_accounts);
	const owners = values(row.owners);
	const active = number(row.active_pilots);
	const dataThrough = Date.parse(String(row.data_through ?? ""));
	return [
		check(
			"active_registry_parity",
			result.rows.length === 1 && active >= 0 && active === accounts.length,
			"The active pilot count must reconcile to the account list.",
			{ active, accounts: accounts.length },
		),
		check(
			"deal_stage_mapping",
			JSON.stringify([...query.pipelines].sort()) ===
				JSON.stringify([...PIPELINES].sort()),
			"The query must use the approved Enterprise and Studio pilot pipelines.",
			{ pipelines: query.pipelines },
		),
		check(
			"owner_coverage",
			owners.length > 0 && !owners.includes("Unassigned"),
			"Every active pilot must have an assigned CRM owner.",
			{ owners },
		),
		check(
			"oldest_complete_watermark",
			Number.isFinite(dataThrough) &&
				dataThrough > 0 &&
				dataThrough <= Date.now(),
			"The report must expose the complete HubSpot source watermark.",
			{ dataThrough: row.data_through },
		),
	];
}

function values(value: unknown): string[] {
	return String(value ?? "")
		.split(";")
		.map((item) => item.trim())
		.filter(Boolean);
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
