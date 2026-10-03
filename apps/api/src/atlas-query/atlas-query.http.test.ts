import "reflect-metadata";
import { expect, test } from "bun:test";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AtlasQueryController } from "./atlas-query.controller";
import { AtlasQueryService } from "./atlas-query.service";
import { AtlasQbrService } from "./qbr/qbr.service";

test("Atlas question HTTP reads accept supported periods and reject invalid filters", async () => {
	const reads: Array<{ number: number; query: Record<string, unknown> }> = [];
	const module = await Test.createTestingModule({
		controllers: [AtlasQueryController],
		providers: [
			{
				provide: ConfigService,
				useValue: new ConfigService({
					ATLAS_QUERY_SECRET: "test-read-secret",
				}),
			},
			{
				provide: AtlasQueryService,
				useValue: {
					question: async (number: number, query: Record<string, unknown>) => {
						reads.push({ number, query });
						return { number, reportingPeriod: query.reportingPeriod ?? null };
					},
				},
			},
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
		const quarter = await request(app.getHttpServer())
			.get(
				"/internal/atlas/questions/548?reportingPeriod=2026-Q3&asOf=2026-10-02T22%3A24%3A49.260Z",
			)
			.set("Authorization", "Bearer test-read-secret")
			.expect(200);
		expect(quarter.body).toEqual({ number: 548, reportingPeriod: "2026-Q3" });
		expect(reads[0]).toEqual({
			number: 548,
			query: {
				reportingPeriod: "2026-Q3",
				asOf: "2026-10-02T22:24:49.260Z",
			},
		});
		for (const period of ["2026-09", "2026-09-30"]) {
			const result = await request(app.getHttpServer())
				.get(`/internal/atlas/questions/548?reportingPeriod=${period}`)
				.set("Authorization", "Bearer test-read-secret")
				.expect(200);
			expect(result.body.reportingPeriod).toBe(period);
		}

		for (const period of [
			"0000-Q3",
			"0000-01",
			"0000-01-01",
			"2026-Q0",
			"2026-Q5",
			"2026-13",
			"2026-02-30",
		]) {
			await request(app.getHttpServer())
				.get(`/internal/atlas/questions/548?reportingPeriod=${period}`)
				.set("Authorization", "Bearer test-read-secret")
				.expect(400);
		}
		expect(reads).toHaveLength(3);

		const latest = await request(app.getHttpServer())
			.get("/internal/atlas/questions/548")
			.set("Authorization", "Bearer test-read-secret")
			.expect(200);
		expect(latest.body).toEqual({ number: 548, reportingPeriod: null });
		expect(reads).toHaveLength(4);
	} finally {
		await app.close();
	}
});
