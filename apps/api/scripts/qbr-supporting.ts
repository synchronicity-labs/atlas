import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { db } from "@crm/db";
import {
	additionalMarketingQueries,
	additionalQbrQueries,
} from "../src/atlas-query/qbr/additional-queries";
import { productCollectionDiagnostics } from "../src/atlas-query/qbr/product-collection";
import { AtlasQbrService } from "../src/atlas-query/qbr/qbr.service";
import registry from "../src/atlas-query/qbr/registry.json";
import { MarketingClient } from "../src/marketing/marketing.client";
import { marketingConfig } from "../src/marketing/marketing.config";
import {
	applyPosthogPersonPolicy,
	productUserEligibilityPredicate,
} from "../src/marketing/marketing.eligibility";
import { MetabaseClient } from "../src/metabase/metabase.client";
import { metabaseConfig } from "../src/metabase/metabase.config";
import { prepareGovernedMetabaseQuery } from "../src/metabase/prepare-metabase-query";
import { RevenueDoorPolicyService } from "../src/metabase/revenue-door-policy.service";
import { TinybirdEligibilityService } from "../src/metabase/tinybird-eligibility.service";

type Cell = string | number | boolean | null;
type SupportingResult = {
	metricId: string;
	label: string;
	asOf: string;
	source: { label: string; url: string };
	queryText: string;
	columns: string[];
	rows: Cell[][];
	limitations: string;
};

const [outputArgument] = process.argv.slice(2);
assert(
	outputArgument,
	"Usage: bun apps/api/scripts/qbr-supporting.ts <private-output.json>",
);
const output = resolve(outputArgument);
const report = await new AtlasQbrService(db).exportReport("2026-Q3");
const definitions = new Map(
	registry.metrics.map((metric) => [metric.id, metric]),
);
const results: SupportingResult[] = [];

function rowsFor(
	metricId: string,
	label: string,
	sourceLabel: string,
	queryText: string,
	columns: string[],
	rows: unknown[][],
	limitations: string,
) {
	const metric = report.metrics[metricId];
	assert(metric, `Metric ${metricId} is absent from the exported QBR report.`);
	assert(
		metric.question?.url,
		`Metric ${metricId} has no registered Atlas question URL.`,
	);
	assert(
		rows.length <= 200,
		`${metricId} returned ${rows.length} rows; supporting result limit is 200.`,
	);
	assert(
		columns.length > 0 && columns.length <= 20,
		`${metricId} has an invalid column count.`,
	);
	const scalarRows = rows.map((row) => {
		assert.equal(
			row.length,
			columns.length,
			`${metricId} returned a row with the wrong column count.`,
		);
		return row.map((cell) => {
			assert(
				cell === null || ["string", "number", "boolean"].includes(typeof cell),
				`${metricId} returned a non-scalar cell.`,
			);
			if (typeof cell === "number")
				assert(
					Number.isFinite(cell),
					`${metricId} returned a non-finite number.`,
				);
			if (typeof cell === "string")
				assert(
					cell.length <= 1000,
					`${metricId} returned a string cell over 1000 characters.`,
				);
			return cell as Cell;
		});
	});
	results.push({
		metricId,
		label,
		asOf: new Date().toISOString(),
		source: { label: sourceLabel, url: metric.question.url },
		queryText,
		columns,
		rows: scalarRows,
		limitations,
	});
}

