import { describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Db, db, type Prisma } from "@crm/db";
import {
	latestMetricSnapshotIds,
	latestResultSnapshotIds,
} from "../src/latest-snapshots";

describe("latest snapshot lookups", () => {
	for (const lookup of [latestMetricSnapshotIds, latestResultSnapshotIds]) {
		test(`${lookup.name} skips empty keys and parameterizes unique keys`, async () => {
			const query = mock(async (sql: Prisma.Sql) => {
				expect(sql.values).toEqual(["one'", "two"]);
				expect(sql.text).not.toContain("one'");
				return [{ id: "latest" }];
			});
			const database = { $queryRaw: query } as unknown as Db;
			expect(await lookup(database, [])).toEqual([]);
			expect(query).not.toHaveBeenCalled();
			expect(await lookup(database, ["one'", "two", "one'"])).toEqual([
				"latest",
			]);
			expect(query).toHaveBeenCalledTimes(1);
		});
	}
});

const databaseUrl = process.env.DATABASE_URL;
const localDatabase =
	databaseUrl &&
	["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname);

describe.skipIf(!localDatabase)("latest snapshots in PostgreSQL", () => {
	test("returns one newest snapshot per key, breaks ties, and preserves history", async () => {
		const prefix = randomUUID();
		const periodStart = new Date("2026-07-01T00:00:00Z");
		const periodEnd = new Date("2026-08-01T00:00:00Z");
		const source = await db.dataSource.create({
			data: { key: prefix, kind: "METABASE", label: "Snapshot lookup fixture" },
		});
		const metric = await db.metricDefinition.create({
			data: {
				key: prefix,
				name: "Snapshot fixture",
				description: "Local test",
				ownerTeam: "test",
			},
		});
		try {
			const versions = await Promise.all(
				[1, 2].map((version) =>
					db.metricVersion.create({
						data: {
							metricId: metric.id,
							version,
							businessDefinition: {},
							normalizationPolicy: {},
							computation: {},
							verificationPolicy: {},
							cadence: {},
							contentHash: prefix,
							createdBy: "test",
						},
					}),
				),
			);
			for (const [index, version] of versions.entries()) {
				for (const suffix of ["old", "new-a", "new-z"]) {
					const id = `${prefix}-${index}-${suffix}`;
					const capturedAt = new Date(
						suffix === "old" ? "2026-08-01T00:00:00Z" : "2026-09-01T00:00:00Z",
					);
					const reportingPeriod = suffix === "old" ? "2026-07" : "2026-08";
					await db.resultSnapshot.create({
						data: {
							id,
							idempotencyKey: id,
							sourceId: source.id,
							questionExternalId: version.id,
							reportingPeriod,
							capturedAt,
							contentHash: id,
							columns: [],
							rows: [[suffix]],
							rowCount: 1,
						},
					});
					const run = await db.metricRun.create({
						data: {
							runKey: id,
							metricVersionId: version.id,
							periodStart,
							periodEnd,
							sourceWatermarks: {},
						},
					});
					await db.metricSnapshot.create({
						data: {
							id,
							idempotencyKey: id,
							metricVersionId: version.id,
							metricRunId: run.id,
							reportingPeriod,
							periodStart,
							periodEnd,
							dataThrough: periodEnd,
							computedAt: capturedAt,
							contentHash: id,
							columns: [],
							rows: [[suffix]],
							rowCount: 1,
							trustStatus: suffix === "old" ? "VERIFIED" : "PENDING",
						},
					});
				}
			}
			const firstVersion = versions[0];
			if (!firstVersion) throw new Error("Expected a metric version fixture");
			const keys = [
				...versions.map((version) => version.id),
				firstVersion.id,
				`${prefix}-missing`,
			];
			const expected = [0, 1].map((index) => `${prefix}-${index}-new-z`);
			expect((await latestMetricSnapshotIds(db, keys)).sort()).toEqual(
				expected,
			);
			expect((await latestResultSnapshotIds(db, keys)).sort()).toEqual(
				expected,
			);
			const historicalMetric = await db.metricSnapshot.findFirstOrThrow({
				where: {
					metricVersionId: firstVersion.id,
					reportingPeriod: "2026-07",
					trustStatus: "VERIFIED",
				},
			});
			const historicalResult = await db.resultSnapshot.findFirstOrThrow({
				where: {
					questionExternalId: firstVersion.id,
					reportingPeriod: "2026-07",
				},
			});
			expect(historicalMetric.rows).toEqual([["old"]]);
			expect(historicalResult.rows).toEqual([["old"]]);
		} finally {
			await db.metricDefinition.delete({ where: { id: metric.id } });
			await db.dataSource.delete({ where: { id: source.id } });
		}
	}, 15_000);
});
