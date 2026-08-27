import { describe, expect, test } from "bun:test";
import {
	completeMonday,
	lipsyncTrafficVerificationChecks,
	lipsyncTrafficWeeklyReport,
} from "./lipsync-traffic";
import type { MarketingResult } from "./marketing.client";

const query = {
	source: "lipsync_traffic",
	report: "weekly-acquisition",
	version: 1,
} as const;
const config = {
	ga4: { lipsync: { id: "525331485", label: "lipsync.com" } },
	searchConsole: { lipsync: "sc-domain:lipsync.com" },
};
const now = new Date("2026-08-27T16:00:00Z");
const result = (names: string[], rows: unknown[][]): MarketingResult => ({
	columns: names.map((name) => ({
		name,
		displayName: name,
		baseType: "type/Decimal",
	})),
	rows,
});
function client() {
	return {
		ga4Range: async () => ({
			...result(
				[
					"site",
					"totalUsers",
					"sessions",
					"newUsers",
					"engagedSessions",
					"averageSessionDuration",
				],
				[["lipsync.com", 100, 200, 80, 100, 30]],
			),
			sourceTimeZone: "America/Los_Angeles",
		}),
		searchConsoleRange: async (q: { dimensions: string[] }, start: Date) =>
			q.dimensions.length
				? result(
						["date", "clicks", "impressions", "ctr_pct", "position"],
						Array.from({ length: 7 }, (_, i) => [
							new Date(start.getTime() + i * 86400000)
								.toISOString()
								.slice(0, 10),
							2,
							100,
							2,
							5.5,
						]),
					)
				: result(
						["clicks", "impressions", "ctr_pct", "position"],
						[[14, 700, 2, 5.5]],
					),
	};
}

describe("Lipsync weekly traffic", () => {
	test("uses native weekly totals and separate source calendars", async () => {
		const report = await lipsyncTrafficWeeklyReport({
			query,
			config,
			now,
			marketing: client(),
		});
		expect(report.rows).toHaveLength(4);
		expect(report.rows[0]?.slice(0, 10)).toEqual([
			"2026-08-10T00:00:00.000Z",
			"ga4",
			"525331485",
			"America/Los_Angeles",
			100,
			200,
			80,
			100,
			50,
			30,
		]);
		expect(report.rows[2]?.slice(10, 14)).toEqual([14, 700, 2, 5.5]);
		expect(
			lipsyncTrafficVerificationChecks(report, query).every(
				(c) => c.status === "PASSED",
			),
		).toBe(true);
	});
	test("does not turn partial Monday search data into a complete latest week", async () => {
		const report = await lipsyncTrafficWeeklyReport({
			query,
			config,
			now: new Date("2026-08-31T09:00:00Z"),
			marketing: client(),
		});
		expect(report.rows[1]?.[0]).toBe("2026-08-24T00:00:00.000Z");
		expect(report.rows[3]?.[0]).toBe("2026-08-17T00:00:00.000Z");
		expect(
			report.rows.every((row) => row[16] === "2026-08-24T00:00:00.000Z"),
		).toBe(true);
	});
	test("handles calendar year rollover", () => {
		expect(completeMonday(new Date("2027-01-01T12:00:00Z")).toISOString()).toBe(
			"2026-12-28T00:00:00.000Z",
		);
	});
	test("does not finish a source week before midnight in California", () => {
		expect(completeMonday(new Date("2026-08-31T03:00:00Z")).toISOString()).toBe(
			"2026-08-24T00:00:00.000Z",
		);
		expect(completeMonday(new Date("2026-08-31T08:00:00Z")).toISOString()).toBe(
			"2026-08-31T00:00:00.000Z",
		);
	});
	test("refuses the sync.so property in a Lipsync report", async () => {
		await expect(
			lipsyncTrafficWeeklyReport({
				query,
				config: {
					...config,
					ga4: { lipsync: { id: "wrong", label: "sync.so" } },
				},
				now,
				marketing: client(),
			}),
		).rejects.toThrow("reviewed GA4 property");
	});
	test("refuses unknown GA4 time zones", async () => {
		const marketing = client();
		marketing.ga4Range = async () => ({
			...(await client().ga4Range()),
			sourceTimeZone: "",
		});
		await expect(
			lipsyncTrafficWeeklyReport({ query, config, now, marketing }),
		).rejects.toThrow("time zone");
	});
	test("refuses an incomplete finalized search week", async () => {
		const marketing = client();
		const original = marketing.searchConsoleRange;
		marketing.searchConsoleRange = async (q, start) => {
			const value = await original(q, start);
			if (q.dimensions.length) value.rows.pop();
			return value;
		};
		await expect(
			lipsyncTrafficWeeklyReport({ query, config, now, marketing }),
		).rejects.toThrow("seven finalized");
	});
	test("refuses inconsistent site and daily search totals", async () => {
		const marketing = client();
		const original = marketing.searchConsoleRange;
		marketing.searchConsoleRange = async (q, start) => {
			const value = await original(q, start);
			if (!q.dimensions.length && value.rows[0]) value.rows[0][0] = 15;
			return value;
		};
		await expect(
			lipsyncTrafficWeeklyReport({ query, config, now, marketing }),
		).rejects.toThrow("do not reconcile");
	});
	test("rejects changed scopes, rates, and person columns", async () => {
		const report = await lipsyncTrafficWeeklyReport({
			query,
			config,
			now,
			marketing: client(),
		});
		const changed = structuredClone(report);
		if (changed.rows[0]) {
			changed.rows[0][2] = "wrong";
			changed.rows[0][8] = 99;
		}
		changed.columns.push({
			name: "email",
			displayName: "email",
			baseType: "type/Text",
		});
		for (const row of changed.rows) row.push(null);
		const failed = lipsyncTrafficVerificationChecks(changed, query)
			.filter((c) => c.status === "FAILED")
			.map((c) => c.name);
		expect(failed).toEqual([
			"lipsync_source_scope",
			"metric_reconciliation",
			"aggregate_privacy",
		]);
	});
});
