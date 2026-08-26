import { VerificationStatus } from "@crm/db";
import type {
	HubspotSalesQuery,
	HubspotSalesResult,
} from "@crm/db/hubspot-sales";
import type { PublishVerificationCheck } from "../metabase/product-metric.publisher";

const COUNT_COLUMNS = [
	"enterprise_inbound",
	"mql",
	"pql",
	"sql",
	"crm_paid_closed_won",
	"paid_sow_documents",
	"paid_order_form_documents",
	"net_new_logos",
	"renewals",
	"unmapped_deals",
];

export function q3LifecycleVerificationChecks(
	result: HubspotSalesResult,
	query: HubspotSalesQuery,
): PublishVerificationCheck[] {
	const rows = records(result);
	const watermarks = rows.map((row) => String(row.data_through ?? ""));
	const columns = new Set(result.columns.map((column) => column.name));
	return [
		check(
			"inbound_form_parity",
			rows.length > 0 && nonNegativeColumns(rows, ["enterprise_inbound"]),
			"Enterprise inbound must use the deidentified Rudy Slack source-thread aggregate.",
			rows.length,
		),
		check(
			"lifecycle_stage_mapping",
			nonNegativeColumns(rows, ["mql", "pql", "sql"]),
			"MQL, PQL, and SQL must use the approved HubSpot lifecycle-stage transitions.",
			rows.length,
		),
		check(
			"signed_contract_boundary",
			rows.every(
				(row) =>
					row.signed_paid_sows === null &&
					nonNegative(row.paid_sow_documents) &&
					nonNegative(row.paid_order_form_documents),
			),
			"Parsed commercial documents must remain separate from signature-verified SOWs.",
			rows.length,
		),
		check(
			"logo_classification",
			query.pipelines.length === 1 &&
				query.pipelines[0] === "989457121" &&
				rows.every(
					(row) =>
						number(row.net_new_logos) +
							number(row.renewals) +
							number(row.unmapped_deals) ===
						number(row.crm_paid_closed_won),
				),
			"Every positive closed-won Enterprise deal must map to new business, existing business, or unmapped.",
			query.pipelines,
		),
		check(
			"unmapped_deal_visibility",
			columns.has("unmapped_deals") && nonNegativeColumns(rows, COUNT_COLUMNS),
			"Unknown Enterprise deal-type classifications must remain visible.",
			[...columns],
		),
		check(
			"sensitive_detail_boundary",
			![...columns].some((column) =>
				/^(email|domain|name|account|company|contact_id|contact_name|deal_id|user_id|organization_id)$/i.test(
					column,
				),
			),
			"The governed result must not expose contact, company, account, or deal identities.",
			[...columns],
		),
		check(
			"oldest_complete_watermark",
			watermarks.length > 0 &&
				new Set(watermarks).size === 1 &&
				watermarks.every((value) => {
					const parsed = Date.parse(value);
					return Number.isFinite(parsed) && parsed > 0 && parsed <= Date.now();
				}),
			"Every row must share the exact HubSpot, Rudy inbound, and contract-source UTC boundary.",
			watermarks,
		),
	];
}

function records(result: HubspotSalesResult): Array<Record<string, unknown>> {
	return result.rows.map((row) =>
		Object.fromEntries(
			result.columns.map((column, index) => [column.name, row[index]]),
		),
	);
}

function nonNegativeColumns(
	rows: Array<Record<string, unknown>>,
	columns: string[],
): boolean {
	return rows.every((row) =>
		columns.every((column) => nonNegative(row[column])),
	);
}

function number(value: unknown): number {
	return Number(value);
}

function nonNegative(value: unknown): boolean {
	const parsed = number(value);
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
