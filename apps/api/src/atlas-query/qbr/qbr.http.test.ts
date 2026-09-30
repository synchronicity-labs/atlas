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
