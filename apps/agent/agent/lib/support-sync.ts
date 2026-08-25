import { DataSourceKind, db } from "@crm/db";
import {
	beginRun,
	completeRun,
	contentHash,
	ensureSource,
	failRun,
	inputJson,
} from "./customer-source";
import {
	fetchPylonIssues,
	fetchPylonSurveyResponses,
	fetchPylonSurveys,
	hasPylonSupportAccess,
	type PylonIssue,
} from "./pylon-support-client";

const SOURCE_KEY = "pylon:support";
const FRESHNESS_MS = 6 * 60 * 60 * 1000;
const DASHBOARD_EXTERNAL_ID = "atlas:customer-lifecycle:support";

type Snapshot = {
	externalId: string;
	columns: string[];
	rows: Array<Record<string, unknown>>;
};

function monthStart(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number): Date {
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
	);
}

function monthKey(value: string | null | undefined): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString().slice(0, 7);
}

function label(
	value: string | { name?: string | null } | null | undefined,
): string {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (value && typeof value === "object" && value.name?.trim()) {
		return value.name.trim();
	}
	return "Unknown";
}

function categories(issue: PylonIssue): string[] {
	const values = (issue.tags ?? [])
		.map((tag) => label(tag))
		.filter((tag) => tag !== "Unknown");
	return values.length > 0 ? values : ["Uncategorized"];
}

function numeric(value: unknown): number | null {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function average(values: number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? null);
}

function issueSnapshots(issues: PylonIssue[], months: string[]): Snapshot[] {
	const volume = months.map((month) => {
		const rows = issues.filter((issue) => monthKey(issue.created_at) === month);
		return {
			month,
			issues: rows.length,
			open_issues: rows.filter((issue) =>
				["open", "pending"].includes(String(issue.state).toLowerCase()),
			).length,
			closed_issues: rows.filter((issue) =>
				["closed", "resolved"].includes(String(issue.state).toLowerCase()),
			).length,
		};
	});

	const categoryCounts = new Map<string, number>();
	for (const issue of issues) {
		const month = monthKey(issue.created_at);
		if (!month) continue;
		for (const category of categories(issue)) {
			const key = `${month}\u0000${category}`;
			categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
		}
	}
	const categoryRows = [...categoryCounts]
		.map(([key, count]) => {
			const [month, category] = key.split("\u0000");
			return { month, category, issues: count };
		})
		.sort((a, b) =>
			a.month === b.month
				? b.issues - a.issues
				: String(a.month).localeCompare(String(b.month)),
		);

	const responseRows = months.map((month) => {
		const rows = issues.filter((issue) => monthKey(issue.created_at) === month);
		const firstResponses = rows.flatMap((issue) => {
			const value = numeric(
				issue.business_hours_first_response_seconds ??
					issue.first_response_seconds,
			);
			return value === null ? [] : [value];
		});
		const resolutions = rows.flatMap((issue) => {
			const value = numeric(issue.resolution_time);
			return value === null ? [] : [value];
		});
		const averageFirstResponse = average(firstResponses);
		const medianFirstResponse = median(firstResponses);
		const averageResolution = average(resolutions);
		const medianResolution = median(resolutions);
		return {
			month,
			issues_with_first_response: firstResponses.length,
			average_first_response_minutes:
				averageFirstResponse === null ? null : averageFirstResponse / 60,
			median_first_response_minutes:
				medianFirstResponse === null ? null : medianFirstResponse / 60,
			issues_with_resolution: resolutions.length,
			average_resolution_hours:
				averageResolution === null ? null : averageResolution / 3600,
			median_resolution_hours:
				medianResolution === null ? null : medianResolution / 3600,
		};
	});

	const sourceCounts = new Map<string, number>();
	for (const issue of issues) {
		const month = monthKey(issue.created_at);
		if (!month) continue;
		const source = label(issue.source);
		const key = `${month}\u0000${source}`;
		sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
	}
	const sourceRows = [...sourceCounts]
		.map(([key, count]) => {
			const [month, source] = key.split("\u0000");
			return { month, source, issues: count };
		})
		.sort((a, b) =>
			a.month === b.month
				? b.issues - a.issues
				: String(a.month).localeCompare(String(b.month)),
		);

	return [
		{
			externalId: "atlas-support-issue-volume",
			columns: ["month", "issues", "open_issues", "closed_issues"],
			rows: volume,
		},
		{
			externalId: "atlas-support-top-categories",
			columns: ["month", "category", "issues"],
			rows: categoryRows,
		},
		{
			externalId: "atlas-support-response-resolution",
			columns: [
				"month",
				"issues_with_first_response",
				"average_first_response_minutes",
				"median_first_response_minutes",
				"issues_with_resolution",
				"average_resolution_hours",
				"median_resolution_hours",
			],
			rows: responseRows,
		},
		{
			externalId: "atlas-support-channel-volume",
			columns: ["month", "source", "issues"],
			rows: sourceRows,
		},
	];
}

