import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Db, db, type Prisma } from "@crm/db";
import { EconomicsService } from "../src/economics/economics.service";
import type { ProductMetricPublisher } from "../src/metabase/product-metric.publisher";
import type { TinybirdEligibilityService } from "../src/metabase/tinybird-eligibility.service";

const databaseUrl = process.env.DATABASE_URL;
const localDatabase =
	databaseUrl &&
	["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname);

describe.skipIf(!localDatabase)("Modal import ordering in PostgreSQL", () => {
	it("a delayed overlapping import cannot replace a newer committed cursor", async () => {
		const suffix = randomUUID();
		const source = await db.dataSource.create({
			data: {
				key: `test:modal-order:${suffix}`,
				kind: "METABASE",
				label: "Modal ordering regression",
			},
		});
		const newerAt = new Date(Date.now() - 60_000);
		const olderAt = new Date(newerAt.getTime() - 60_000);
		const locked = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const olderStarted = Promise.withResolvers<void>();
		const imports: Promise<unknown>[] = [];
		const service = (hold: boolean) =>
			new EconomicsService(
				{
					dataSource: {
						findUnique: async () =>
							db.dataSource.findUnique({ where: { id: source.id } }),
					},
					$transaction: async (
						action: (tx: Prisma.TransactionClient) => Promise<unknown>,
					) =>
						db.$transaction(async (tx) => {
							if (!hold) olderStarted.resolve();
							const result = await action(tx);
							if (hold) {
								locked.resolve();
								await release.promise;
							}
							return result;
						}),
				} as unknown as Db,
				{} as TinybirdEligibilityService,
				{} as ProductMetricPublisher,
			);
		const input = (capturedAt: Date, costUsd: number) => ({
			collector: "rudy-modal-billing-v1" as const,
			capturedAt: capturedAt.toISOString(),
			rows: [
				{
					month: capturedAt.toISOString().slice(0, 7),
					model: `test-${suffix}`,
					costUsd,
				},
			],
		});
		try {
			const newer = service(true).importModal(input(newerAt, 20));
			imports.push(newer);
			await Promise.race([
				locked.promise,
				newer.then(() => {
					throw new Error("Newer import did not hold its transaction");
				}),
			]);
			const older = service(false).importModal(input(olderAt, 10));
			imports.push(older);
			await Promise.race([
				olderStarted.promise,
				older.then(() => {
					throw new Error("Older import did not enter its transaction");
				}),
			]);
			release.resolve();
			const [newerResult, olderResult] = await Promise.all([newer, older]);
			expect(newerResult).toMatchObject({
				snapshotCreated: true,
				ignored: false,
			});
			expect(olderResult).toMatchObject({
				snapshotCreated: false,
				ignored: true,
			});
			expect(
				await service(false).importModal(input(newerAt, 99)),
			).toMatchObject({ snapshotCreated: false, ignored: true });
			const [current, cursor, snapshots] = await Promise.all([
				db.dataSource.findUniqueOrThrow({ where: { id: source.id } }),
				db.syncCursor.findFirstOrThrow({ where: { sourceId: source.id } }),
				db.resultSnapshot.findMany({ where: { sourceId: source.id } }),
			]);
			expect(current.lastSyncAt).toEqual(newerAt);
			expect(current.freshnessDeadlineAt).toEqual(
				new Date(newerAt.getTime() + 30 * 60 * 60_000),
			);
			expect(cursor.lastSuccessAt).toEqual(newerAt);
			expect(snapshots).toHaveLength(1);
			const snapshot = snapshots[0];
			if (!snapshot) throw new Error("Expected the accepted Modal snapshot");
			expect(cursor.cursor).toBe(snapshot.contentHash);
		} finally {
			release.resolve();
			await Promise.allSettled(imports);
			await db.dataSource.delete({ where: { id: source.id } });
		}
	}, 15_000);
});
