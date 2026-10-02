import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgresql://user:pass@127.0.0.1:5432/atlas";
const { q3LifecycleStageMetrics } = await import("../agent/lib/hubspot-sync");

test("Q3 lifecycle rows and watermark stop at the same completed quarter boundary", async () => {
	for (const [capturedAt, expectedBoundary] of [
		["2026-09-30T12:00:00.000Z", "2026-09-30T00:00:00.000Z"],
		["2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"],
		["2026-10-02T06:30:00.000Z", "2026-10-01T00:00:00.000Z"],
		["2027-01-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"],
	] as const) {
		const result = await q3LifecycleStageMetrics(
			{ searchTotal: async () => 1 },
			new Date(capturedAt),
		);
		expect(result.status).toBe("live");
		expect(result.dataThrough).toBe(expectedBoundary);
		expect(result.capturedAt).toBe(capturedAt);
		expect(result.rows).toHaveLength(14);
		expect(result.rows.at(-1)?.period_end).toBe(expectedBoundary);
	}
});
