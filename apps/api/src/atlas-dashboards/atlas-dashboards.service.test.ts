import { describe, expect, mock, test } from "bun:test";
import { DataSourceKind, type Db } from "@crm/db";
import { AtlasDashboardsService } from "./atlas-dashboards.service";

describe("Atlas dashboard refresh", () => {
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
		expect(result).toMatchObject({
			cardsProcessed: 14,
			snapshotsCreated: 14,
			completed: false,
			remainingQuestions: 5,
			errors: [],
		});
	});
});
