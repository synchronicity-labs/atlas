import { db } from "@crm/db";
import { MetabaseClient } from "../src/metabase/metabase.client";
import { metabaseConfig } from "../src/metabase/metabase.config";
import { TinybirdEligibilityService } from "../src/metabase/tinybird-eligibility.service";

const questionNumbers = [1101, 1105, 1106, 1107, 1108, 1109];
const cutoffInput = process.argv[2];
const cutoff = cutoffInput ? new Date(cutoffInput) : null;

if (!cutoff || Number.isNaN(cutoff.getTime()) || !cutoffInput?.endsWith("Z")) {
	throw new Error(
		"Usage: bun scripts/replay-weekly-revenue.ts <UTC cutoff, for example 2026-08-10T16:00:00Z>",
	);
}

const config = metabaseConfig();
if (!config) throw new Error("Metabase is not configured.");

const anchor = cutoff.toISOString().slice(0, 19).replace("T", " ");
const questions = await db.question.findMany({
	where: { number: { in: questionNumbers } },
	orderBy: { number: "asc" },
	select: {
		number: true,
		name: true,
		versions: {
			orderBy: { version: "desc" },
			take: 1,
			select: { version: true, queryText: true },
		},
	},
});

if (questions.length !== questionNumbers.length) {
	throw new Error("The Weekly Revenue Lite question set is incomplete.");
}

const client = new MetabaseClient(config);
const eligibilityService = new TinybirdEligibilityService();
const eligibility = await eligibilityService.current();
const results = [];

for (const question of questions) {
	const version = question.versions[0];
	if (!version) throw new Error(`Question ${question.number} has no version.`);
	const queryText = version.queryText.replaceAll(
		"toTimeZone(now(), 'UTC')",
		`toDateTime('${anchor}', 'UTC')`,
	);
	if (queryText === version.queryText) {
		throw new Error(
			`Question ${question.number} has no replaceable UTC anchor.`,
		);
	}
	const raw = await client.preview({
		language: "SQL",
		queryText,
		databaseExternalId: "166",
	});
	const governedQuery = eligibilityService.govern(
		queryText,
		"166",
		eligibility,
	);
	const governed = governedQuery.applied
		? await client.preview({
				language: "SQL",
				queryText: governedQuery.queryText,
				databaseExternalId: "166",
			})
		: null;
	results.push({
		number: question.number,
		name: question.name,
		version: version.version,
		columns: raw.columns.map((column) => column.name),
		rawRows: raw.rows,
		governedRows: governed?.rows ?? null,
		governedApplied: governedQuery.applied,
	});
}

console.log(
	JSON.stringify(
		{
			cutoff: cutoff.toISOString(),
			eligibility: {
				capturedAt: eligibility.capturedAt.toISOString(),
				contentHash: eligibility.contentHash,
				excludedUsers: eligibility.excludedUserIds.length,
				excludedOrganizations: eligibility.excludedOrganizationIds.length,
				excludedCustomers: eligibility.excludedCustomerIds.length,
				complete: eligibility.complete,
			},
			results,
		},
		null,
		2,
	),
);
await db.$disconnect();
