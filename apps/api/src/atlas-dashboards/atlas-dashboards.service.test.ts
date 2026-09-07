import { describe, expect, mock, test } from "bun:test";
import { DataSourceKind, type Db } from "@crm/db";
import { AtlasDashboardsService } from "./atlas-dashboards.service";

describe("Atlas dashboard refresh", () => {
	test("sanitizes cached negative-feedback snapshots in protected dashboard reads", async () => {
		const capturedAt = new Date("2026-09-03T12:00:00.000Z");
		const dashboard = {
			id: "dashboard-product",
			number: 7,
			name: "Product",
			description: null,
			layoutVersion: 1,
			updatedAt: capturedAt,
			tabs: [],
			cards: [
				{
					id: "card-141",
					tabId: null,
					position: 0,
					x: 0,
					y: 0,
					width: 6,
					height: 4,
					visualization: null,
					displaySettings: null,
					question: {
						number: 141,
						publicNumber: 141,
						name: "Negative generation feedback",
						description: null,
						lastCheckedAt: capturedAt,
						connector: DataSourceKind.METABASE,
						sourceId: null,
						source: null,
						sourceExternalId: "5182",
						metricVersionId: null,
						metricVersion: null,
						canonicalCatalogEntries: [],
						versions: [],
					},
				},
			],
		};
		const db = {
			dashboard: { findUnique: mock().mockResolvedValue(dashboard) },
			$queryRaw: mock().mockResolvedValue([
				{
					id: "snapshot-141",
					questionExternalId: "5182",
					reportingPeriod: "all-time",
					capturedAt,
					columns: [
						{ name: "created_at" },
						{ name: "organization_id" },
						{ name: "model_name" },
						{ name: "text_feedback" },
						{ name: "output_media_url" },
					],
					rows: [
						[
							"2026-09-03T11:00:00.000Z",
							"org-customer",
							"sync-3",
							"bad result",
							"https://signed.example/customer.mp4",
						],
					],
					rowCount: 1,
				},
			]),
			metricSnapshot: { findMany: mock().mockResolvedValue([]) },
			dataSource: { findMany: mock().mockResolvedValue([]) },
		} as unknown as Db;
		const service = new AtlasDashboardsService(
			db,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncAtlasDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
		);

		const result = await service.byNumber(7);

		expect(result.cards[0]?.snapshot).toEqual(
			expect.objectContaining({
				columns: [
					{ name: "created_at" },
					{ name: "model_name" },
					{ name: "text_feedback" },
				],
				rows: [["2026-09-03T11:00:00.000Z", "sync-3", "bad result"]],
			}),
		);
	});

	test("continues to other sources when one Metabase batch is incomplete", async () => {
		const findUnique = mock().mockResolvedValue({
			cards: [
				{
					question: {
						id: "metabase-one",
						number: 1,
						connector: DataSourceKind.METABASE,
						sourceId: "source-one",
						source: { key: "metabase:one" },
					},
				},
				{
					question: {
						id: "metabase-two",
						number: 2,
						connector: DataSourceKind.METABASE,
						sourceId: "source-two",
						source: { key: "metabase:two" },
					},
				},
				{
					question: {
						id: "billing",
						number: 3,
						connector: DataSourceKind.ATLAS,
						sourceId: "billing-source",
						source: { key: "atlas:billing-experiment" },
					},
				},
			],
		});
		const metabaseSync = mock()
			.mockResolvedValueOnce({
				cardsProcessed: 12,
				snapshotsCreated: 12,
				completed: false,
				remainingQuestions: 5,
			})
			.mockResolvedValueOnce({
				cardsProcessed: 1,
				snapshotsCreated: 1,
				completed: true,
				remainingQuestions: 0,
			});
		const billingSync = mock().mockResolvedValue({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			errors: [],
		});
		const service = new AtlasDashboardsService(
			{ dashboard: { findUnique } } as unknown as Db,
			{ syncDashboard: billingSync } as never,
			{ syncDashboard: mock() } as never,
			{ syncAtlasDashboard: metabaseSync } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
		);

		const result = await service.refresh(1);

		expect(metabaseSync).toHaveBeenCalledTimes(2);
		expect(metabaseSync).toHaveBeenNthCalledWith(1, 1, "source-one");
		expect(metabaseSync).toHaveBeenNthCalledWith(2, 1, "source-two");
		expect(billingSync).toHaveBeenCalledWith(1);
		expect(billingSync.mock.invocationCallOrder[0]).toBeLessThan(
			metabaseSync.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
		);
		expect(result).toMatchObject({
			cardsProcessed: 14,
			snapshotsCreated: 14,
			completed: false,
			remainingQuestions: 5,
			errors: [],
		});
	});

	test("can refresh native sources without starting Metabase", async () => {
		const findUnique = mock().mockResolvedValue({
			cards: [
				{
					question: {
						id: "metabase",
						number: 1,
						connector: DataSourceKind.METABASE,
						sourceId: "metabase-source",
						source: { key: "metabase:sync" },
					},
				},
				{
					question: {
						id: "billing",
						number: 2,
						connector: DataSourceKind.ATLAS,
						sourceId: "billing-source",
						source: { key: "atlas:billing-experiment" },
					},
				},
			],
		});
		const metabaseSync = mock();
		const billingSync = mock().mockResolvedValue({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			errors: [],
		});
		const service = new AtlasDashboardsService(
			{ dashboard: { findUnique } } as unknown as Db,
			{ syncDashboard: billingSync } as never,
			{ syncDashboard: mock() } as never,
			{ syncAtlasDashboard: metabaseSync } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
		);

		const result = await service.refresh(1, "native");

		expect(billingSync).toHaveBeenCalledWith(1);
		expect(metabaseSync).not.toHaveBeenCalled();
		expect(result.completed).toBe(true);
	});

	test("routes the Lipsync dashboard through the governed marketing reader", async () => {
		const findUnique = mock().mockResolvedValue({
			cards: [
				{
					question: {
						id: "lipsync-funnel",
						number: 236,
						connector: DataSourceKind.ATLAS,
						sourceId: "lipsync-source",
						source: { key: "atlas:lipsync" },
					},
				},
			],
		});
		const marketingSync = mock().mockResolvedValue({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			errors: [],
		});
		const service = new AtlasDashboardsService(
			{ dashboard: { findUnique } } as unknown as Db,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncAtlasDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: marketingSync } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
		);

		const result = await service.refresh(14, "native");

		expect(marketingSync).toHaveBeenCalledWith(14);
		expect(result).toMatchObject({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			completed: true,
			errors: [],
		});
	});

	test("routes the Studio dashboard through the governed marketing reader", async () => {
		const findUnique = mock().mockResolvedValue({
			cards: [
				{
					question: {
						id: "studio-weekly",
						number: 234,
						connector: DataSourceKind.ATLAS,
						sourceId: "studio-source",
						source: { key: "atlas:studio-product" },
					},
				},
			],
		});
		const marketingSync = mock().mockResolvedValue({
			cardsProcessed: 2,
			snapshotsCreated: 2,
			errors: [],
		});
		const service = new AtlasDashboardsService(
			{ dashboard: { findUnique } } as unknown as Db,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncAtlasDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: marketingSync } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
		);

		const result = await service.refresh(16, "native");

		expect(marketingSync).toHaveBeenCalledWith(16);
		expect(result).toMatchObject({
			cardsProcessed: 2,
			snapshotsCreated: 2,
			completed: true,
			errors: [],
		});
	});

	test("routes customer lifecycle through the governed marketing reader", async () => {
		const findUnique = mock().mockResolvedValue({
			cards: [
				{
					question: {
						id: "exit-survey",
						number: 239,
						connector: DataSourceKind.ATLAS,
						sourceId: "customer-lifecycle-source",
						source: { key: "atlas:marketing" },
					},
				},
			],
		});
		const marketingSync = mock().mockResolvedValue({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			errors: [],
		});
		const service = new AtlasDashboardsService(
			{ dashboard: { findUnique } } as unknown as Db,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncAtlasDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: marketingSync } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
		);

		const result = await service.refresh(15, "native");

		expect(marketingSync).toHaveBeenCalledWith(15);
		expect(result).toMatchObject({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			completed: true,
			errors: [],
		});
	});

	test("routes API operations through the governed composite reader", async () => {
		const findUnique = mock().mockResolvedValue({
			cards: [
				{
					question: {
						id: "api-adoption",
						number: 240,
						connector: DataSourceKind.ATLAS,
						sourceId: "api-operations-source",
						source: { key: "atlas:api-operations" },
					},
				},
			],
		});
		const marketingSync = mock().mockResolvedValue({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			errors: [],
		});
		const service = new AtlasDashboardsService(
			{ dashboard: { findUnique } } as unknown as Db,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncAtlasDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: marketingSync } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
		);

		const result = await service.refresh(1, "native");

		expect(marketingSync).toHaveBeenCalledWith(1);
		expect(result).toMatchObject({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			completed: true,
			errors: [],
		});
	});

	test("routes model feedback through the governed composite reader", async () => {
		const findUnique = mock().mockResolvedValue({
			cards: [
				{
					question: {
						id: "model-feedback",
						number: 7014,
						connector: DataSourceKind.ATLAS,
						sourceId: "model-feedback-source",
						source: { key: "atlas:model-feedback-composite" },
					},
				},
			],
		});
		const marketingSync = mock().mockResolvedValue({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			errors: [],
		});
		const service = new AtlasDashboardsService(
			{ dashboard: { findUnique } } as unknown as Db,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncAtlasDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: marketingSync } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
		);

		const result = await service.refresh(1, "native");

		expect(marketingSync).toHaveBeenCalledWith(1);
		expect(result).toMatchObject({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			completed: true,
			errors: [],
		});
	});

	test("routes Q3 GTM evidence through the governed sales reader", async () => {
		const findUnique = mock().mockResolvedValue({
			cards: [
				{
					question: {
						id: "q3-gtm",
						number: 7011,
						connector: DataSourceKind.ATLAS,
						sourceId: "q3-gtm-source",
						source: { key: "atlas:q3-gtm-composite" },
					},
				},
			],
		});
		const salesSync = mock().mockResolvedValue({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			errors: [],
		});
		const service = new AtlasDashboardsService(
			{ dashboard: { findUnique } } as unknown as Db,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncAtlasDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: salesSync } as never,
			{ syncDashboard: mock() } as never,
		);

		const result = await service.refresh(4, "native");

		expect(salesSync).toHaveBeenCalledWith(4);
		expect(result).toMatchObject({
			cardsProcessed: 1,
			snapshotsCreated: 1,
			completed: true,
			errors: [],
		});
	});

	test("routes contract reconciliation through the native contract reader", async () => {
		const findUnique = mock().mockResolvedValue({
			cards: [
				{
					question: {
						id: "contract-summary",
						number: 7500,
						connector: DataSourceKind.ATLAS,
						sourceId: "contracts-source",
						source: { key: "atlas:contracts" },
					},
				},
			],
		});
		const contractsSync = mock().mockResolvedValue({
			cardsProcessed: 7,
			snapshotsCreated: 7,
			errors: [],
		});
		const service = new AtlasDashboardsService(
			{ dashboard: { findUnique } } as unknown as Db,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: contractsSync } as never,
			{ syncAtlasDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
			{ syncDashboard: mock() } as never,
		);

		const result = await service.refresh(13, "native");

		expect(contractsSync).toHaveBeenCalledWith(13);
		expect(result).toMatchObject({
			cardsProcessed: 7,
			snapshotsCreated: 7,
			completed: true,
			errors: [],
		});
	});
});
