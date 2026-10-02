import { describe, expect, mock, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Db } from "@crm/db";
import { QueryLanguage } from "@crm/db";
import { BadRequestException, ConflictException } from "@nestjs/common";
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

const privatePreparation = (metricId = "plg_teams") => {
	const canonical = registry.metrics.find(
		(metric) => metric.id === metricId,
	)?.preparation;
	if (!canonical) throw new Error("Missing fixture metric.");
	return {
		owner: canonical.owner,
		ownerStatus: canonical.ownerStatus,
		ownerSource: canonical.ownerSource,
		workstream: canonical.workstream,
		gap: "Received a sample; full-period evidence is missing.",
		dataLocation: "Private sample folder; source link below.",
		manualAsk: "Provide the remaining monthly records.",
		q4Build: "Capture evidence monthly with an accountable reviewer.",
		sources: [
			{
				label: "Generic private sample",
				url: "https://evidence.example/private/sample",
				limit: "Partial coverage only; no numeric claim.",
			},
		],
	};
};

function registeredQuestion(id: string, publicNumber = 215) {
	return {
		id: `question-${id}`,
		publicNumber,
		sourceId: "atlas-qbr-source",
		versions: [
			{
				visualization: {
					qbr: {
						metricId: id,
						definitionHash: definitionHash(id),
						queryHash: "source-query-hash",
					},
				},
			},
		],
	};
}

