import { VerificationStatus } from "@crm/db";
import type { MetabaseResult } from "./metabase.client";
import type { PublishVerificationCheck } from "./product-metric.publisher";

const MAJOR_PROVIDERS = new Set([
	"gmail.com",
	"googlemail.com",
	"outlook.com",
	"hotmail.com",
	"live.com",
	"msn.com",
	"icloud.com",
	"me.com",
	"yahoo.com",
	"ymail.com",
	"aol.com",
	"proton.me",
	"protonmail.com",
	"qq.com",
	"163.com",
	"naver.com",
	"duck.com",
	"mail.ru",
	"yandex.ru",
]);

const FORBIDDEN_OUTPUTS = new Set([
	"customer_id",
	"distinct_id",
	"email",
	"organization_id",
	"person_id",
	"user_id",
	"uuid",
]);

type Row = Record<string, unknown>;

export function abuseUsesAllIdentities(
	sourceExternalId: string | null,
): boolean {
	return sourceExternalId === "cron:abuse:enforcement-detail";
}

export function abuseRingVerificationChecks(
	result: MetabaseResult,
	queryText: string,
): PublishVerificationCheck[] {
	const rows = records(result);
	const summary = rows.filter((row) => row.section === "summary");
	const reasons = rows.filter((row) => row.section === "reason");
	const headlineTotal = number(summary[0]?.headline_total);
	const reasonTotal = reasons.reduce(
		(total, row) => total + number(row.blocked_attempts),
		0,
	);
	const headlineMatches =
		summary.length === 1 &&
		number(summary[0]?.blocked_attempts) === headlineTotal &&
		reasonTotal === headlineTotal &&
		rows.every((row) => number(row.headline_total) === headlineTotal);
	const ringRows = rows.filter((row) =>
		["domain_ring", "ip_ring"].includes(String(row.section)),
	);
	const ringDefinition = ringRows.every((row) => {
		if (number(row.blocked_attempts) < 5) return false;
		if (row.section === "domain_ring") {
			return !MAJOR_PROVIDERS.has(String(row.dimension_value).toLowerCase());
		}
		return String(row.dimension_value).trim().length > 0;
	});
	const outputNames = result.columns.map((column) => column.name.toLowerCase());
	const privacyBoundary = outputNames.every(
		(name) => !FORBIDDEN_OUTPUTS.has(name),
	);
	const watermarks = new Set(rows.map((row) => String(row.data_through)));
	const normalizedQuery = queryText.toLowerCase();
	const rollingWindow =
		watermarks.size === 1 &&
		Number.isFinite(Date.parse([...watermarks][0] ?? "")) &&
		normalizedQuery.includes("timestamp >= now() - interval 1 day") &&
		normalizedQuery.includes("timestamp < now()");

	return [
		check(
			"headline_reconciliation",
			headlineMatches,
			"The 24-hour reason rows must sum to the same blocked-attempt total as the summary row.",
			{ headlineTotal, reasonTotal, summaryRows: summary.length },
		),
		check(
			"ring_definition_review",
			ringDefinition,
			"Domain and IP rings require at least five blocked attempts, and common mailbox providers are excluded from domain rings.",
			{ ringRows: ringRows.length },
		),
		check(
			"sensitive_detail_boundary",
			privacyBoundary,
			"The governed result may contain thresholded domain, IP, and user-agent signals, but it must not publish customer, user, organization, or email identifiers.",
			{ outputNames },
		),
		check(
			"rolling_window_watermark",
			rollingWindow,
			"Every row must share one data-through timestamp and use the same half-open rolling 24-hour window.",
			{ dataThrough: [...watermarks] },
		),
	];
}

