import { describe, expect, mock, test } from "bun:test";
import { DataSourceKind } from "@crm/db";
import { AtlasDashboardSyncController } from "../atlas-dashboards/atlas-dashboard-sync.controller";
import {
	ownsScheduledQuestion,
	scheduledMetabaseDashboards,
} from "./dashboard-refresh-ownership";
import schedules from "./dashboard-schedules.json";
import { MetabaseService } from "./metabase.service";

describe("scheduled shared-question ownership", () => {
	test.each([[2, 7, 18], [1, 18], [4, 7], [4, 18], [18], [7, 7, 18]])(
		"exactly one scheduled owner for %j",
		(...placements: number[]) => {
			const owners = [...new Set(placements)].filter((dashboard) =>
				ownsScheduledQuestion(dashboard, placements),
			);
			expect(owners).toHaveLength(1);
			expect(owners[0]).toBe(
				scheduledMetabaseDashboards.find((number) =>
					placements.includes(number),
				),
			);
		},
	);

	test("manual-only dashboards do not suppress a scheduled owner", () => {
		expect(ownsScheduledQuestion(18, [3, 8, 18])).toBe(true);
		expect(ownsScheduledQuestion(8, [2, 8])).toBe(true);
		expect(ownsScheduledQuestion(18, [])).toBe(true);
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
			{ questionId: "q", dashboard: { number: 2 } },
			{ questionId: "q", dashboard: { number: 18 } },
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
});