describe("AtlasQbrService", () => {
	test("verification binds reviewed values to an unchanged snapshot and refresh invalidates that review", async () => {
		setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
		try {
			let latest: Record<string, unknown> | null = null;
			const createdSnapshots: { rows: unknown[][] }[] = [];
			const question = {
				...registeredQuestion("plg_teams"),
				sourceExternalId: "qbr:plg_teams",
				qbrPreparations: [],
			};
			const tx = {
				$executeRaw: mock(async () => 1),
				question: {
					findUnique: mock(async () => question),
					findMany: mock(async () => [question]),
				},
				resultSnapshot: {
					findFirst: mock(async () => latest),
					findMany: mock(async () => (latest ? [latest] : [])),
					findUnique: mock(async () => null),
					create: mock(async ({ data }: { data: Record<string, unknown> }) => {
						latest = data;
						createdSnapshots.push({ rows: data.rows as unknown[][] });
						return { id: data.id };
					}),
				},
			};
			const db = {
				...tx,
				$transaction: (fn: (arg: typeof tx) => unknown) => fn(tx),
			} as unknown as Db;
			const service = new AtlasQbrService(db);
			const initial = await service.recordObservations("plg_teams", [
				observation("2026-Q3", 542, {
					evidenceSource: {
						label:
							"Atlas governed source query; current-clean history; source-close verification pending",
						url: "https://evidence.example/q3",
					},
				}),
			]);
			const evidence = {
				label: "Reviewed source evidence",
				url: "https://evidence.example/q3",
			};
			const review = {
				metricId: "plg_teams",
				snapshotId: initial.snapshotId,
				definitionHash: definitionHash("plg_teams"),
				observations: [
					{
						period: "2026-Q3",
						dataThrough: "2026-10-01T00:00:00.000Z",
						verification: {
							verifiedBy: "Source reviewer",
							verifiedAt: "2026-10-02T12:00:00.000Z",
							definition: evidence,
							population: evidence,
							coverage: evidence,
							reconciliation: evidence,
						},
					},
				],
			};
			await expect(
				service.verifyObservations({ ...review, definitionHash: "changed" }),
			).rejects.toThrow("changed");
			await expect(
				service.verifyObservations({
					...review,
					observations: [
						{
							...review.observations[0],
							dataThrough: "2026-09-30T23:59:59.000Z",
						},
					],
				}),
			).rejects.toThrow("period close");
			await expect(
				service.verifyObservations({
					...review,
					observations: [
						{
							...review.observations[0],
							verification: {
								...review.observations[0]?.verification,
								coverage: undefined,
							},
						},
					],
				}),
			).rejects.toThrow("Invalid QBR verification");
			tx.resultSnapshot.findFirst.mockImplementationOnce(async () => ({
				...latest,
				id: "concurrent-refresh",
			}));
			await expect(service.verifyObservations(review)).rejects.toThrow(
				"changed during verification",
			);
			await service.verifyObservations(review);
			let result = (await service.exportReport("2026-Q3")).metrics.plg_teams
				?.observations["2026-Q3"];
			expect(result).toMatchObject({
				value: 542,
				status: "verified",
				asOf: "2026-10-02T12:00:00.000Z",
				evidenceSource: {
					label: "Atlas governed source query; current-clean history",
				},
			});
			expect(result?.verification?.reviewedSnapshotId).toBe(initial.snapshotId);
			const sourceMetadata = question.versions[0]?.visualization.qbr;
			if (!sourceMetadata) throw new Error("Missing QBR source metadata.");
			sourceMetadata.queryHash = "changed-query-hash";
			await expect(service.verifyObservations(review)).rejects.toThrow(
				"source query",
			);
			await expect(service.exportReport("2026-Q3")).rejects.toThrow(
				"another source query",
			);
			sourceMetadata.queryHash = "source-query-hash";
			await service.recordObservations(
				"plg_teams",
				[observation("2026-07", 7), observation("2026-09", 9)],
				{ replaceMissingAutomatedPeriods: true },
			);
			const partial = (await service.exportReport("2026-Q3")).metrics.plg_teams
				?.observations;
			expect(partial?.["2026-Q3"]).toBeUndefined();
			expect(partial?.["2026-08"]).toBeUndefined();
			expect(partial?.["2026-07"]?.value).toBe(7);
			expect(partial?.["2026-09"]?.value).toBe(9);
			expect(
				createdSnapshots.some((snapshot) =>
					snapshot.rows.some(
						(row) => row[0] === "2026-Q3" && row[4] === "verified",
					),
				),
			).toBe(true);
			await expect(service.verifyObservations(review)).rejects.toThrow(
				"changed",
			);
			await service.recordObservations("plg_teams", [
				observation("2026-Q3", 543),
			]);
			result = (await service.exportReport("2026-Q3")).metrics.plg_teams
				?.observations["2026-Q3"];
			expect(result?.value).toBe(543);
			expect(result?.status).toBe("provisional");
			expect(result?.verification).toBeUndefined();
			await service.recordObservations(
				"plg_teams",
				[observation("2026-07", 7), observation("2026-09", 9)],
				{ replaceMissingAutomatedPeriods: true },
			);
			const refreshed = (await service.exportReport("2026-Q3")).metrics
				.plg_teams?.observations;
			expect(refreshed?.["2026-Q3"]).toBeUndefined();
			expect(refreshed?.["2026-08"]).toBeUndefined();
		} finally {
			setSystemTime();
		}
	});

	test("rejects invalid preparation batches before opening a transaction", async () => {
		const db = { $transaction: mock() } as unknown as Db;
		const service = new AtlasQbrService(db);
		const item = { metricId: "plg_teams", preparation: privatePreparation() };
		const batch = { quarter: "2026-Q3", preparations: [item] };
		for (const input of [
			null,
			{ ...batch, quarter: "2026-Q4" },
			{ ...batch, preparations: [] },
			{ ...batch, certification: "CERTIFIED" },
			{ ...batch, preparations: [item, { ...item, metricId: "unknown" }] },
			{ ...batch, preparations: [item, item] },
			{ ...batch, preparations: Array(136).fill(item) },
			...[
				{ gap: " " },
				{ gap: "x".repeat(4_001) },
				{ value: 42 },
				{ certification: "CERTIFIED" },
				{ owner: "Changed owner" },
				{ ownerStatus: "Changed status" },
				{ workstream: "changed" },
				{
					ownerSource: {
						label: "Changed source",
						url: "https://evidence.example/owner",
					},
				},
				{ sources: Array(21).fill(item.preparation.sources[0]) },
				...[
					"not-a-url",
					"http://evidence.example",
					"https://user:pass@evidence.example",
					"javascript:alert(1)",
				].map((url) => ({ sources: [{ label: "Invalid source", url }] })),
				{
					supportingResults: [
						{
							label: "Source rows",
							asOf: "2026-10-01T12:00:00.000Z",
							source: {
								label: "Evidence",
								url: "https://evidence.example/report",
							},
							queryText: '{"dataset":"sample"}',
							columns: ["Month", "Usage"],
							rows: [["2026-07"]],
							limitations: "Partial period only.",
						},
					],
				},
				{
					supportingResults: [
						{
							label: "Source rows",
							asOf: "2999-10-01T12:00:00.000Z",
							source: {
								label: "Evidence",
								url: "https://evidence.example/report",
							},
							queryText: '{"dataset":"sample"}',
							columns: ["Month", "Usage"],
							rows: [["2026-07", 42]],
							limitations: "Partial period only.",
						},
					],
				},
				{
					supportingResults: [
						{
							label: "Source rows",
							asOf: "2026-10-01T12:00:00.000Z",
							source: {
								label: "Evidence",
								url: "http://evidence.example/report",
							},
							queryText: '{"dataset":"sample"}',
							columns: ["Month", "Usage"],
							rows: [["2026-07", 42]],
							limitations: "Partial period only.",
						},
					],
				},
			].map((change) => ({
				...batch,
				preparations: [
					item,
					{
						metricId: "finance_net_burn",
						preparation: {
							...privatePreparation("finance_net_burn"),
							...change,
						},
					},
				],
			})),
		])
			await expect(service.importPreparations(input)).rejects.toThrow(
				BadRequestException,
			);
		expect(db.$transaction).not.toHaveBeenCalled();
	});

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

	test("keeps reportedBy verified observations from being replaced by automated refreshes", async () => {
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
			"verified",
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

	test("private preparations stay in separate version history and survive registration", async () => {
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
			qbrPreparations: Array<{
				quarter: string;
				version: number;
				preparation: unknown;
			}>;
			versions: Array<{
				version: number;
				queryLanguage: QueryLanguage;
				queryText: string;
				visualization: Record<string, unknown>;
				createdBy: string;
			}>;
		};
		const questions = new Map<string, Stored>();
		const privateRows: Array<{
			questionId: string;
			quarter: string;
			version: number;
			preparation: unknown;
		}> = [];
		let snapshot: Record<string, unknown> | undefined;
		let nextNumber = 0;
		const tx = {
			$executeRaw: mock(async () => 1),
			dataSource: {
				upsert: mock(async () => ({ id: "atlas-qbr-source" })),
				findUnique: mock(async () => ({ id: "atlas-qbr-source" })),
			},
			question: {
				findUnique: mock(
					async ({
						where,
					}: {
						where: { connector_sourceExternalId: { sourceExternalId: string } };
					}) =>
						questions.get(where.connector_sourceExternalId.sourceExternalId),
				),
				findMany: mock(
					async (args?: {
						include?: {
							qbrPreparations?: { where?: { quarter?: string }; take?: number };
						};
						select?: {
							qbrPreparations?: { where?: { quarter?: string }; take?: number };
						};
					}) =>
						[...questions.entries()].map(([sourceExternalId, question]) => ({
							...question,
							qbrPreparations: (() => {
								const selection =
									args?.include?.qbrPreparations ??
									args?.select?.qbrPreparations;
								return privateRows
									.filter(
										(row) =>
											row.questionId === question.id &&
											row.quarter === selection?.where?.quarter,
									)
									.sort((a, b) => b.version - a.version)
									.slice(0, selection?.take ?? 1);
							})(),
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
								qbrPreparations: [],
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
			resultSnapshot: {
				findFirst: mock(async () => snapshot ?? null),
				findMany: mock(async () => (snapshot ? [snapshot] : [])),
				findUnique: mock(async () => null),
				create: mock(async ({ data }: { data: Record<string, unknown> }) => {
					snapshot = data;
					return data;
				}),
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
			qbrPreparation: {
				createMany: mock(async ({ data }: { data: typeof privateRows }) => {
					privateRows.push(...structuredClone(data));
					return { count: data.length };
				}),
			},
		};
		const db = {
			$transaction: (fn: (arg: typeof tx) => unknown) => fn(tx),
			question: tx.question,
			resultSnapshot: tx.resultSnapshot,
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
		const question = questions.get("qbr:plg_teams");
		if (!question) throw new Error("Missing fixture question.");
		const original = structuredClone(question);
		const initialVersion = question.versions[0];
		if (!initialVersion) throw new Error("Missing fixture version.");
		const metadata = question.versions[0]?.visualization.qbr as Record<
			string,
			unknown
		>;
		initialVersion.visualization.customDisplay = { color: "blue" };
		metadata.futureMetadata = { preserved: true };
		await service.recordObservations("plg_teams", [
			observation("2026-07", 12, {
				status: "reported",
				reportedBy: "Generic reviewer",
			}),
		]);
		const before = await service.exportReport("2026-Q3");
		const storedSnapshot = structuredClone(snapshot);
		const questionVersionCreatesBeforePreparations =
			tx.questionVersion.create.mock.calls.length;
		const questionVersionCreateManyBeforePreparations =
			tx.questionVersion.createMany.mock.calls.length;
		const batch = {
			quarter: "2026-Q3",
			preparations: [
				{ metricId: "plg_teams", preparation: privatePreparation() },
				{
					metricId: "finance_net_burn",
					preparation: privatePreparation("finance_net_burn"),
				},
			],
		};
		const questionFindMany = tx.question.findMany;
		expect(await service.importPreparations(batch)).toEqual({
			quarter: "2026-Q3",
			imported: 2,
			unchanged: 0,
		});
		expect(questionFindMany.mock.calls.at(-1)?.[0]).toMatchObject({
			include: {
				qbrPreparations: {
					where: { quarter: "2026-Q3" },
					orderBy: { version: "desc" },
					take: 1,
				},
			},
		});
		expect(privateRows).toHaveLength(2);
		expect(tx.questionVersion.createMany).toHaveBeenCalledTimes(
			questionVersionCreateManyBeforePreparations,
		);
		expect(tx.questionVersion.create).toHaveBeenCalledTimes(
			questionVersionCreatesBeforePreparations,
		);
		expect(await service.importPreparations(batch)).toEqual({
			quarter: "2026-Q3",
			imported: 0,
			unchanged: 2,
		});
		const revised = {
			...privatePreparation(),
			gap: "Updated sample; full-period evidence is missing.",
		};
		expect(
			await service.importPreparations({
				quarter: "2026-Q3",
				preparations: [{ metricId: "plg_teams", preparation: revised }],
			}),
		).toEqual({ quarter: "2026-Q3", imported: 1, unchanged: 0 });
		expect(
			privateRows.filter((row) => row.questionId === question.id),
		).toHaveLength(2);
		expect(
			privateRows.find(
				(row) => row.questionId === question.id && row.version === 2,
			)?.preparation,
		).toEqual(revised);
		const after = await service.exportReport("2026-Q3");
		const beforeMetric = before.metrics.plg_teams;
		const afterMetric = after.metrics.plg_teams;
		if (!beforeMetric || !afterMetric)
			throw new Error("Missing fixture metric in exported report.");
		expect(afterMetric).toEqual({
			...beforeMetric,
			preparation: revised,
		});
		expect(after.metrics.finance_net_burn?.observations).toEqual({});
		expect(after.metrics.finance_net_burn?.preparation).toEqual(
			privatePreparation("finance_net_burn"),
		);
		expect(snapshot).toEqual(storedSnapshot);
		expect(tx.resultSnapshot.create).toHaveBeenCalledTimes(1);
		expect(question).toEqual({ ...original, versions: question.versions });
		expect(question.versions[0]?.queryText).toBe(
			original.versions[0]?.queryText,
		);
		expect(
			question.versions.every(
				(version) =>
					JSON.stringify(version.visualization).includes("preparation") ===
					false,
			),
		).toBe(true);
		const versionsBeforeFailure = structuredClone(question.versions);
		const manual = questions.get("qbr:finance_net_burn");
		if (!manual) throw new Error("Missing manual fixture.");
		const manualDescription = manual.description;
		manual.description = "User-edited description";
		await expect(
			service.importPreparations({
				...batch,
				preparations: batch.preparations.map((item) => ({
					...item,
					preparation: { ...item.preparation, gap: "Another missing source" },
				})),
			}),
		).rejects.toThrow(ConflictException);
		expect(question.versions).toEqual(versionsBeforeFailure);
		manual.description = manualDescription;
		const latestPrivateRow = privateRows.find(
			(row) => row.questionId === question.id && row.version === 2,
		);
		if (!latestPrivateRow)
			throw new Error("Missing latest private preparation fixture.");
		latestPrivateRow.preparation = {
			...privatePreparation(),
			unknownField: "Preserve future data",
		};
		await expect(service.importPreparations(batch)).rejects.toThrow(
			"unsupported fields",
		);
		latestPrivateRow.preparation = revised;
		await service.recordObservations("plg_teams", [observation("2026-08", 14)]);
		expect(
			(await service.exportReport("2026-Q3")).metrics.plg_teams?.preparation,
		).toEqual(revised);

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
		const latestVersion = question.versions[0];
		if (!latestVersion)
			throw new Error("Missing fixture version after registration.");
		expect(question.versions[0]?.visualization).toEqual({
			customDisplay: { color: "blue" },
			qbr: {
				...metadata,
				queryHash: (latestVersion.visualization.qbr as Record<string, unknown>)
					.queryHash,
			},
		});
		expect(
			question.versions.every(
				(version) =>
					JSON.stringify(version.visualization).includes("preparation") ===
					false,
			),
		).toBe(true);
		expect(
			(await service.exportReport("2026-Q3")).metrics.plg_teams?.preparation,
		).toEqual(revised);
		await service.register(changed);

		expect(questions.get("qbr:plg_teams")?.versions[0]?.queryText).toBe(
			changed.plg_teams.queryText,
		);
	});

	test("exports observation provenance per period with canonical question and evidence URLs", async () => {
		const question = {
			publicNumber: 246,
			sourceId: "atlas-qbr-source",
			sourceExternalId: "qbr:platform_latency",
			versions: [
				{
					visualization: {
						qbr: {
							metricId: "platform_latency",
							definitionHash: definitionHash("platform_latency"),
							queryHash: "governed-query-hash",
						},
					},
				},
			],
			qbrPreparations: [],
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
			"sourceQueryHash",
		];
		const values = [
			[
				"2026-07",
				9200,
				null,
				null,
				"reported",
				{ label: "Platform owner", url: "https://platform.example/review" },
				"2026-08-01T00:00:00.000Z",
				null,
				null,
				"Platform owner",
				definitionHash("platform_latency"),
				"Atlas question 246",
				"https://atlas.pr.sync.so/questions/246",
				"snapshot-qbr",
				"governed-query-hash",
			],
			[
				"2026-08",
				8800,
				null,
				null,
				"provisional",
				{
					label: "Atlas source query result",
					url: "https://atlas.pr.sync.so/questions/246",
				},
				"2026-09-01T00:00:00.000Z",
				null,
				null,
				null,
				definitionHash("platform_latency"),
				"Atlas question 246",
				"https://atlas.pr.sync.so/questions/246",
				"snapshot-qbr",
				"governed-query-hash",
			],
		];
		const questionsFindMany = mock(
			async (args: {
				select: {
					qbrPreparations: {
						where: { quarter: string };
						orderBy: { version: "desc" };
						take: number;
					};
				};
			}) => {
				void args;
				return [question];
			},
		);
		const snapshotsFindMany = mock(async () => [
			{
				id: "snapshot-qbr",
				sourceId: "atlas-qbr-source",
				questionExternalId: "qbr:platform_latency",
				rows: values,
				columns: names.map((name) => ({ name })),
			},
		]);
		const db = {
			question: { findMany: questionsFindMany },
			resultSnapshot: { findMany: snapshotsFindMany },
		} as unknown as Db;
		const report = await new AtlasQbrService(db).exportReport("2026-Q3");
		const metric = report.metrics.platform_latency as {
			question: { url: string };
			observations: Record<
				string,
				{
					source: { url: string };
					evidenceSource: { url: string };
					reportedBy?: string;
					sourceType: string;
					status: string;
					dataThrough: string | null;
				}
			>;
		};
		expect(questionsFindMany).toHaveBeenCalledTimes(1);
		expect(questionsFindMany.mock.calls[0]?.[0]).toMatchObject({
			select: {
				qbrPreparations: {
					where: { quarter: "2026-Q3" },
					orderBy: { version: "desc" },
					take: 1,
				},
			},
		});
		expect(snapshotsFindMany).toHaveBeenCalledTimes(1);
		expect(metric.question.url).toBe("https://atlas.pr.sync.so/questions/246");
		expect(metric.observations["2026-07"]?.source.url).toBe(
			metric.question.url,
		);
		expect(metric.observations["2026-07"]?.evidenceSource.url).toBe(
			"https://platform.example/review",
		);
		expect(metric.observations["2026-07"]).toMatchObject({
			reportedBy: "Platform owner",
			sourceType: "reported",
			status: "reported",
			dataThrough: null,
		});
		expect(metric.observations["2026-08"]).toMatchObject({
			sourceType: "automated_query",
			status: "provisional",
			dataThrough: null,
		});
	});
});
