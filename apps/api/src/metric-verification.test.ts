import { describe, expect, test } from "bun:test";
import {
	summarizeDashboardVerification,
	summarizeMetricVerification,
	summarizePendingMetricVerification,
} from "./metric-verification";

describe("metric verification summaries", () => {
	test("explains an empty result instead of claiming a number is available", () => {
		const snapshot = {
			trustStatus: "PENDING" as const,
			reportingPeriod: "2026-08",
			dataThrough: new Date("2026-08-28T00:00:00Z"),
			computedAt: new Date("2026-08-28T00:05:00Z"),
			metricRun: {
				verifications: [
					{
						name: "result_non_empty",
						status: "PENDING" as const,
						evidence: {
							reason:
								"No complete cohort was returned. This is not 0% retention.",
						},
						verifiedAt: null,
					},
				],
			},
		};
		expect(summarizeMetricVerification(snapshot).reason).toBe(
			"No complete cohort was returned. This is not 0% retention.",
		);
		for (const trustStatus of ["FAILED", "STALE"] as const) {
			expect(
				summarizeMetricVerification({ ...snapshot, trustStatus }).reason,
			).not.toContain("No complete cohort");
		}
	});

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
		expect(summary.checks[0]?.label).toBe("Source result is saved");
		expect(summary.dataThrough).toBe("2026-08-01T00:00:00.000Z");
	});

	test("uses neutral wording while the identity filter is still pending", () => {
		const summary = summarizeMetricVerification({
			trustStatus: "PENDING",
			reportingPeriod: "2026-08",
			dataThrough: new Date("2026-08-18T14:30:00Z"),
			computedAt: new Date("2026-08-18T14:31:00Z"),
			metricRun: {
				verifications: [
					{
						name: "exclude_banned_anonymous_internal",
						status: "PENDING",
						evidence: {
							reason: "The source returned a partial exclusion list.",
						},
						verifiedAt: null,
					},
				],
			},
		});

		expect(summary.checks[0]?.label).toBe(
			"The question population rule is applied",
		);
		expect(summary.checks[0]?.status).toBe("PENDING");
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
