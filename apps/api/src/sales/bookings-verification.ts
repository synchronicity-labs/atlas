import { VerificationStatus } from "@crm/db";
import type {
	HubspotSalesQuery,
	HubspotSalesResult,
} from "@crm/db/hubspot-sales";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";

export function studioBookingsVerificationChecks(
	result: HubspotSalesResult,
	query: HubspotSalesQuery,
): PublishVerificationCheck[] {
	const rows = records(result);
	return [
		check(
			"deal_stage_mapping",
			exactPipelines(query, ["1984250589"]),
			"The question must use only the Sync Studios pipeline.",
			query.pipelines,
		),
		check(
			"crm_booking_parity",
			rows.length > 0 &&
				rows.every(
					(row) =>
						text(row.account) &&
						text(row.stage) &&
						text(row.owner) &&
						nonNegative(row.closed_won_value),
				),
			"Every Studio booking row must retain its CRM account, stage, owner, and non-negative closed-won amount.",
			{ rows: rows.length },
		),
		check(
			"operational_boundary",
			rows.every(
				(row) =>
					row.in_delivery_value === null &&
					row.contract_status === "unavailable" &&
					row.delivery_status === "unavailable",
			),
			"The CRM metric must not invent contract execution or delivery state.",
			{ rows: rows.length },
		),
		watermarkCheck(rows),
	];
}

export function enterpriseBookingsVerificationChecks(
	result: HubspotSalesResult,
	query: HubspotSalesQuery,
): PublishVerificationCheck[] {
	const rows = records(result);
	return [
		check(
			"deal_stage_mapping",
			exactPipelines(query, ["989457121"]),
			"The question must use only the Sync Enterprise pipeline.",
			query.pipelines,
		),
		check(
			"crm_booking_parity",
			rows.length > 0 &&
				rows.every(
					(row) =>
						row.stage === "all enterprise stages" &&
						nonNegative(row.pipeline_created) &&
						nonNegative(row.booked_value) &&
						nonNegative(row.unmapped_deals),
				),
			"Every period must expose non-negative CRM pipeline, booked value, and unmapped-deal counts.",
			{ rows: rows.length },
		),
		check(
			"contract_classification_boundary",
			rows.every(
				(row) =>
					row.signed_contracts === null &&
					row.net_new_logos === null &&
					row.renewals === null,
			),
			"The CRM metric must not classify signed contracts, net-new logos, or renewals without verified contract evidence.",
			{ rows: rows.length },
		),
		watermarkCheck(rows),
	];
}

function records(result: HubspotSalesResult): Array<Record<string, unknown>> {
	return result.rows.map((row) =>
		Object.fromEntries(
			result.columns.map((column, index) => [column.name, row[index]]),
		),
	);
}

function exactPipelines(query: HubspotSalesQuery, expected: string[]): boolean {
	return (
		JSON.stringify([...query.pipelines].sort()) ===
		JSON.stringify([...expected].sort())
	);
}

function watermarkCheck(
	rows: Array<Record<string, unknown>>,
): PublishVerificationCheck {
	const values = rows.map((row) => String(row.data_through ?? ""));
	const timestamps = values.map(Date.parse);
	return check(
		"oldest_complete_watermark",
		values.length > 0 &&
			new Set(values).size === 1 &&
			timestamps.every(
				(value) => Number.isFinite(value) && value > 0 && value <= Date.now(),
			),
		"Every row must expose one current HubSpot source watermark.",
		values,
	);
}

function text(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function nonNegative(value: unknown): boolean {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0;
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
