import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "@crm/db";
import { Logger } from "@nestjs/common";
import { AtlasQbrService } from "../src/atlas-query/qbr/qbr.service";
import { qbrQuarterValue, qbrQueries } from "../src/atlas-query/qbr/queries";
import registry from "../src/atlas-query/qbr/registry.json";
import { MetabaseClient } from "../src/metabase/metabase.client";
import { metabaseConfig } from "../src/metabase/metabase.config";
import { prepareGovernedMetabaseQuery } from "../src/metabase/prepare-metabase-query";
import { RevenueDoorPolicyService } from "../src/metabase/revenue-door-policy.service";
import { TinybirdEligibilityService } from "../src/metabase/tinybird-eligibility.service";

const logger = new Logger("QbrCollection");
const [command, file] = process.argv.slice(2);
const service = new AtlasQbrService(db);

try {
	assert(
		[
			"register",
			"refresh",
			"import-manual",
			"import-preparations",
			"export",
		].includes(command ?? ""),
		"Usage: qbr.ts register|refresh|import-manual file.json|import-preparations file.json|export report.json",
	);
	if (command === "register") {
		const bindings = await service.register(qbrQueries());
		logger.log({
			message: "QBR questions registered",
			questions: Object.keys(bindings).length,
		});
	} else if (command === "refresh") {
		const config = metabaseConfig();
		assert(config, "Metabase is not configured; no source pull was attempted.");
		const refreshStartedAt = new Date();
		const queries = qbrQueries(refreshStartedAt);
		const bindings = await service.register(queries);
		const client = new MetabaseClient(config);
		const eligibility = new TinybirdEligibilityService();
		const doorPolicy = new RevenueDoorPolicyService(db);
		const results = new Map<
			string,
			Awaited<ReturnType<MetabaseClient["preview"]>>
		>();
		const pendingObservations = new Map<
			string,
			Parameters<AtlasQbrService["recordObservations"]>[1]
		>();
		let observations = 0;
		for (const [id, query] of Object.entries(queries)) {
			let result = results.get(query.queryText);
			if (!result) {
				const prepared = await prepareGovernedMetabaseQuery(
					{
						number: bindings[id] ?? 0,
						name: registry.metrics.find((m) => m.id === id)?.label ?? id,
						sourceExternalId: `qbr:${id}`,
						databaseExternalId: query.databaseExternalId,
					},
					{ language: "SQL", queryText: query.queryText },
					client,
					eligibility,
					doorPolicy,
				);
				assert(
					prepared.governed?.applied && prepared.governed.eligibility.complete,
					"Population filter must be completely applied.",
				);
				const population = prepared.governed.eligibility;
				assert.equal(population.policy, "PRODUCT_ACTIVITY");
				assert.equal(
					population.scope,
					query.databaseExternalId === "166"
						? "SUBSCRIBED_ORGANIZATIONS"
						: "ALL_IDENTITIES",
				);
				result = await client.preview(prepared.input);
				results.set(query.queryText, result);
			}
			const asOf = new Date().toISOString();
			const rows = result.rows.map((values) =>
				Object.fromEntries(
					result.columns.map((column, index) => [column.name, values[index]]),
				),
			);
			assert(
				rows.length > 0,
				`No complete observations returned for ${id}; existing snapshots were retained.`,
			);
			const values = rows.map((row) => {
				assert.equal(
					Number(row.unknown_status_count ?? 0),
					0,
					"Unclassified generation status; completion is withheld.",
				);
				assert(typeof row.period_start === "string", "Missing source period");
				const period = row.period_start.slice(0, 7);
				const numeric = (value: unknown) => {
					assert(
						typeof value === "number" && Number.isFinite(value),
						`Non-numeric source value for ${id}/${period}`,
					);
					return value;
				};
				const value = numeric(row.value);
				const numerator = row.numerator == null ? null : numeric(row.numerator);
				const denominator =
					row.denominator == null ? null : numeric(row.denominator);
				if (denominator !== null) {
					assert(
						denominator > 0 && numerator !== null && numerator >= 0,
						"Invalid ratio base",
					);
					assert(
						Math.abs(
							value - Math.round((10000 * numerator) / denominator) / 100,
						) < 0.011,
						"Source ratio does not reconcile",
					);
				}
				return {
					period,
					value,
					numerator,
					denominator,
					status: "provisional" as const,
					asOf,
					dataThrough: null,
					evidenceSource: {
						label:
							"Atlas governed source query; current-clean history; source-close verification pending",
						url: `https://atlas.pr.sync.so/questions/${bindings[id]}`,
					},
					...(typeof row.cohort_month === "string"
						? { cohortMonth: row.cohort_month.slice(0, 7) }
						: {}),
				};
			});
			if (refreshStartedAt.getTime() >= Date.UTC(2026, 9, 1)) {
				const quarter = qbrQuarterValue(id, values, refreshStartedAt);
				if (quarter)
					values.push({
						...quarter,
						status: "provisional",
						asOf,
						dataThrough: null,
						evidenceSource: values[0].evidenceSource,
					});
			}
			pendingObservations.set(id, values);
		}
		for (const [id, values] of pendingObservations) {
			await service.recordObservations(id, values);
			observations += values.length;
			logger.log({
				message: "QBR question refreshed",
				metricId: id,
				questionNumber: bindings[id],
				observations: values.length,
				trust: "provisional",
			});
		}
		await db.dataSource.update({
			where: { key: "atlas:qbr" },
			data: { state: "HEALTHY", lastSyncAt: new Date(), lastError: null },
		});
		logger.log({
			message: "QBR source refresh complete",
			metrics: Object.keys(queries).length,
			observations,
		});
	} else if (command === "import-preparations") {
		assert(file, "Supply a private preparation JSON file.");
		const text = await readFile(file, "utf8");
		assert(
			Buffer.byteLength(text) <= 1_000_000,
			"Preparation input exceeds 1 MB.",
		);
		const result = await service.importPreparations(JSON.parse(text));
		logger.log({ message: "Private QBR preparations imported", ...result });
	} else if (command === "import-manual") {
		assert(file, "Supply a reviewed manual-input JSON file.");
		const text = await readFile(file, "utf8");
		assert(Buffer.byteLength(text) <= 1_000_000, "Manual input exceeds 1 MB.");
		const input = JSON.parse(text);
		assert(
			typeof input.metricId === "string" &&
				Array.isArray(input.observations) &&
				input.observations.length > 0,
		);
		assert(
			input.observations.every(
				(o: { status?: string }) => o.status === "reported",
			),
			"Manual input must be reported, never verified.",
		);
		await service.recordObservations(input.metricId, input.observations);
		logger.log({
			message: "Reported input saved in Atlas",
			metricId: input.metricId,
			observations: input.observations.length,
		});
	} else {
		assert(file, "Supply an output JSON file path.");
		const report = await service.exportReport("2026-Q3");
		await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, {
			mode: 0o600,
		});
		logger.log({
			message: "Atlas QBR report exported",
			metrics: Object.keys(report.metrics).length,
		});
	}
} finally {
	await db.$disconnect();
}
