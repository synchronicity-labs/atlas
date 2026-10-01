import { describe, expect, mock, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Db } from "@crm/db";
import { QueryLanguage } from "@crm/db";
import { ConflictException } from "@nestjs/common";
import { AtlasQbrService } from "./qbr.service";
import registry from "./registry.json";

const hash = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
const definitionHash = (id: string) => {
	const metric = registry.metrics.find((item) => item.id === id);
	if (!metric) throw new Error(`Missing test metric ${id}.`);
	return hash({ definition: metric.definition, unit: metric.unit });
};
const observation = (
	period: string,
	value: number,
	overrides: Record<string, unknown> = {},
) => ({
	period,
	value,
	numerator: null,
	denominator: null,
	status: "provisional" as const,
	evidenceSource: { label: "Evidence", url: "https://evidence.example/report" },
	asOf: new Date().toISOString(),
	dataThrough: null,
	...overrides,
});

function registeredQuestion(id: string, publicNumber = 215) {
	return {
		id: `question-${id}`,
		publicNumber,
		sourceId: "atlas-qbr-source",
		versions: [
			{
				visualization: {
					qbr: { metricId: id, definitionHash: definitionHash(id) },
				},
			},
		],
	};
}

describe("AtlasQbrService", () => {
	test("accepts a mature May-to-July cohort but never accepts caller-asserted verification", async () => {
		const transaction = mock(async () => ({}));
		const service = new AtlasQbrService({
			$transaction: transaction,
		} as unknown as Db);
		const cohort = observation("2026-07", 75, { cohortMonth: "2026-05" });
		await service.recordObservations("product_m3_ndr", [cohort]);
		expect(transaction).toHaveBeenCalledTimes(1);
		await expect(
			service.recordObservations("product_m3_ndr", [
				{ ...cohort, status: "verified" as never },
			]),
		).rejects.toThrow("never verified");
	});
	test("stores array rows, merges months, and keeps an identical submission idempotent", async () => {
		setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
		const state: { latest?: Record<string, unknown> } = {};
		let created = 0;
		const tx = {
			$executeRaw: mock(async () => 1),
			question: {
				findUnique: mock(async () => registeredQuestion("plg_teams")),
			},
			resultSnapshot: {
				findFirst: mock(async () => state.latest ?? null),
				findUnique: mock(
					async ({ where }: { where: { idempotencyKey: string } }) =>
						state.latest?.idempotencyKey === where.idempotencyKey
							? { id: state.latest.id }
							: null,
				),
				create: mock(async ({ data }: { data: Record<string, unknown> }) => {
					created += 1;
					state.latest = data;
					return { id: data.id };
				}),
			},
		};
		const db = {
			$transaction: (fn: (arg: typeof tx) => unknown) => fn(tx),
		} as unknown as Db;
		const service = new AtlasQbrService(db);

		const july = observation("2026-07", 12);
		await service.recordObservations("plg_teams", [observation("2026-06", 10)]);
		await service.recordObservations("plg_teams", [
			july,
			observation("2026-08", 13),
			observation("2026-09", 14),
			observation("2026-Q3", 12, { status: "reported", reportedBy: "Finance" }),
		]);
		const snapshot = state.latest as {
			columns: Array<{ name: string }>;
			rows: unknown[][];
			rowCount: number;
		};
		expect(snapshot.rowCount).toBe(5);
		expect(snapshot.rows.every(Array.isArray)).toBe(true);
		expect(snapshot.columns.map(({ name }) => name)).toContain(
			"evidenceSource",
		);
		expect(
			snapshot.rows.map(
				(row) =>
					row[snapshot.columns.findIndex(({ name }) => name === "period")],
			),
		).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-Q3"]);
		const result = await service.recordObservations("plg_teams", [july]);
		expect(created).toBe(2);
		expect(result.observationCount).toBe(1);
		setSystemTime();
	});

	test("rejects open periods, invalid evidence, and invalid reported input before writing", async () => {
		setSystemTime(new Date("2026-09-30T23:59:00.000Z"));
		const db = { $transaction: mock() } as unknown as Db;
		const service = new AtlasQbrService(db);
		await expect(
			service.recordObservations("plg_teams", [observation("2026-09", 4)]),
		).rejects.toThrow("not closed");
		await expect(
			service.recordObservations("plg_teams", [
				observation("2026-07", 4, { denominator: 0 }),
			]),
		).rejects.toThrow("denominator");
		await expect(
			service.recordObservations("plg_teams", [
				observation("2026-07", 4, { dataThrough: "2026-07-31T23:59:59.000Z" }),
			]),
		).rejects.toThrow("period close");
		await expect(
			service.recordObservations("plg_teams", [
				observation("2026-07", 4, {
					evidenceSource: {
						label: "Bad",
						url: "https://user:pass@example.test",
					},
				}),
			]),
		).rejects.toThrow("without embedded credentials");
		await expect(
			service.recordObservations("finance_runway", [
				observation("2026-07", -1, {
					status: "reported",
					reportedBy: "Finance",
				}),
			]),
		).rejects.toThrow("Runway must");
		await expect(
			service.recordObservations("product_m3_ndr", [observation("2026-08", 4)]),
		).rejects.toThrow("cohortMonth");
		await expect(
			service.recordObservations("product_m3_ndr", [
				observation("2026-08", 4, { cohortMonth: "2026-05" }),
			]),
		).rejects.toThrow("cohortMonth");
		await expect(
			service.recordObservations("plg_teams", [
				observation("2026-07", 4, { asOf: "2999-07-01T00:00:00.000Z" }),
			]),
		).rejects.toThrow("future");
		expect(db.$transaction).not.toHaveBeenCalled();
		setSystemTime();
	});

	test("keeps reported observations from being replaced by provisional refreshes", async () => {
		const cols = [
			"period",
			"value",
			"numerator",
			"denominator",
			"status",
			"evidenceSource",
			"asOf",
			"dataThrough",
			"cohortMonth",
			"reportedBy",
			"definitionHash",
			"source_label",
			"source_url",
			"snapshotId",
		];
		const oldRow = [
			"2026-07",
			10,
			null,
			null,
			"reported",
			{ label: "Evidence", url: "https://evidence.example/report" },
			"2026-08-01T00:00:00.000Z",
			null,
			null,
			"Operator",
			definitionHash("plg_teams"),
			"Atlas question 215",
			"https://atlas.pr.sync.so/questions/215",
			"old-snapshot",
		];
		const tx = {
			$executeRaw: mock(async () => 1),
			question: {
				findUnique: mock(async () => registeredQuestion("plg_teams")),
			},
			resultSnapshot: {
				findFirst: mock(async () => ({
					id: "old-snapshot",
					rows: [oldRow],
					columns: cols.map((name) => ({ name })),
				})),
				findUnique: mock(async () => null),
				create: mock(),
			},
		};
		const db = {
			$transaction: (fn: (arg: typeof tx) => unknown) => fn(tx),
		} as unknown as Db;
		const service = new AtlasQbrService(db);
		await expect(
			service.recordObservations("plg_teams", [observation("2026-07", 11)]),
		).rejects.toThrow(ConflictException);
		expect(tx.resultSnapshot.create).not.toHaveBeenCalled();
	});

	test("register reruns preserve question numbers and append a new Atlas-owned SQL version", async () => {
		type Stored = {
			id: string;
			number: number;
			publicNumber: number;
			name: string;
			description: string;
			sourceId: string;
			status: string;
			purpose: string;
			databaseExternalId: string | null;
			versions: Array<{
				version: number;
				queryLanguage: QueryLanguage;
				queryText: string;
				visualization: Record<string, unknown>;
				createdBy: string;
			}>;
		};
		const questions = new Map<string, Stored>();
		let nextNumber = 0;
		const tx = {
			$executeRaw: mock(async () => 1),
			dataSource: { upsert: mock(async () => ({ id: "atlas-qbr-source" })) },
			question: {
				findMany: mock(async () =>
					[...questions.entries()].map(([sourceExternalId, question]) => ({
						...question,
						sourceExternalId,
					})),
				),
				aggregate: mock(async () => ({ _max: { number: nextNumber } })),
				createMany: mock(
					async ({ data }: { data: Record<string, unknown>[] }) => {
						for (const input of data) {
							nextNumber = Number(input.number);
							questions.set(String(input.sourceExternalId), {
								id: String(input.id),
								number: nextNumber,
								publicNumber: nextNumber + 1000,
								name: String(input.name),
								description: String(input.description),
								sourceId: String(input.sourceId),
								status: String(input.status),
								purpose: String(input.purpose),
								databaseExternalId:
									input.databaseExternalId == null
										? null
										: String(input.databaseExternalId),
								versions: [],
							});
						}
						return { count: data.length };
					},
				),
				update: mock(
					async ({
						where,
						data,
					}: {
						where: { id: string };
						data: {
							databaseExternalId?: string | null;
							description?: string;
						};
					}) => {
						const entry = [...questions.values()].find(
							(item) => item.id === where.id,
						);
						if (!entry) throw new Error("Missing registered question.");
						if ("databaseExternalId" in data)
							entry.databaseExternalId = data.databaseExternalId ?? null;
						if (data.description !== undefined)
							entry.description = data.description;
						return entry;
					},
				),
			},
			questionVersion: {
				createMany: mock(
					async ({
						data,
					}: {
						data: Array<Stored["versions"][number] & { questionId: string }>;
					}) => {
						for (const version of data) {
							const entry = [...questions.values()].find(
								(question) => question.id === version.questionId,
							);
							if (!entry) throw new Error("Missing registered question.");
							entry.versions.unshift(version);
						}
						return { count: data.length };
					},
				),
				create: mock(
					async ({
						data,
					}: {
						data: Stored["versions"][number] & { questionId: string };
					}) => {
						const entry = [...questions.values()].find(
							(item) => item.id === data.questionId,
						);
						if (!entry) throw new Error("Missing registered question.");
						entry.versions.unshift(data);
						return data;
					},
				),
			},
		};
		const db = {
			$transaction: (fn: (arg: typeof tx) => unknown) => fn(tx),
		} as unknown as Db;
		const service = new AtlasQbrService(db);
		const queries = Object.fromEntries(
			registry.metrics
				.filter(({ automated }) => automated)
				.map(({ id }) => [
					id,
					{ queryText: `select '${id}'`, databaseExternalId: "166" },
				]),
		);
		const first = await service.register(queries);
		const originalNumber = first.plg_teams;
		await service.register(queries);
		expect(tx.questionVersion.create).not.toHaveBeenCalled();
		const migrationQuestion = questions.get("qbr:product_reactivation");
		if (!migrationQuestion)
			throw new Error("Registered migration question is missing.");
		migrationQuestion.description = readFileSync(
			new URL(
				"./product_reactivation.previous-description.txt",
				import.meta.url,
			),
			"utf8",
		);
		await service.register(queries);
		const currentDescription = migrationQuestion.description;
		expect(currentDescription).not.toBe(
			readFileSync(
				new URL(
					"./product_reactivation.previous-description.txt",
					import.meta.url,
				),
				"utf8",
			),
		);
		migrationQuestion.description = "User-edited description";
		await expect(service.register(queries)).rejects.toThrow(ConflictException);
		migrationQuestion.description = currentDescription;
		const changed = {
			...queries,
			plg_teams: {
				queryText: "select 'plg_teams', '2026-10-01'",
				databaseExternalId: "166",
			},
		};
		const rerun = await service.register(changed);
		expect(rerun.plg_teams).toBe(originalNumber);
		expect(tx.questionVersion.create).toHaveBeenCalledTimes(1);
		expect(questions.get("qbr:plg_teams")?.versions[0]?.queryText).toBe(
			changed.plg_teams.queryText,
		);
	});

	test("exports observations in one batch with canonical question URLs and separate evidence URLs", async () => {
		const question = {
			publicNumber: 246,
			sourceId: "atlas-qbr-source",
			sourceExternalId: "qbr:finance_net_burn",
			versions: [
				{
					visualization: {
						qbr: {
							metricId: "finance_net_burn",
							definitionHash: definitionHash("finance_net_burn"),
						},
					},
				},
			],
		};
		const names = [
			"period",
			"value",
			"numerator",
			"denominator",
			"status",
			"evidenceSource",
			"asOf",
			"dataThrough",
			"cohortMonth",
			"reportedBy",
			"definitionHash",
			"source_label",
			"source_url",
			"snapshotId",
		];
		const values = [
			"2026-07",
			9200,
			null,
			null,
			"reported",
			{ label: "Finance close", url: "https://finance.example/close" },
			"2026-08-01T00:00:00.000Z",
			null,
			null,
			"Finance owner",
			definitionHash("finance_net_burn"),
			"Atlas question 246",
			"https://atlas.pr.sync.so/questions/246",
			"snapshot-qbr",
		];
		const questionsFindMany = mock(async () => [question]);
		const snapshotsFindMany = mock(async () => [
			{
				id: "snapshot-qbr",
				sourceId: "atlas-qbr-source",
				questionExternalId: "qbr:finance_net_burn",
				rows: [values],
				columns: names.map((name) => ({ name })),
			},
		]);
		const db = {
			question: { findMany: questionsFindMany },
			resultSnapshot: { findMany: snapshotsFindMany },
		} as unknown as Db;
		const report = await new AtlasQbrService(db).exportReport("2026-Q3");
		const metric = report.metrics.finance_net_burn as {
			question: { url: string };
			observations: Record<
				string,
				{
					source: { url: string };
					evidenceSource: { url: string };
					reportedBy: string;
				}
			>;
		};
		expect(questionsFindMany).toHaveBeenCalledTimes(1);
		expect(snapshotsFindMany).toHaveBeenCalledTimes(1);
		expect(metric.question.url).toBe("https://atlas.pr.sync.so/questions/246");
		expect(metric.observations["2026-07"]?.source.url).toBe(
			metric.question.url,
		);
		expect(metric.observations["2026-07"]?.evidenceSource.url).toBe(
			"https://finance.example/close",
		);
		expect(metric.observations["2026-07"]?.reportedBy).toBe("Finance owner");
	});
});
