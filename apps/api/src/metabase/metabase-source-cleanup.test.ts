import { expect, mock, test } from "bun:test";
import { DataSourceKind } from "@crm/db";
import { MetabaseService } from "./metabase.service";

test.each(["metabase:sync", "stripe:customer-billing-country"])(
	"starting %s cannot fail another source's running jobs",
	async (key) => {
		const updateMany = mock(async (_input: unknown) => ({ count: 0 }));
		const upsert = mock(async () => ({ id: "source" }));
		const service = Object.assign(Object.create(MetabaseService.prototype), {
			db: { syncRun: { updateMany }, dataSource: { upsert } },
		}) as {
			beginDataSource: (
				key: string,
				kind: DataSourceKind,
				label: string,
			) => Promise<unknown>;
		};
		await service.beginDataSource(key, DataSourceKind.METABASE, "Fixture");
		expect(updateMany).toHaveBeenCalledWith({
			where: {
				source: { key },
				status: "RUNNING",
				startedAt: { lt: expect.any(Date) },
			},
			data: {
				status: "FAILED",
				finishedAt: expect.any(Date),
				error: "Sync worker stopped before the batch completed.",
			},
		});
		expect(upsert).toHaveBeenCalledTimes(1);
	},
);
