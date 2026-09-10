import { describe, expect, mock, spyOn, test } from "bun:test";
import { DataSourceKind } from "@crm/db";
import { AtlasDashboardSyncController } from "../atlas-dashboards/atlas-dashboard-sync.controller";
import {
	ownsScheduledSource,
	scheduledMetabaseDashboards,
} from "./dashboard-refresh-ownership";
import schedules from "./dashboard-schedules.json";
import { MetabaseClient } from "./metabase.client";
import { MetabaseService } from "./metabase.service";

describe("scheduled shared-source ownership", () => {
	test.each(
		[[2, 7, 18], [1, 18], [4, 7], [4, 18], [18], [7, 7, 18]].map(
			(placements) => ({ placements }),
		),
	)("exactly one scheduled owner for %j", ({ placements }) => {
		const owners = [...new Set(placements)].filter((dashboard) =>
			ownsScheduledSource(dashboard, placements),
		);
		expect(owners).toHaveLength(1);
		expect(owners[0]).toBe(
			scheduledMetabaseDashboards.find((number) => placements.includes(number)),
		);
	});

	test("manual-only dashboards do not suppress a scheduled owner", () => {
		expect(ownsScheduledSource(18, [3, 8, 18])).toBe(true);
		expect(ownsScheduledSource(8, [2, 8])).toBe(true);
		expect(ownsScheduledSource(18, [])).toBe(true);
		expect(schedules).toEqual([
			{ number: 1, schedule: "2-59/5 * * * *" },
			{ number: 2, schedule: "4-59/5 * * * *" },
			{ number: 7, schedule: "1-59/5 * * * *" },
			{ number: 18, schedule: "11-59/15 * * * *" },
			{ number: 4, schedule: "31 */6 * * *" },
		]);
	});

	test("only authenticated GET refreshes use scheduled ownership; POST stays manual", async () => {
		const refresh = mock(async () => ({}));
		const controller = new AtlasDashboardSyncController(
			{ refresh } as never,
			{ get: () => "test-secret" } as never,
		);
		await controller.viaModeGet(18, "metabase", "Bearer test-secret");
		expect(refresh).toHaveBeenLastCalledWith(18, "metabase", true);
		await controller.viaModePost(18, "metabase", "Bearer test-secret");
		expect(refresh).toHaveBeenLastCalledWith(18, "metabase", false);
		await controller.viaGet(18, "Bearer test-secret");
		expect(refresh).toHaveBeenLastCalledWith(18, "all", true);
		await controller.viaPost(18, "Bearer test-secret");
		expect(refresh).toHaveBeenLastCalledWith(18, "all", false);
		expect(() => controller.viaGet(18, "bad")).toThrow();
		expect(refresh).toHaveBeenCalledTimes(4);
	});

	test("a non-owning scheduled dashboard does not query, publish or mark sources fresh", async () => {
		const placements = mock(async () => [
			{
				question: { versions: [{ queryText: "select 1" }] },
				dashboard: { number: 2 },
			},
			{
				question: { versions: [{ queryText: "select 1" }] },
				dashboard: { number: 18 },
			},
		]);
		const cursor = mock(async () => {
			throw new Error("stop before execution");
		});
		const publish = mock();
		const update = mock();
		const service = Object.assign(Object.create(MetabaseService.prototype), {
			requireConfig: async () => ({}),
			db: {
				dashboard: {
					findUnique: async () => ({
						cards: [
							{
								question: {
									id: "q",
									number: 1102,
									connector: DataSourceKind.METABASE,
									sourceId: "source",
									versions: [{ queryText: "select 1" }],
								},
							},
						],
					}),
				},
				dashboardCard: { findMany: placements },
				syncCursor: { upsert: cursor },
				dataSource: { update },
			},
			productMetrics: { publish },
		}) as MetabaseService;
		expect(await service.syncAtlasDashboard(18, "source", true)).toMatchObject({
			cardsProcessed: 0,
			completed: true,
			errors: [],
		});
		expect(cursor).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		await expect(service.syncAtlasDashboard(18, "source")).rejects.toThrow(
			"stop before execution",
		);
		expect(placements).toHaveBeenCalledTimes(1);
	});

	test("one owner covers the whole source, resets changed batches and preserves cycle failures", async () => {
		const questions = [1, 2, 3].map((index) => ({
			id: `q${index}`,
			number: 9000 + index,
			name: "Fixture",
			connector: DataSourceKind.METABASE,
			sourceId: "source",
			databaseExternalId: null,
			versions: [
				{
					id: `v${index}`,
					version: 1,
					queryLanguage: "SQL",
					queryText: `select ${index}`,
				},
			],
		}));
		let placements = questions.map((question, index) => ({
			question,
			dashboard: { number: index === 0 ? 1 : 18 },
		}));
		let cursor = {
			id: "cursor",
			period: "",
			offset: 0,
			completedPeriods: 0,
			checkpoint: {},
		};
		const updateSource = mock(async (_input: unknown) => ({}));
		const publish = mock(async (_input: unknown) => ({}));
		const service = Object.assign(Object.create(MetabaseService.prototype), {
			requireConfig: async () => ({}),
			db: {
				dashboard: {
					findUnique: async () => ({ cards: [{ question: questions[0] }] }),
				},
				dashboardCard: { findMany: async () => placements },
				syncCursor: {
					upsert: async () => cursor,
					update: async ({ data }: { data: typeof cursor }) => {
						cursor = { ...cursor, ...data };
					},
				},
				syncRun: {
					updateMany: async () => ({}),
					create: async () => ({ id: "run" }),
					update: async () => ({}),
				},
				dataSource: { update: updateSource },
				resultSnapshot: { createMany: async () => ({ count: 1 }) },
				$transaction: async (operations: Promise<unknown>[]) =>
					Promise.all(operations),
			},
			productMetrics: { publish },
		}) as MetabaseService;
		const preview = spyOn(
			MetabaseClient.prototype,
			"preview",
		).mockResolvedValue({ columns: [], rows: [[1]] });
		try {
			expect(await service.syncAtlasDashboard(1, "source", true)).toMatchObject(
				{ cardsProcessed: 2, completed: false },
			);
			expect(publish).toHaveBeenCalledTimes(2);
			expect(updateSource).toHaveBeenLastCalledWith({
				where: { id: "source" },
				data: {
					state: "SYNCING",
					lastSyncAt: undefined,
					lastError: null,
					freshnessDeadlineAt: undefined,
				},
			});
			placements = questions
				.slice(2)
				.map((question) => ({ question, dashboard: { number: 1 } }));
			expect(await service.syncAtlasDashboard(1, "source", true)).toMatchObject(
				{ cardsProcessed: 1, completed: true },
			);
			expect(preview).toHaveBeenLastCalledWith(
				expect.objectContaining({ queryText: "select 3" }),
			);
			expect(updateSource).toHaveBeenLastCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						state: "HEALTHY",
						lastSyncAt: expect.any(Date),
					}),
				}),
			);
			placements = questions.map((question) => ({
				question,
				dashboard: { number: 1 },
			}));
			preview.mockRejectedValueOnce(new Error("fixture query failure"));
			await service.syncAtlasDashboard(1, "source", true);
			expect(await service.syncAtlasDashboard(1, "source", true)).toMatchObject(
				{ cardsProcessed: 1, completed: true, errors: [] },
			);
			expect(updateSource).toHaveBeenLastCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						state: "ERROR",
						lastSyncAt: undefined,
						freshnessDeadlineAt: undefined,
					}),
				}),
			);
			await service.syncAtlasDashboard(1, "source", true);
			await service.syncAtlasDashboard(1, "source", true);
			expect(updateSource).toHaveBeenLastCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						state: "HEALTHY",
						lastSyncAt: expect.any(Date),
					}),
				}),
			);
		} finally {
			preview.mockRestore();
		}
	});
});
