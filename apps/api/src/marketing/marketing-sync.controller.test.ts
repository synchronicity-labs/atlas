import { describe, expect, mock, test } from "bun:test";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import type { MarketingService } from "./marketing.service";
import { MarketingSyncController } from "./marketing-sync.controller";

function controller(secret?: string) {
	const syncDashboard = mock(async () => ({ snapshotsCreated: 1 }));
	return {
		syncDashboard,
		controller: new MarketingSyncController(
			{ syncDashboard } as unknown as MarketingService,
			new ConfigService({ CRON_SECRET: secret }) as ConfigService<
				EnvironmentVariables,
				true
			>,
		),
	};
}

describe("source-scoped Marketing sync endpoint", () => {
	test("forwards the selected dashboard and source after authorization", async () => {
		const subject = controller("test-secret");
		await subject.controller.syncSource(
			4,
			"incentive-source",
			"Bearer test-secret",
		);
		expect(subject.syncDashboard).toHaveBeenCalledWith(4, "incentive-source");
	});

	test("rejects missing or invalid authorization before starting a source", async () => {
		for (const authorization of [undefined, "Bearer invalid"]) {
			const subject = controller("test-secret");
			await expect(
				subject.controller.syncSource(4, "incentive-source", authorization),
			).rejects.toThrow("Forbidden");
			expect(subject.syncDashboard).not.toHaveBeenCalled();
		}
	});

	test("disables the endpoint when sync is not configured", async () => {
		const subject = controller();
		await expect(
			subject.controller.syncSource(4, "incentive-source"),
		).rejects.toThrow("Sync is not configured");
		expect(subject.syncDashboard).not.toHaveBeenCalled();
	});

	test("never widens an empty source selection into a whole-dashboard refresh", async () => {
		const subject = controller("test-secret");
		await expect(
			subject.controller.syncSource(4, " ", "Bearer test-secret"),
		).rejects.toThrow("Source is required");
		expect(subject.syncDashboard).not.toHaveBeenCalled();
	});

	test("keeps the scheduled whole-Marketing refresh unchanged", async () => {
		const subject = controller("test-secret");
		await subject.controller.viaPost("Bearer test-secret");
		expect(subject.syncDashboard).toHaveBeenCalledWith(3);
	});
});
