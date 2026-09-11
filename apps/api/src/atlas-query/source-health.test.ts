import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@crm/db";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { AtlasQueryController } from "./atlas-query.controller";
import { AtlasQueryService } from "./atlas-query.service";
import { sourceErrorSummary } from "./source-health";

describe("Atlas source health", () => {
	test("returns every source independently of its questions and ingestion", async () => {
		const findMany = mock(async () => [
			{
				key: "modal:billing",
				label: "Modal",
				state: "HEALTHY",
				lastSyncAt: new Date("2026-09-07T00:00:00Z"),
				freshnessDeadlineAt: new Date("2026-09-08T06:00:00Z"),
				lastError: null,
				syncRuns: [],
				questions: [],
			},
			{
				key: "product",
				label: "Product",
				state: "ERROR",
				lastSyncAt: null,
				freshnessDeadlineAt: null,
				lastError: "timeout for private@example.test",
				syncRuns: [{ id: "run-1", status: "FAILED" }],
				questions: [
					{
						dashboardCards: [
							{ dashboard: { number: 4 } },
							{ dashboard: { number: 4 } },
						],
					},
				],
			},
		]);
		const service = new AtlasQueryService({
			dataSource: { findMany },
		} as unknown as Db);
		const result = await service.sources();
		expect(result.sources).toHaveLength(2);
		expect(result.sources[0]?.required).toBe(true);
		expect(result.sources[1]?.dashboards).toEqual([4]);
		expect(result.sources[1]?.latestRun?.id).toBe("run-1");
		expect(JSON.stringify(result)).not.toContain("private@example.test");
		expect(findMany.mock.calls[0]).toBeDefined();
	});

	test("does not expose vendor error bodies, SQL, credentials or customer data", () => {
		expect(
			sourceErrorSummary("3 question(s) failed in the refresh cycle."),
		).toBe(
			"3 question(s) failed; the refresh job finished but the source is not ready.",
		);
		expect(
			sourceErrorSummary(
				"3 question(s) failed in the refresh cycle. private@example.test",
			),
		).not.toContain("private@example.test");
		expect(
			sourceErrorSummary("401 Bearer secret email@example.test SELECT *"),
		).toBe("Source authentication or permission failed.");
		expect(sourceErrorSummary("Something private here")).toBe(
			"Source refresh failed. Inspect the protected source diagnostics for details.",
		);
		expect(sourceErrorSummary(null)).toBeNull();
	});

	test("draft namespaces have no ingestion deadline; missing evidence on real sources still alerts", async () => {
		const service = new AtlasQueryService({
			dataSource: {
				findMany: async () =>
					[
						"atlas:metric-catalog",
						"atlas:rudy-cron-authoring",
						"pylon:support",
						"google-drive:customer-contracts",
						"modal:billing",
					].map((key) => ({
						key,
						state: "HEALTHY",
						lastSyncAt: null,
						freshnessDeadlineAt: null,
						lastError: null,
						syncRuns: [],
						questions: [{ dashboardCards: [] }],
					})),
			},
		} as unknown as Db);
		const result = await service.sources();
		expect(result.sources.map(({ required }) => required)).toEqual([
			false,
			false,
			true,
			true,
			true,
		]);
		expect(result.sources.every(({ lastSyncAt }) => lastSyncAt === null)).toBe(
			true,
		);
	});

	test("requires the read-only credential before reading source health", () => {
		const sources = mock(async () => ({}));
		const controller = new AtlasQueryController(
			{ sources } as unknown as AtlasQueryService,
			new ConfigService({ ATLAS_QUERY_SECRET: "read-secret" }) as ConfigService<
				EnvironmentVariables,
				true
			>,
		);
		expect(() => controller.sources()).toThrow("Forbidden");
		expect(() => controller.sources("Bearer wrong")).toThrow("Forbidden");
		expect(sources).not.toHaveBeenCalled();
		controller.sources("Bearer read-secret");
		expect(sources).toHaveBeenCalledTimes(1);
	});
});
