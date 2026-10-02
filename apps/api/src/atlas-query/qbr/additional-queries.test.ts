import { expect, test } from "bun:test";
import {
	additionalMarketingQueries,
	additionalQbrQueries,
	qbrLatencyDiagnosticSql,
} from "./additional-queries";

test("latency period grouping pools raw Q3 durations without averaging monthly percentiles", () => {
	const latency = additionalQbrQueries.platform_latency_by_model_duration;
	const quarterLatency =
		additionalQbrQueries.platform_latency_by_model_duration_q3;
	expect(latency?.databaseExternalId).toBe("34");
	expect(quarterLatency?.databaseExternalId).toBe("34");
	for (const [query, grouping] of [
		[latency?.queryText, "month"],
		[quarterLatency?.queryText, "quarter"],
	] as const) {
		expect(query).toContain(`date_trunc('${grouping}'`);
		expect(query).toContain("2026-07-01");
		expect(query).toContain("2026-10-01");
		expect(query).toContain("count(*)::int as sample_count");
		expect(query).toContain("group by 1, 2, 3");
		expect(query).toContain("percentile_cont(0.95) within group");
		expect(query).not.toContain("avg(");
	}
	expect(qbrLatencyDiagnosticSql("quarter")).toContain(
		"g.finished_at - g.started_at",
	);
	expect(latency?.queryText).toContain(
		"extract(epoch from (g.finished_at - g.started_at)) * 1000",
	);
	expect(latency?.queryText).toContain("g.model_name");
	expect(latency?.queryText).toContain("when g.duration <= 5 then '0-5s'");
	expect(latency?.queryText).toContain("'>5-10s'");
	expect(latency?.queryText).toContain("'>10-30s'");
	expect(latency?.queryText).toContain("'>30-60s'");
	expect(latency?.queryText).toContain("'>60s'");
	expect(latency?.queryText).toContain("count(*)::int as sample_count");
	expect(latency?.queryText).toContain("g.duration >= 0");
	expect(latency?.queryText).toContain("g.status::text = 'COMPLETED'");
	expect(latency?.queryText).toContain("g.deleted_at is null");
	expect(latency?.queryText).toContain("2026-07-01");
	expect(latency?.queryText).toContain("2026-10-01");
	expect(latency?.queryText).not.toContain("avg(");

	const output = additionalQbrQueries.platform_output_minutes_diagnostic;
	expect(output?.databaseExternalId).toBe("34");
	expect(output?.queryText).toContain("sum(g.output_media_length) / 60.0");
	expect(output?.queryText).toContain("completed_output_minutes");
	expect(output?.queryText).toContain("g.status::text = 'COMPLETED'");
	expect(output?.queryText).toContain("g.output_media_length > 0");
	expect(output?.queryText).toContain("g.deleted_at is null");
	expect(
		additionalQbrQueries.platform_generation_status_diagnostic?.queryText,
	).toContain("generation_status");
	expect(
		additionalQbrQueries.platform_generation_status_diagnostic?.queryText,
	).toContain("last_updated_at");
});

test("marketing source probes expose site overlap and missing signup attribution", () => {
	const visitors = additionalMarketingQueries.marketing_visitors_by_site_month;
	expect(visitors?.source).toBe("ga4");
	if (visitors?.source !== "ga4") throw new Error("Expected GA4 query.");
	expect(visitors.exactRange).toEqual({
		startDate: "2026-07-01",
		endDateExclusive: "2026-10-01",
	});
	expect(visitors.properties).toEqual([
		"landing",
		"blog",
		"playground",
		"docs",
		"lipsync",
		"support",
	]);
	expect(visitors.dimensions).toEqual(["yearMonth"]);
	expect(visitors.metrics).toEqual(["totalUsers"]);
	expect(visitors.merge).toBe("rows");

	const signups = additionalMarketingQueries.marketing_clean_signups_by_month;
	expect(signups?.source).toBe("posthog");
	if (signups?.source !== "posthog") throw new Error("Expected PostHog query.");
	expect(signups.personPolicy).toBe("exclude_banned_product_users");
	expect(signups.query).toContain("group by person_id");
	expect(signups.query).toContain(
		"toStartOfMonth(toTimeZone(signup_at, 'UTC'))",
	);
	expect(signups.query).toContain("{{atlas_product_user_eligible}}");
	expect(signups.query).toContain("missing_first_touch_people");
	expect(signups.query).toContain("2026-07-01");
	expect(signups.query).toContain("2026-10-01");
});
