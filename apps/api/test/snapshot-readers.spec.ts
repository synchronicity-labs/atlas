import { describe, expect, mock, test } from "bun:test";
import { type Db, type Prisma } from "@crm/db";
import { AtlasQueryService } from "../src/atlas-query/atlas-query.service";
import { MetricCatalogService } from "../src/metric-catalog/metric-catalog.service";
import { RudyService } from "../src/rudy/rudy.service";

const capturedAt = new Date("2026-09-14T12:00:00Z");
const question = {
	id: "question-1",
	publicNumber: 1,
	name: "Test metric",
	updatedAt: capturedAt,
	sourceExternalId: "external-1",
	metricVersionId: "version-1",
	versions: [],
};
const result = {
	id: "result-latest",
	questionExternalId: "external-1",
	reportingPeriod: "2026-09",
	capturedAt,
	columns: [{ name: "value" }],
	rows: [[42]],
	rowCount: 1,
};

describe("bounded snapshot readers", () => {
	test("Rudy accepts a dashboard with no cards without a raw lookup", async () => {
		const queryRaw = mock();
		const emptyRead = async (input: { where: unknown }) => {
			expect(input.where).toEqual({ id: { in: [] } });
			return [];
		};
		const service = new RudyService(
			{
				dashboard: { findUnique: async () => ({ cards: [] }) },
				$queryRaw: queryRaw,
				questionVersion: { findMany: emptyRead },
				resultSnapshot: { findMany: emptyRead },
			} as unknown as Db,
			{} as never,
		);
		expect(
			await Reflect.get(service, "readContext").call(service, {
				kind: "dashboard",
				id: "1",
			}),
		).toMatchObject({ dashboard: { cards: [] } });
		expect(queryRaw).not.toHaveBeenCalled();
	});

	test("Rudy fetches only latest dashboard results and keeps missing results empty", async () => {
		const findMany = mock(async (input: Prisma.ResultSnapshotFindManyArgs) => {
			expect(input.where).toEqual({ id: { in: [result.id] } });
			return [result];
		});
		const latestDefinition = {
			version: 12,
			queryLanguage: "SQL",
			queryText: "select 42",
			display: "scalar",
			visualization: {},
		};
		const versionRead = mock(
			async (input: Prisma.QuestionVersionFindManyArgs) => {
				expect(input.where).toEqual({ id: { in: ["definition-latest"] } });
				return [{ questionId: question.id, ...latestDefinition }];
			},
		);
		const service = new RudyService(
			{
				dashboard: {
					findUnique: async (input: Prisma.DashboardFindUniqueArgs) => {
						expect(JSON.stringify(input.select)).not.toContain('"versions"');
						return {
							cards: [
								{ question },
								{
									question: {
										...question,
										id: "missing-question",
										sourceExternalId: "missing",
									},
								},
							],
						};
					},
				},
				$queryRaw: async (sql: Prisma.Sql) => {
					if (!sql.text.includes('"questionVersion"'))
						return [{ id: result.id }];
					expect(sql.values).toEqual([question.id, "missing-question"]);
					expect(sql.text).toContain('ORDER BY "version" DESC');
					return [{ id: "definition-latest" }];
				},
				questionVersion: { findMany: versionRead },
				resultSnapshot: { findMany },
			} as unknown as Db,
			{} as never,
		);
		const context = await Reflect.get(service, "readContext").call(service, {
			kind: "dashboard",
			id: "1",
		});
		expect(findMany).toHaveBeenCalledTimes(1);
		expect(versionRead).toHaveBeenCalledTimes(1);
		expect(context).toMatchObject({
			dashboard: {
				cards: [
					{
						question: { versions: [latestDefinition] },
						latestResult: { rows: [[42]], rowCount: 1, truncated: false },
					},
					{ question: { versions: [] }, latestResult: null },
				],
			},
		});
	});

	test("agent catalog bounds both snapshot types without upgrading trust", async () => {
		const resultRead = mock(
			async (input: Prisma.ResultSnapshotFindManyArgs) => {
				expect(input.where).toEqual({ id: { in: [result.id] } });
				return [result];
			},
		);
		const metricRead = mock(
			async (input: Prisma.MetricSnapshotFindManyArgs) => {
				expect(input.where).toEqual({ id: { in: ["metric-latest"] } });
				return [
					{
						metricVersionId: "version-1",
						reportingPeriod: "2026-09",
						computedAt: capturedAt,
						dataThrough: capturedAt,
						trustStatus: "PENDING",
						rowCount: 1,
					},
				];
			},
		);
		const service = new AtlasQueryService({
			dashboard: { findMany: async () => [] },
			question: {
				findMany: async () => [
					question,
					{ ...question, publicNumber: 2, metricVersionId: null },
				],
			},
			metricDefinition: { findMany: async () => [] },
			$queryRaw: async (sql: Prisma.Sql) => [
				{ id: sql.text.includes('"metrics"') ? "metric-latest" : result.id },
			],
			resultSnapshot: { findMany: resultRead },
			metricSnapshot: { findMany: metricRead },
		} as unknown as Db);
		const catalog = await service.catalog();
		expect(resultRead).toHaveBeenCalledTimes(1);
		expect(metricRead).toHaveBeenCalledTimes(1);
		expect(catalog.questions[0]?.latestResult).toMatchObject({
			trustStatus: "PENDING",
			rowCount: 1,
		});
		expect(catalog.questions[1]?.latestResult).toMatchObject({
			trustStatus: null,
			capturedAt: capturedAt.toISOString(),
		});
	});

	test("metric catalog bounds evidence reads and preserves their timestamps", async () => {
		const findMany = mock(async (input: Prisma.ResultSnapshotFindManyArgs) => {
			expect(input.where).toEqual({ id: { in: [result.id] } });
			return [result];
		});
		const service = new MetricCatalogService(
			{
				metricCatalogEntry: {
					findMany: async () => [
						{
							title: "Test metric",
							sourceTabName: "Product",
							readiness: "BLOCKED",
							attempts: [],
							evidence: [{ question }],
							lastSeenAt: capturedAt,
						},
					],
				},
				dataSource: { findMany: async () => [] },
				$queryRaw: async () => [{ id: result.id }],
				resultSnapshot: { findMany },
			} as unknown as Db,
			{} as never,
		);
		const catalog = await service.list();
		expect(findMany).toHaveBeenCalledTimes(1);
		expect(catalog[0]?.evidence[0]).toMatchObject({
			rowCount: 1,
			computedAt: capturedAt.toISOString(),
		});
	});
});