function remiReadinessSnapshot(): Snapshot {
	return {
		externalId: "atlas-support-remi-performance",
		columns: ["status", "next_step"],
		rows: [
			{
				status: "Not connected",
				next_step:
					"Confirm the Remi outcome and map its read-only aggregate endpoint.",
			},
		],
	};
}

async function csatSnapshot(months: string[]): Promise<Snapshot> {
	const scores = new Map<string, number[]>();
	for (const survey of await fetchPylonSurveys()) {
		for (const response of await fetchPylonSurveyResponses(survey.id)) {
			const month = monthKey(response.submitted_at);
			if (!month || !months.includes(month)) continue;
			for (const answer of response.answers ?? []) {
				if (answer.question_type !== "score") continue;
				const score = numeric(answer.value);
				if (score === null) continue;
				scores.set(month, [...(scores.get(month) ?? []), score]);
			}
		}
	}
	return {
		externalId: "atlas-support-csat",
		columns: ["month", "responses", "average_score"],
		rows: months.map((month) => ({
			month,
			responses: scores.get(month)?.length ?? 0,
			average_score: average(scores.get(month) ?? []),
		})),
	};
}

async function persistSnapshot(input: {
	sourceId: string;
	snapshot: Snapshot;
	reportingPeriod: string;
	capturedAt: Date;
}): Promise<number> {
	const payload = {
		columns: input.snapshot.columns,
		rows: input.snapshot.rows,
	};
	const hash = contentHash(payload);
	const created = await db.resultSnapshot.createMany({
		data: [
			{
				idempotencyKey: `atlas:support:${input.snapshot.externalId}:${input.reportingPeriod}:${hash}`,
				sourceId: input.sourceId,
				dashboardExternalId: DASHBOARD_EXTERNAL_ID,
				questionExternalId: input.snapshot.externalId,
				reportingPeriod: input.reportingPeriod,
				capturedAt: input.capturedAt,
				contentHash: hash,
				columns: inputJson(input.snapshot.columns),
				rows: inputJson(input.snapshot.rows),
				rowCount: input.snapshot.rows.length,
			},
		],
		skipDuplicates: true,
	});
	return created.count;
}

export async function syncSupportOperations() {
	const configured = hasPylonSupportAccess();
	const source = await ensureSource({
		key: SOURCE_KEY,
		kind: DataSourceKind.ATLAS,
		label: "Pylon support aggregates",
		configured,
	});
	if (!configured) return { configured: false, reason: "pylon_not_configured" };

	const now = new Date();
	const start = addMonths(monthStart(now), -5);
	const periods: Array<{ start: Date; end: Date }> = [];
	for (let cursor = start; cursor < now; ) {
		const end = new Date(
			Math.min(cursor.getTime() + 30 * 24 * 60 * 60 * 1000, now.getTime()),
		);
		periods.push({ start: cursor, end });
		cursor = end;
	}
	const months = Array.from({ length: 6 }, (_, index) =>
		addMonths(start, index).toISOString().slice(0, 7),
	);
	const run = await beginRun({
		sourceId: source.id,
		scope: "atlas:support:operations",
		period: now.toISOString().slice(0, 7),
	});

	try {
		const issueById = new Map<string, PylonIssue>();
		for (const period of periods) {
			for (const issue of await fetchPylonIssues(period)) {
				issueById.set(issue.id, issue);
			}
		}
		const issues = [...issueById.values()];
		const snapshots = [
			...issueSnapshots(issues, months),
			await csatSnapshot(months),
			remiReadinessSnapshot(),
		];
		let snapshotsCreated = 0;
		for (const snapshot of snapshots) {
			snapshotsCreated += await persistSnapshot({
				sourceId: source.id,
				snapshot,
				reportingPeriod: now.toISOString().slice(0, 7),
				capturedAt: now,
			});
		}
		await completeRun({
			runId: run.id,
			sourceId: source.id,
			records: issues.length,
			snapshots: snapshotsCreated,
			checkpoint: {
				months,
				issueRowsRead: issues.length,
				storedFields: "monthly aggregates only",
			},
			freshnessMs: FRESHNESS_MS,
		});
		return {
			configured: true,
			runId: run.id,
			issueRowsRead: issues.length,
			snapshotsCreated,
		};
	} catch (error) {
		await failRun(run.id, source.id, error);
		throw error;
	}
}
