import "reflect-metadata";
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { DataSourceKind, db } from "@crm/db";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AtlasQueryController } from "../src/atlas-query/atlas-query.controller";
import { AtlasQueryService } from "../src/atlas-query/atlas-query.service";
import { AtlasQbrService } from "../src/atlas-query/qbr/qbr.service";

const databaseUrl = process.env.DATABASE_URL
	? new URL(process.env.DATABASE_URL)
	: null;
const databaseName = databaseUrl?.pathname.slice(1);
const isLoopbackDatabase = Boolean(
	databaseUrl &&
		["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname),
);
const isolatedDatabase = Boolean(
	isLoopbackDatabase &&
		(process.env.CI === "true"
			? databaseName === "crm"
			: databaseName === "atlas_test"),
);

if (process.env.CI === "true" && !isolatedDatabase) {
	throw new Error(
		"Atlas question integration test requires its local CI database.",
	);
}

test.skipIf(!isolatedDatabase)(
	"Atlas question HTTP reads select immutable snapshots by exact period and asOf",
	async () => {
		const prefix = randomUUID();
		let sourceId: string | undefined;
		let questionId: string | undefined;
		const module = await Test.createTestingModule({
			controllers: [AtlasQueryController],
			providers: [
				{
					provide: ConfigService,
					useValue: new ConfigService({
						ATLAS_QUERY_SECRET: "test-read-secret",
					}),
				},
				{ provide: AtlasQueryService, useValue: new AtlasQueryService(db) },
				{ provide: AtlasQbrService, useValue: {} },
			],
		}).compile();
		const app = module.createNestApplication({ logger: false });
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				forbidNonWhitelisted: true,
				transform: true,
				transformOptions: { enableImplicitConversion: true },
			}),
		);
		await app.init();
		try {
			const source = await db.dataSource.create({
				data: {
					key: prefix,
					kind: DataSourceKind.POSTGRES,
					label: "Atlas question integration fixture",
				},
			});
			sourceId = source.id;
			const snapshotSourceId = source.id;
			const question = await db.question.create({
				data: {
					number: Math.floor(Math.random() * 2_000_000_000) + 1,
					name: "Historical snapshot selection fixture",
					connector: DataSourceKind.POSTGRES,
					sourceId,
					sourceExternalId: `${prefix}-question`,
				},
			});
			questionId = question.id;
			const snapshots = [
				{
					reportingPeriod: "2026-Q3",
					capturedAt: new Date("2026-10-02T00:00:00.000Z"),
					contentHash: `${prefix}-q3-before`,
					idempotencyKey: `${prefix}-q3-before`,
					rows: [
						["2026-07", 7],
						["2026-08", 8],
						["2026-09", 9],
					],
				},
				{
					reportingPeriod: "2026-Q3",
					capturedAt: new Date("2026-10-04T00:00:00.000Z"),
					contentHash: `${prefix}-q3-after`,
					idempotencyKey: `${prefix}-q3-after`,
					rows: [["future quarter snapshot", 40]],
				},
				{
					reportingPeriod: "2026-09",
					capturedAt: new Date("2026-10-02T12:00:00.000Z"),
					contentHash: `${prefix}-month`,
					idempotencyKey: `${prefix}-month`,
					rows: [["month snapshot", 90]],
				},
				{
					reportingPeriod: "2026-10",
					capturedAt: new Date("2026-10-05T00:00:00.000Z"),
					contentHash: `${prefix}-latest`,
					idempotencyKey: `${prefix}-latest`,
					rows: [["latest snapshot", 100]],
				},
			].map((snapshot) => ({
				...snapshot,
				sourceId: snapshotSourceId,
				questionExternalId: question.sourceExternalId ?? "",
				columns: [{ name: "period" }, { name: "value" }],
				rowCount: snapshot.rows.length,
			}));
			await db.resultSnapshot.createMany({ data: snapshots });
			const baseUrl = `/internal/atlas/questions/${question.publicNumber}`;
			const agentRead = (path: string) =>
				request(app.getHttpServer())
					.get(path)
					.set("Authorization", "Bearer test-read-secret");

			const quarter = await agentRead(
				`${baseUrl}?reportingPeriod=2026-Q3`,
			).expect(200);
			expect(quarter.body.result).toMatchObject({
				reportingPeriod: "2026-Q3",
				capturedAt: "2026-10-04T00:00:00.000Z",
				rows: [["future quarter snapshot", 40]],
				rowCount: 1,
				immutable: true,
			});
			expect(quarter.body.provenance).toMatchObject({
				resultContentHash: `${prefix}-q3-after`,
				resultIdempotencyKey: `${prefix}-q3-after`,
			});

			const quarterAsOf = await agentRead(
				`${baseUrl}?reportingPeriod=2026-Q3&asOf=2026-10-03T00%3A00%3A00.000Z`,
			).expect(200);
			expect(quarterAsOf.body.result).toMatchObject({
				reportingPeriod: "2026-Q3",
				capturedAt: "2026-10-02T00:00:00.000Z",
				columns: [{ name: "period" }, { name: "value" }],
				rows: [
					["2026-07", 7],
					["2026-08", 8],
					["2026-09", 9],
				],
				rowCount: 3,
				immutable: true,
			});
			expect(quarterAsOf.body.provenance).toMatchObject({
				resultContentHash: `${prefix}-q3-before`,
				resultIdempotencyKey: `${prefix}-q3-before`,
			});

			const month = await agentRead(
				`${baseUrl}?reportingPeriod=2026-09`,
			).expect(200);
			expect(month.body.result).toMatchObject({
				reportingPeriod: "2026-09",
				rows: [["month snapshot", 90]],
			});

			const latest = await agentRead(baseUrl).expect(200);
			expect(latest.body.result).toMatchObject({
				reportingPeriod: "2026-10",
				rows: [["latest snapshot", 100]],
			});
		} finally {
			await app.close();
			if (sourceId) {
				await db.resultSnapshot.deleteMany({ where: { sourceId } });
			}
			if (questionId) {
				await db.question.delete({ where: { id: questionId } });
			}
			if (sourceId) {
				await db.dataSource.delete({ where: { id: sourceId } });
			}
		}
	},
	15_000,
);
