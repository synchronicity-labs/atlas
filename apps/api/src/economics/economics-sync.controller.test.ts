import { describe, expect, mock, test } from "bun:test";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import type { MarketingService } from "../marketing/marketing.service";
import { MarketingSyncController } from "../marketing/marketing-sync.controller";
import type { EconomicsService } from "./economics.service";
import { EconomicsSyncController } from "./economics-sync.controller";

const payload = {
	capturedAt: "2026-09-07T12:00:00Z",
	collector: "rudy-modal-billing-v1",
	rows: [{ month: "2026-09", model: "sync-3", costUsd: 1 }],
};
function subject(values: Record<string, string> = {}) {
	const importModal = mock(async () => ({ snapshotCreated: true }));
	const config = new ConfigService(values) as ConfigService<
		EnvironmentVariables,
		true
	>;
	return {
		config,
		importModal,
		controller: new EconomicsSyncController(
			{ importModal } as unknown as EconomicsService,
			config,
		),
	};
}

describe("scoped Modal ingestion", () => {
	test("accepts its dedicated credential without enabling broader sync", async () => {
		const s = subject({ ATLAS_MODAL_INGEST_SECRET: "modal-only" });
		await s.controller.import(payload, "Bearer modal-only");
		expect(s.importModal).toHaveBeenCalledWith(payload);
		const marketing = new MarketingSyncController(
			{} as MarketingService,
			s.config,
		);
		await expect(marketing.viaPost("Bearer modal-only")).rejects.toThrow(
			"Sync is not configured",
		);
	});
	test("preserves the existing cron credential and rejects unrelated secrets", () => {
		const s = subject({
			CRON_SECRET: "cron",
			ATLAS_MODAL_INGEST_SECRET: "modal",
		});
		s.controller.import(payload, "Bearer cron");
		expect(() => s.controller.import(payload, "Bearer read-only")).toThrow(
			"Forbidden",
		);
		expect(s.importModal).toHaveBeenCalledTimes(1);
	});
	test("fails closed when unconfigured or given invalid rows", () => {
		expect(() => subject().controller.import(payload)).toThrow(
			"Sync is not configured",
		);
		const s = subject({ ATLAS_MODAL_INGEST_SECRET: "modal" });
		expect(() =>
			s.controller.import({ ...payload, rows: [] }, "Bearer modal"),
		).toThrow();
		expect(s.importModal).not.toHaveBeenCalled();
	});
});
