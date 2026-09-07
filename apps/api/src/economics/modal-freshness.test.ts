import { expect, mock, test } from "bun:test";
import type { Db } from "@crm/db";
import type { ProductMetricPublisher } from "../metabase/product-metric.publisher";
import type { TinybirdEligibilityService } from "../metabase/tinybird-eligibility.service";
import { EconomicsService, modalImportIsFresh } from "./economics.service";

test("an unchanged successful Modal import refreshes the check without rewriting its immutable result", () => {
	const now = new Date("2026-09-07T12:00:00Z");
	const old = new Date("2026-09-02T00:00:00Z");
	expect(modalImportIsFresh(old, now, now)).toBe(true);
	expect(modalImportIsFresh(old, old, now)).toBe(false);
	expect(modalImportIsFresh(old, null, now)).toBe(false);
	expect(modalImportIsFresh(now, null, now)).toBe(true);
	expect(modalImportIsFresh(old, new Date("2027-01-01T00:00:00Z"), now)).toBe(
		false,
	);
});

test("repeated and reverted imports retain immutable snapshots and point to the last checked content", async () => {
	const hashes = new Set<string>();
	const createMany = mock(async (args: { data: { contentHash: string }[] }) => {
		const value = args.data[0]?.contentHash;
		if (!value) throw new Error("Expected one snapshot");
		const count = hashes.has(value) ? 0 : 1;
		hashes.add(value);
		return { count };
	});
	const upsert = mock(async () => ({}));
	const tx = {
		resultSnapshot: { createMany },
		question: { updateMany: mock(async () => ({})) },
		dataSource: { update: mock(async () => ({})) },
		syncCursor: { upsert },
	};
	const db = {
		dataSource: { findUnique: mock(async () => ({ id: "modal-source" })) },
		$transaction: mock(async (action: (client: typeof tx) => unknown) =>
			action(tx),
		),
	};
	const service = new EconomicsService(
		db as unknown as Db,
		{} as TinybirdEligibilityService,
		{} as ProductMetricPublisher,
	);
	const input = (costUsd: number, capturedAt: string) => ({
		collector: "rudy-modal-billing-v1" as const,
		capturedAt,
		rows: [{ month: "2026-09", model: "sync-3", costUsd }],
	});
	expect(
		(await service.importModal(input(10, "2026-09-01T00:00:00Z")))
			.snapshotCreated,
	).toBe(true);
	expect(
		(await service.importModal(input(20, "2026-09-02T00:00:00Z")))
			.snapshotCreated,
	).toBe(true);
	expect(
		(await service.importModal(input(10, "2026-09-07T00:00:00Z")))
			.snapshotCreated,
	).toBe(false);
	expect(hashes.size).toBe(2);
	expect(upsert).toHaveBeenLastCalledWith(
		expect.objectContaining({
			update: expect.objectContaining({
				cursor: createMany.mock.calls[0]?.[0].data[0]?.contentHash,
				lastSuccessAt: new Date("2026-09-07T00:00:00Z"),
			}),
		}),
	);
	expect(db.$transaction).toHaveBeenCalledTimes(3);
});

test("economics selects the last checked content even when it is not the newest snapshot", async () => {
	const findFirst = mock(async () => null);
	const service = new EconomicsService(
		{
			syncCursor: {
				findFirst: mock(async () => ({
					cursor: "checked-hash",
					lastSuccessAt: new Date(),
				})),
			},
			resultSnapshot: { findFirst },
		} as unknown as Db,
		{} as TinybirdEligibilityService,
		{} as ProductMetricPublisher,
	);
	await expect(
		service.preview(
			JSON.stringify({
				source: "atlas_economics",
				report: "modal-spend",
				definitionVersion: "inference-economics-v1",
			}),
		),
	).rejects.toThrow("no imported aggregate snapshot");
	expect(findFirst).toHaveBeenCalledWith(
		expect.objectContaining({
			where: expect.objectContaining({
				contentHash: "checked-hash",
				source: { key: "modal:billing" },
			}),
		}),
	);
});
