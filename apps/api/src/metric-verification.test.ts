import { describe, expect, test } from "bun:test";
import {
	summarizeDashboardVerification,
	summarizeMetricVerification,
	summarizePendingMetricVerification,
} from "./metric-verification";

describe("metric verification summaries", () => {
	test("keeps verification evidence with the immutable snapshot", () => {
		const summary = summarizeMetricVerification({
			trustStatus: "VERIFIED",
			reportingPeriod: "2026-07",
			dataThrough: new Date("2026-08-01T00:00:00Z"),
			computedAt: new Date("2026-08-01T00:05:00Z"),
			metricRun: {
				verifications: [
					{
						name: "source_snapshot",
						status: "PASSED",
						evidence: { capturedAt: "2026-08-01T00:05:00Z" },
						verifiedAt: new Date("2026-08-01T00:05:00Z"),
					},
				],
			},
		});

		expect(summary.status).toBe("VERIFIED");
		expect(summary.checks[0]?.label).toBe("Immutable source snapshot stored");
		expect(summary.dataThrough).toBe("2026-08-01T00:00:00.000Z");
	});

	test("only verifies a dashboard when every question is verified", () => {
		const verified = summarizeMetricVerification({
			trustStatus: "VERIFIED",
			reportingPeriod: "2026-07",
			dataThrough: new Date("2026-08-01T00:00:00Z"),
			computedAt: new Date("2026-08-01T00:05:00Z"),
			metricRun: { verifications: [] },
		});

		expect(summarizeDashboardVerification([verified])?.status).toBe("VERIFIED");
		expect(summarizeDashboardVerification([verified, null])?.status).toBe(
			"PENDING",
		);
	});

	test("keeps governed questions pending before their first snapshot", () => {
		const pending = summarizePendingMetricVerification();

		expect(pending.status).toBe("PENDING");
		expect(summarizeDashboardVerification([pending])?.status).toBe("PENDING");
	});
});
