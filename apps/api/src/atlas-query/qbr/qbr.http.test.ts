import "reflect-metadata";
import { expect, test } from "bun:test";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AtlasQueryController } from "../atlas-query.controller";
import { AtlasQueryService } from "../atlas-query.service";
import { AtlasQbrService } from "./qbr.service";

test("QBR HTTP export is protected by the Atlas read credential", async () => {
	let reads = 0;
	const module = await Test.createTestingModule({
		controllers: [AtlasQueryController],
		providers: [
			{
				provide: ConfigService,
				useValue: new ConfigService({ ATLAS_QUERY_SECRET: "test-read-secret" }),
			},
			{ provide: AtlasQueryService, useValue: {} },
			{
				provide: AtlasQbrService,
				useValue: {
					exportReport: async (quarter: string) => {
						reads++;
						return { schemaVersion: "atlas.qbr.v1", quarter, metrics: {} };
					},
				},
			},
		],
	}).compile();
	const app = module.createNestApplication({ logger: false });
	await app.init();
	try {
		await request(app.getHttpServer())
			.get("/internal/atlas/reports/qbr/2026-Q3")
			.expect(403);
		await request(app.getHttpServer())
			.get("/internal/atlas/reports/qbr/2026-Q3")
			.set("Authorization", "Bearer wrong")
			.expect(403);
		expect(reads).toBe(0);
		const result = await request(app.getHttpServer())
			.get("/internal/atlas/reports/qbr/2026-Q3")
			.set("Authorization", "Bearer test-read-secret")
			.expect(200);
		expect(result.body.schemaVersion).toBe("atlas.qbr.v1");
		expect(result.body.quarter).toBe("2026-Q3");
		expect(reads).toBe(1);
	} finally {
		await app.close();
	}
});

test("QBR HTTP export supports summary and selected metric projections", async () => {
	const preparation = {
		owner: "Team",
		supportingResults: [
			{ label: "source", queryText: "large supporting table" },
		],
	};
	const metrics = {
		retention: {
			label: "Retention",
			unit: "%",
			definition: "Exact definition",
			question: { number: 81, url: "https://atlas.example/questions/81" },
			notApplicable: false,
			automated: false,
			preparation,
			observations: { "2026-Q3": { status: "reported", value: 0 } },
		},
		adoption: {
			label: "Adoption",
			unit: "users",
			definition: "Definition",
			question: null,
			notApplicable: true,
			automated: true,
			preparation: { owner: "Team", supportingResults: [] },
			observations: {},
		},
	};
	let reads = 0;
	const module = await Test.createTestingModule({
		controllers: [AtlasQueryController],
		providers: [
			{
				provide: ConfigService,
				useValue: new ConfigService({ ATLAS_QUERY_SECRET: "test-read-secret" }),
			},
			{ provide: AtlasQueryService, useValue: {} },
			{
				provide: AtlasQbrService,
				useValue: {
					exportReport: async (quarter: string) => {
						reads++;
						return {
							schemaVersion: "atlas.qbr.v1",
							quarter,
							definitionVersion: "7",
							generatedAt: "2026-10-03T12:00:00Z",
							metrics,
						};
					},
				},
			},
		],
	}).compile();
	const app = module.createNestApplication({ logger: false });
	await app.init();
	try {
		const full = await request(app.getHttpServer())
			.get("/internal/atlas/reports/qbr/2026-Q3")
			.set("Authorization", "Bearer test-read-secret")
			.expect(200);
		expect(full.body.metrics).toEqual(metrics);
		expect(full.body.view).toBeUndefined();
		const summary = await request(app.getHttpServer())
			.get("/internal/atlas/reports/qbr/2026-Q3?view=summary")
			.set("Authorization", "Bearer test-read-secret")
			.expect(200);
		expect(summary.body.metrics.retention).toEqual({
			label: "Retention",
			unit: "%",
			definition: "Exact definition",
			question: { number: 81, url: "https://atlas.example/questions/81" },
			notApplicable: false,
			automated: false,
			observations: { "2026-Q3": { status: "reported", value: 0 } },
			supportingResultCount: 1,
		});
		expect(summary.body.metrics.retention.preparation).toBeUndefined();
		const detail = await request(app.getHttpServer())
			.get("/internal/atlas/reports/qbr/2026-Q3?metricIds=retention")
			.set("Authorization", "Bearer test-read-secret")
			.expect(200);
		expect(detail.body.metrics).toEqual({ retention: metrics.retention });
		expect(detail.body.view).toBe("detail");
		for (const query of [
			"metricIds=",
			"metricIds=retention,",
			"metricIds=retention,retention",
			`metricIds=${Array.from({ length: 11 }, (_, index) => `m${index}`).join(",")}`,
			"metricIds=unknown",
			"metricIds=retention&view=summary",
			"view=full",
		]) {
			await request(app.getHttpServer())
				.get(`/internal/atlas/reports/qbr/2026-Q3?${query}`)
				.set("Authorization", "Bearer test-read-secret")
				.expect(400);
		}
		expect(reads).toBe(10);
	} finally {
		await app.close();
	}
});
