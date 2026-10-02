import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
	DataSourceKind,
	type Db,
	db,
	QueryLanguage,
	QuestionStatus,
} from "@crm/db";
import { AtlasQbrService } from "../src/atlas-query/qbr/qbr.service";
import registry from "../src/atlas-query/qbr/registry.json";

const databaseUrl = process.env.DATABASE_URL;
const localDatabase =
	databaseUrl &&
	["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname);

const hash = (value: unknown): string => {
	const canonical = (item: unknown): unknown => {
		if (Array.isArray(item)) return item.map(canonical);
		if (item && typeof item === "object")
			return Object.fromEntries(
				Object.entries(item)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([key, entry]) => [key, canonical(entry)]),
			);
		return item;
	};
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
};

async function withRollbackFixture(
	metricIds: string[],
	fn: (
		tx: Db,
		scopedDb: Db,
		questions: Map<string, { id: string; queryHash: string }>,
	) => Promise<void>,
) {
	const rollback = new Error("rollback QBR verification fixture");
	await expect(
		db.$transaction(
			async (client) => {
				const tx = client as unknown as Db;
				let scopedDb: Db;
				scopedDb = new Proxy(tx, {
					get(target, property, receiver) {
						if (property === "$transaction")
							return (callback: (nested: Db) => Promise<unknown>) =>
								callback(scopedDb);
						return Reflect.get(target, property, receiver);
					},
				}) as Db;
				const queries = Object.fromEntries(
					registry.metrics
						.filter((metric) => metric.automated)
						.map((metric) => [
							metric.id,
							{
								queryText: `SELECT 1 AS ${metric.id}`,
								databaseExternalId: "qbr-verification-test",
							},
						]),
				);
				await new AtlasQbrService(scopedDb).register(queries);
				const questions = new Map<string, { id: string; queryHash: string }>();
				for (const metricId of metricIds) {
					const question = await tx.question.findUniqueOrThrow({
						where: {
							connector_sourceExternalId: {
								connector: "ATLAS",
								sourceExternalId: `qbr:${metricId}`,
							},
						},
						include: { versions: { orderBy: { version: "desc" }, take: 1 } },
					});
					const latest = question.versions[0];
					const metadata = (
						latest?.visualization as { qbr?: { queryHash?: string } } | null
					)?.qbr;
					if (!latest || !metadata?.queryHash)
						throw new Error(`Missing registered QBR query for ${metricId}.`);
					if (!question.sourceId)
						throw new Error(
							`Missing source for registered QBR query ${metricId}.`,
						);
					questions.set(metricId, {
						id: question.id,
						queryHash: metadata.queryHash,
					});
					await tx.resultSnapshot.deleteMany({
						where: {
							sourceId: question.sourceId,
							questionExternalId: `qbr:${metricId}`,
							reportingPeriod: "2026-Q3",
						},
					});
				}
				await fn(tx, scopedDb, questions);
				throw rollback;
			},
			{ timeout: 60_000 },
		),
	).rejects.toBe(rollback);
}

const evidence = {
	label: "Reviewed source evidence",
	url: "https://evidence.example/qbr-review",
};

function reviewInput(
	metricId: string,
	snapshotId: string,
	definitionHash: string,
) {
	return {
		metricId,
		snapshotId,
		definitionHash,
		observations: [
			{
				period: "2026-Q3",
				dataThrough: "2026-10-01T00:00:00.000Z",
				verification: {
					verifiedBy: "Integration reviewer",
					verifiedAt: new Date().toISOString(),
					definition: evidence,
					population: evidence,
					coverage: evidence,
					reconciliation: evidence,
				},
			},
		],
	};
}