export function abuseEnforcementVerificationChecks(
	result: MetabaseResult,
	queryText: string,
): PublishVerificationCheck[] {
	const rows = records(result);
	const summaryRows = rows.filter((row) => row.section === "summary");
	const summary = metrics(summaryRows[0]?.metrics);
	const bannedTotal = rows
		.filter((row) => row.section === "banned_reason_24h")
		.reduce((total, row) => total + number(metrics(row.metrics).users), 0);
	const learnedDomainTotal = learnedTotal(rows, "domain");
	const learnedIpTotal = learnedTotal(rows, "ip");
	const banActionParity =
		summaryRows.length === 1 &&
		bannedTotal === number(summary.banned_users_24h) &&
		learnedDomainTotal === number(summary.new_domain_blocks) &&
		learnedIpTotal === number(summary.new_ip_blocks);
	const candidates = rows.filter(
		(row) => row.section === "fresh_ring_candidate",
	);
	const candidateAccounts = candidates.reduce(
		(total, row) => total + number(metrics(row.metrics).signup_count),
		0,
	);
	const freshRingDefinition =
		candidates.length === number(summary.fresh_ring_candidates) &&
		candidateAccounts === number(summary.fresh_ring_candidate_accounts) &&
		candidates.every((row) => {
			const values = metrics(row.metrics);
			const signups = number(values.signup_count);
			return (
				signups >= 20 &&
				number(values.distinct_domains) >= 10 &&
				number(values.banned_count) / signups < 0.8 &&
				(number(values.fast_api_key_users) >= 10 ||
					number(values.api_generation_users) >= 10)
			);
		});
	const outputNames = result.columns.map((column) => column.name.toLowerCase());
	const recentBlockTypes = rows
		.filter((row) => row.section === "recent_block")
		.map((row) => String(row.dimension_value).split(":", 1)[0] ?? "");
	const privacyBoundary =
		outputNames.every((name) => !FORBIDDEN_OUTPUTS.has(name)) &&
		recentBlockTypes.every((type) =>
			["domain", "ip", "user_agent"].includes(type),
		);
	const watermarks = new Set(rows.map((row) => String(row.data_through)));
	const normalizedQuery = queryText.toLowerCase();
	const rollingWindow =
		watermarks.size === 1 &&
		Number.isFinite(Date.parse([...watermarks][0] ?? "")) &&
		normalizedQuery.includes("date_trunc('minute', now())") &&
		normalizedQuery.includes("interval '1 day'") &&
		normalizedQuery.includes("interval '7 days'");

	return [
		check(
			"ban_action_parity",
			banActionParity,
			"Ban-reason and learned-block detail must reconcile to the 24-hour enforcement summary.",
			{
				bannedTotal,
				learnedDomainTotal,
				learnedIpTotal,
				summary,
			},
		),
		check(
			"fresh_ring_definition",
			freshRingDefinition,
			"Fresh IP-ring candidates must meet the approved account, domain, ban-ratio, and early-API-activity thresholds.",
			{ candidates: candidates.length, candidateAccounts },
		),
		check(
			"sensitive_detail_boundary",
			privacyBoundary,
			"The result may publish operational domain, IP, and user-agent values, but it must not publish email addresses or customer, user, or organization identifiers.",
			{ outputNames, recentBlockTypes },
		),
		check(
			"rolling_window_watermark",
			rollingWindow,
			"Every row must use one minute-aligned data-through timestamp for the governed 24-hour and 7-day windows.",
			{ dataThrough: [...watermarks] },
		),
	];
}

function records(result: MetabaseResult): Row[] {
	return result.rows.map((values) =>
		Object.fromEntries(
			result.columns.map((column, index) => [
				column.name,
				values[index] ?? null,
			]),
		),
	);
}

function metrics(value: unknown): Row {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Row;
	}
	if (typeof value !== "string") return {};
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Row)
			: {};
	} catch {
		return {};
	}
}

function learnedTotal(rows: Row[], type: string): number {
	return rows
		.filter(
			(row) => row.section === "new_block" && row.dimension_value === type,
		)
		.reduce((total, row) => total + number(metrics(row.metrics).count), 0);
}

function number(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function check(
	name: string,
	passed: boolean,
	reason: string,
	actualValue: unknown,
): PublishVerificationCheck {
	return {
		name,
		status: passed ? VerificationStatus.PASSED : VerificationStatus.FAILED,
		reason,
		referenceValue: { required: true },
		actualValue,
	};
}