const metabaseSettings = metabaseConfig();
assert(
	metabaseSettings,
	"Metabase is not configured; no source queries were run.",
);
const metabase = new MetabaseClient(metabaseSettings);
const eligibility = new TinybirdEligibilityService();
const doorPolicy = new RevenueDoorPolicyService(db);
const sqlQueries = {
	platform_latency_by_model_duration:
		additionalQbrQueries.platform_latency_by_model_duration,
	platform_generation_status_diagnostic:
		additionalQbrQueries.platform_generation_status_diagnostic,
	...productCollectionDiagnostics("2026-10-01", new Date()),
};
const sqlMetricIds: Record<string, string> = {
	platform_latency_by_model_duration: "platform_latency",
	platform_generation_status_diagnostic: "platform_completion",
	product_upvotes: "product_upvotes",
	product_return_lift: "product_return_lift",
};
for (const [queryId, query] of Object.entries(sqlQueries)) {
	assert(query, `No source query for ${queryId}.`);
	const metricId = sqlMetricIds[queryId];
	assert(metricId, `No QBR metric mapping for ${queryId}.`);
	const definition = definitions.get(metricId);
	assert(definition, `No public registry definition for ${metricId}.`);
	const prepared = await prepareGovernedMetabaseQuery(
		{
			number: report.metrics[metricId]?.question?.number ?? 0,
			name: definition.label,
			sourceExternalId: `qbr:${metricId}`,
			databaseExternalId: query.databaseExternalId,
		},
		{ language: "SQL", queryText: query.queryText },
		metabase,
		eligibility,
		doorPolicy,
	);
	assert(
		prepared.governed?.applied && prepared.governed.eligibility.complete,
		`Eligibility governance is incomplete for ${metricId}.`,
	);
	const result = await metabase.preview(prepared.input);
	const label =
		queryId === "platform_latency_by_model_duration"
			? "Generation latency by month, model, and duration band"
			: queryId === "platform_generation_status_diagnostic"
				? "Generation outcomes, including failed and pending jobs"
				: definition.label;
	const limitations =
		queryId === "platform_latency_by_model_duration"
			? "Partial diagnostic only. Includes completed generations with model, non-negative duration, and valid start/end timestamps. Excludes failures and timeouts; duration bands are explicit reporting bands, not an overall latency headline."
			: queryId === "platform_generation_status_diagnostic"
				? "Current non-deleted Q3 generation records by admission month and status. Failures and pending jobs stay visible separately from completed-generation latency. These records do not reconstruct deleted records, rejected preflight requests, or attempt-level retry history."
				: `${definition.preparation.gap} Diagnostic rows support review and do not certify the metric headline.`;
	rowsFor(
		metricId,
		label,
		"Atlas registered question",
		prepared.input.queryText,
		result.columns.map((column) => column.name),
		result.rows,
		limitations,
	);
}

const marketing = new MarketingClient(marketingConfig());
const visitorQuery =
	additionalMarketingQueries.marketing_visitors_by_site_month;
assert(visitorQuery?.source === "ga4", "Visitor query must use GA4.");
assert(
	visitorQuery.exactRange?.startDate === "2026-07-01" &&
		visitorQuery.exactRange.endDateExclusive === "2026-10-01",
	"Visitor query must cover fixed Q3 2026.",
);
const visitorResult = await marketing.ga4Range(
	visitorQuery,
	new Date(`${visitorQuery.exactRange.startDate}T00:00:00.000Z`),
	new Date(`${visitorQuery.exactRange.endDateExclusive}T00:00:00.000Z`),
);
rowsFor(
	"marketing_visitors",
	"GA4 visitors by property and month",
	"Atlas registered question",
	JSON.stringify({ ...visitorQuery, exactRange: visitorQuery.exactRange }),
	visitorResult.columns.map((column) => column.name),
	visitorResult.rows,
	"Partial diagnostic only. Property/month users are reported separately because identities are not deduplicated across properties. The available query does not establish bot or internal-traffic exclusions or the full source/medium/campaign breakdown required by the metric definition.",
);

const signupQuery = additionalMarketingQueries.marketing_clean_signups_by_month;
assert(signupQuery?.source === "posthog", "Signup query must use PostHog.");
const productEligibility = await eligibility.current();
assert(
	productEligibility.complete,
	"PostHog person eligibility is incomplete; signup query was not run.",
);
const signupQueryText = applyPosthogPersonPolicy(
	signupQuery.query,
	signupQuery.personPolicy,
	productUserEligibilityPredicate(productEligibility.excludedUserIds),
);
const signupResult = await marketing.execute({
	...signupQuery,
	query: signupQueryText,
});
rowsFor(
	"marketing_clean_signups",
	"Eligible signup people by month",
	"Atlas registered question",
	signupQueryText,
	signupResult.columns.map((column) => column.name),
	signupResult.rows,
	"Partial diagnostic only. Counts distinct eligible PostHog people with signup events and includes missing first-touch counts. It does not join to a qualified professional or organization cohort and does not establish a mature observation window.",
);

const payload = {
	schemaVersion: "atlas.qbr.supporting-results.v1",
	quarter: "2026-Q3",
	generatedAt: new Date().toISOString(),
	readOnly: true,
	supportingResults: results,
	rowCounts: Object.fromEntries(
		results.map((result) => [result.metricId, result.rows.length]),
	),
};
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, {
	flag: "wx",
	mode: 0o600,
});
console.log(
	JSON.stringify({
		output,
		tables: results.length,
		rowCounts: payload.rowCounts,
	}),
);