describe.skipIf(!localDatabase)("QBR verification persistence", () => {
	it("promotes only an exact managed manual placeholder and keeps its history", async () => {
		const rollback = new Error("rollback disposable QBR registration fixture");
		await expect(
			db.$transaction(
				async (tx) => {
					let scopedDb: Db;
					scopedDb = new Proxy(tx as unknown as Db, {
						get(target, property, receiver) {
							if (property === "$transaction")
								return (callback: (client: Db) => Promise<unknown>) =>
									callback(scopedDb);
							return Reflect.get(target, property, receiver);
						},
					}) as Db;
					const service = new AtlasQbrService(scopedDb);
					const queries = Object.fromEntries(
						registry.metrics
							.filter((metric) => metric.automated)
							.map((metric) => [
								metric.id,
								{
									queryText: `SELECT 1 AS ${metric.id}`,
									databaseExternalId: "qbr-verification-test",
								},
							]),
					);
					await service.register(queries);
					const metric = registry.metrics.find(
						(candidate) => candidate.id === "plg_teams",
					);
					if (!metric) throw new Error("Missing plg_teams fixture metric.");
					const question = await tx.question.findUniqueOrThrow({
						where: {
							connector_sourceExternalId: {
								connector: DataSourceKind.ATLAS,
								sourceExternalId: "qbr:plg_teams",
							},
						},
						include: { versions: { orderBy: { version: "desc" }, take: 1 } },
					});
					const initialVersion = question.versions[0];
					if (!initialVersion)
						throw new Error("Missing registered QBR version.");
					const originalId = question.id;
					const originalNumber = question.publicNumber;
					const queryText = `qbr:manual:${metric.id}`;
					const visualization = initialVersion.visualization as Record<
						string,
						unknown
					>;
					const metadata = visualization.qbr as Record<string, unknown>;
					const manualVisualization = {
						...visualization,
						qbr: {
							...metadata,
							automated: false,
							queryHash: hash({ queryText, databaseExternalId: null }),
						},
					};
					await tx.question.update({
						where: { id: question.id },
						data: {
							status: QuestionStatus.DRAFT,
							databaseExternalId: null,
						},
					});
					await tx.questionVersion.create({
						data: {
							questionId: question.id,
							version: initialVersion.version + 1,
							queryLanguage: QueryLanguage.API,
							queryText,
							display: initialVersion.display,
							sourceCardExternalId: initialVersion.sourceCardExternalId,
							visualization: manualVisualization,
							createdBy: "atlas-qbr",
						},
					});
					const preparationHistory = [
						{
							questionId: question.id,
							quarter: "2026-Q3",
							version: 1,
							preparation: { gap: "private fixture history one" },
						},
						{
							questionId: question.id,
							quarter: "2026-Q3",
							version: 2,
							preparation: { gap: "private fixture history two" },
						},
					];
					await tx.qbrPreparation.createMany({ data: preparationHistory });

					const editedQueryText = "SELECT 99 AS user_edited_plg_teams";
					await tx.questionVersion.update({
						where: {
							questionId_version: {
								questionId: question.id,
								version: initialVersion.version + 1,
							},
						},
						data: {
							queryText: editedQueryText,
							visualization: {
								...manualVisualization,
								qbr: {
									...metadata,
									automated: false,
									queryHash: hash({
										queryText: editedQueryText,
										databaseExternalId: null,
									}),
								},
							},
						},
					});
					await expect(service.register(queries)).rejects.toThrow(
						"unexpected or user-edited state",
					);
					let current = await tx.question.findUniqueOrThrow({
						where: { id: question.id },
						include: { versions: { orderBy: { version: "desc" }, take: 1 } },
					});
					expect(current).toMatchObject({
						id: originalId,
						publicNumber: originalNumber,
						status: QuestionStatus.DRAFT,
						databaseExternalId: null,
					});
					expect(current.versions[0]).toMatchObject({
						version: initialVersion.version + 1,
						queryText: editedQueryText,
					});

					await tx.questionVersion.update({
						where: {
							questionId_version: {
								questionId: question.id,
								version: initialVersion.version + 1,
							},
						},
						data: {
							queryText,
							visualization: manualVisualization,
						},
					});
					const registered = await service.register(queries);
					current = await tx.question.findUniqueOrThrow({
						where: { id: question.id },
						include: { versions: { orderBy: { version: "desc" }, take: 1 } },
					});
					const promotedVersion = current.versions[0];
					expect(registered.plg_teams).toBe(originalNumber);
					expect(current).toMatchObject({
						id: originalId,
						publicNumber: originalNumber,
						status: QuestionStatus.ACTIVE,
						databaseExternalId: "qbr-verification-test",
					});
					expect(promotedVersion).toMatchObject({
						version: initialVersion.version + 2,
						queryLanguage: QueryLanguage.SQL,
						queryText: queries.plg_teams!.queryText,
						createdBy: "atlas-qbr",
					});
					expect(
						await tx.questionVersion.count({
							where: { questionId: question.id },
						}),
					).toBe(initialVersion.version + 2);
					expect(
						await tx.qbrPreparation.findMany({
							where: { questionId: question.id },
							orderBy: { version: "asc" },
						}),
					).toMatchObject(preparationHistory);
					throw rollback;
				},
				{ timeout: 60_000 },
			),
		).rejects.toBe(rollback);
	});

	it("verifies manual input, preserves its attribution, rejects provisional replacement, and catches a query race", async () => {
		await withRollbackFixture(
			["plg_teams"],
			async (_tx, scopedDb, questions) => {
				const service = new AtlasQbrService(scopedDb);
				const metric = registry.metrics.find(
					(candidate) => candidate.id === "plg_teams",
				);
				if (!metric) throw new Error("Missing plg_teams fixture metric.");
				const definitionHash = hash({
					definition: metric.definition,
					unit: metric.unit,
				});
				const saved = await service.recordObservations("plg_teams", [
					{
						period: "2026-Q3",
						value: 542,
						numerator: null,
						denominator: null,
						status: "reported",
						reportedBy: "Finance owner",
						evidenceSource: evidence,
						asOf: "2026-10-01T00:00:00.000Z",
						dataThrough: null,
					},
				]);
				await service.verifyObservations(
					reviewInput("plg_teams", saved.snapshotId, definitionHash),
				);
				const verified = (await service.exportReport("2026-Q3")).metrics
					.plg_teams?.observations["2026-Q3"];
				expect(verified).toMatchObject({
					value: 542,
					status: "verified",
					reportedBy: "Finance owner",
					sourceQueryHash: questions.get("plg_teams")?.queryHash,
					verification: {
						reviewedQueryHash: questions.get("plg_teams")?.queryHash,
					},
				});
				await expect(
					service.recordObservations("plg_teams", [
						{
							period: "2026-Q3",
							value: 543,
							numerator: null,
							denominator: null,
							status: "provisional",
							evidenceSource: evidence,
							asOf: "2026-10-02T00:00:00.000Z",
							dataThrough: "2026-10-01T00:00:00.000Z",
						},
					]),
				).rejects.toThrow("cannot replace reported");

				const questionId = questions.get("plg_teams")?.id;
				if (!questionId) throw new Error("Missing QBR question fixture.");
				const racedDb = new Proxy(scopedDb, {
					get(target, property, receiver) {
						if (property === "$transaction")
							return (callback: (tx: Db) => Promise<unknown>) =>
								scopedDb.$transaction(async (tx) => {
									const nextQueryHash = "query-changed-during-review";
									await tx.questionVersion.create({
										data: {
											questionId,
											version: 2,
											queryLanguage: QueryLanguage.API,
											queryText: "SELECT 2 AS plg_teams",
											display: "table",
											visualization: {
												qbr: {
													metricId: "plg_teams",
													definitionHash,
													queryHash: nextQueryHash,
													automated: metric.automated,
												},
											},
											createdBy: "atlas-qbr",
										},
									});
									return callback(tx as unknown as Db);
								});
						return Reflect.get(target, property, receiver);
					},
				}) as Db;
				const racingService = new AtlasQbrService(racedDb);
				await expect(
					racingService.verifyObservations(
						reviewInput(
							"plg_teams",
							verified?.snapshotId ?? saved.snapshotId,
							definitionHash,
						),
					),
				).rejects.toThrow("source query changed");
			},
		);
	});

	it("invalidates provisional reviews when a later refresh saves a new snapshot", async () => {
		await withRollbackFixture(["plg_teams"], async (_tx, scopedDb) => {
			const service = new AtlasQbrService(scopedDb);
			const metric = registry.metrics.find(
				(candidate) => candidate.id === "plg_teams",
			);
			if (!metric) throw new Error("Missing plg_teams fixture metric.");
			const definitionHash = hash({
				definition: metric.definition,
				unit: metric.unit,
			});
			const first = await service.recordObservations("plg_teams", [
				{
					period: "2026-Q3",
					value: 542,
					numerator: null,
					denominator: null,
					status: "provisional",
					evidenceSource: evidence,
					asOf: "2026-10-01T00:00:00.000Z",
					dataThrough: null,
				},
			]);
			await service.verifyObservations(
				reviewInput("plg_teams", first.snapshotId, definitionHash),
			);
			const refreshed = await service.recordObservations("plg_teams", [
				{
					period: "2026-Q3",
					value: 543,
					numerator: null,
					denominator: null,
					status: "provisional",
					evidenceSource: evidence,
					asOf: "2026-10-02T00:00:00.000Z",
					dataThrough: null,
				},
			]);
			expect(
				(await service.exportReport("2026-Q3")).metrics.plg_teams?.observations[
					"2026-Q3"
				],
			).toMatchObject({ value: 543, status: "provisional" });
			await expect(
				service.verifyObservations(
					reviewInput("plg_teams", first.snapshotId, definitionHash),
				),
			).rejects.toThrow("answer changed or is missing");
			expect(refreshed.snapshotId).not.toBe(first.snapshotId);
		});
	});

	it("rejects verified percentage evidence whose numerator and denominator do not reconcile", async () => {
		await withRollbackFixture(["plg_active_rate"], async (_tx, scopedDb) => {
			const service = new AtlasQbrService(scopedDb);
			const metric = registry.metrics.find(
				(candidate) => candidate.id === "plg_active_rate",
			);
			if (!metric) throw new Error("Missing plg_active_rate fixture metric.");
			const definitionHash = hash({
				definition: metric.definition,
				unit: metric.unit,
			});
			const saved = await service.recordObservations("plg_active_rate", [
				{
					period: "2026-Q3",
					value: 80,
					numerator: 9,
					denominator: 10,
					status: "reported",
					reportedBy: "Product owner",
					evidenceSource: evidence,
					asOf: "2026-10-01T00:00:00.000Z",
					dataThrough: null,
				},
			]);
			await expect(
				service.verifyObservations(
					reviewInput("plg_active_rate", saved.snapshotId, definitionHash),
				),
			).rejects.toThrow("percentages require a numerator and denominator");
			expect(
				(await service.exportReport("2026-Q3")).metrics.plg_active_rate
					?.observations["2026-Q3"]?.status,
			).toBe("reported");
			const reconciled = await service.recordObservations("plg_active_rate", [
				{
					period: "2026-Q3",
					value: 90,
					numerator: 9,
					denominator: 10,
					status: "reported",
					reportedBy: "Product owner",
					evidenceSource: evidence,
					asOf: "2026-10-02T00:00:00.000Z",
					dataThrough: null,
				},
			]);
			await service.verifyObservations(
				reviewInput("plg_active_rate", reconciled.snapshotId, definitionHash),
			);
			expect(
				(await service.exportReport("2026-Q3")).metrics.plg_active_rate
					?.observations["2026-Q3"],
			).toMatchObject({
				value: 90,
				numerator: 9,
				denominator: 10,
				status: "verified",
			});
		});
	});
});
