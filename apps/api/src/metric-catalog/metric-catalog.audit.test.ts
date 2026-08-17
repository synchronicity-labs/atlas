import { describe, expect, test } from "bun:test";
import {
	MetricCatalogAttemptOutcome,
	MetricReadinessStatus,
	MetricTrustStatus,
} from "@crm/db";
import { classifyMetricAudit } from "./metric-catalog.audit";

describe("metric catalog audit", () => {
	test("keeps returned data pending when the definition is open", () => {
		const result = classifyMetricAudit({
			readiness: MetricReadinessStatus.NEEDS_DEFINITION,
			decisionCount: 2,
			observations: [
				{
					questionNumber: 1,
					questionName: "Candidate",
					outcome: "DATA_FOUND",
					rowCount: 1,
					durationMs: 10,
					error: null,
					dataThrough: null,
					questionTrust: null,
				},
			],
			sources: [],
		});

		expect(result).toEqual({
			outcome: MetricCatalogAttemptOutcome.DATA_FOUND,
			trustStatus: MetricTrustStatus.PENDING,
			detail: "Data returned, but 2 definition decisions remain.",
		});
	});

	test("reports the missing query after finding a connected source", () => {
		const result = classifyMetricAudit({
			readiness: MetricReadinessStatus.NEEDS_DEFINITION,
			decisionCount: 1,
			observations: [],
			sources: [
				{
					label: "HubSpot CRM",
					state: "CONNECTED",
					reason: "Connected.",
				},
			],
		});

		expect(result.outcome).toBe(MetricCatalogAttemptOutcome.QUERY_NOT_BUILT);
		expect(result.detail).toContain("does not have a saved query");
	});

	test("records query failures separately from missing sources", () => {
		const result = classifyMetricAudit({
			readiness: MetricReadinessStatus.RECONCILING,
			decisionCount: 0,
			observations: [
				{
					questionNumber: 2,
					questionName: "Broken candidate",
					outcome: "QUERY_FAILED",
					rowCount: null,
					durationMs: null,
					error: "Read permission denied.",
					dataThrough: null,
					questionTrust: null,
				},
			],
			sources: [],
		});

		expect(result).toEqual({
			outcome: MetricCatalogAttemptOutcome.QUERY_FAILED,
			trustStatus: MetricTrustStatus.FAILED,
			detail: "The saved query failed: Read permission denied.",
		});
	});

	test("does not hide a failed question check when data is present", () => {
		const result = classifyMetricAudit({
			readiness: MetricReadinessStatus.RECONCILING,
			decisionCount: 0,
			observations: [
				{
					questionNumber: 3,
					questionName: "Untrusted result",
					outcome: "DATA_FOUND",
					rowCount: 1,
					durationMs: 15,
					error: null,
					dataThrough: "2026-08-17T00:00:00.000Z",
					questionTrust: MetricTrustStatus.FAILED,
				},
			],
			sources: [],
		});

		expect(result.trustStatus).toBe(MetricTrustStatus.FAILED);
		expect(result.detail).toContain("failed a required check");
	});

	test("uses the primary source instead of a weaker fallback", () => {
		const result = classifyMetricAudit({
			readiness: MetricReadinessStatus.NEEDS_SOURCE,
			decisionCount: 0,
			observations: [],
			sources: [
				{
					label: "Social platform analytics",
					state: "MISSING",
					reason: "A social API is needed.",
				},
				{
					label: "Web analytics",
					state: "ATTENTION",
					reason: "A separate web connector is stale.",
				},
			],
		});

		expect(result.outcome).toBe(MetricCatalogAttemptOutcome.SOURCE_MISSING);
		expect(result.detail).toContain("Social platform analytics");
	});

	test("uses evidence language for project outcomes", () => {
		const result = classifyMetricAudit({
			subject: "PROJECT_OUTCOME",
			readiness: MetricReadinessStatus.NEEDS_EVIDENCE,
			decisionCount: 0,
			observations: [],
			sources: [
				{
					label: "Linear project evidence",
					state: "CONNECTED",
					reason: "Connected.",
				},
			],
		});

		expect(result.outcome).toBe(MetricCatalogAttemptOutcome.QUERY_NOT_BUILT);
		expect(result.detail).toBe(
			"Linear project evidence is connected, but this project outcome does not have an evidence check yet.",
		);
	});
});
