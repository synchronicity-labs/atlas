import { createHash, randomUUID } from "node:crypto";
import {
	db,
	type Prisma,
	SourceStatus,
	SyncMode,
	SyncRunStatus,
} from "@crm/db";
import { executeHubspotSalesQuery } from "@crm/db/hubspot-sales";

const DASHBOARD_NUMBER = 4;
const SOURCE_KEY = "hubspot:crm";
const FRESHNESS_MS = 6 * 60 * 60 * 1000;

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function syncSalesDashboard() {
	const dashboard = await db.dashboard.findUnique({
		where: { number: DASHBOARD_NUMBER },
		select: {
			cards: {
				select: {
					question: {
						select: {
							id: true,
							number: true,
							sourceId: true,
							sourceExternalId: true,
							versions: {
								orderBy: { version: "desc" },
								take: 1,
								select: {
									version: true,
									queryLanguage: true,
									queryText: true,
								},
							},
						},
					},
				},
			},
		},
	});
	if (!dashboard) return { configured: false, reason: "dashboard_missing" };
	const source = await db.dataSource.findUnique({ where: { key: SOURCE_KEY } });
	if (!source) return { configured: false, reason: "source_missing" };
	const questions = [
		...new Map(
			dashboard.cards.map((card) => [card.question.id, card.question]),
		).values(),
	].filter((question) => question.sourceId === source.id);
	const period = new Date().toISOString().slice(0, 7);
	const run = await db.syncRun.create({
		data: {
			runKey: `atlas:sales:${period}:${new Date().toISOString()}:${randomUUID()}`,
			sourceId: source.id,
			mode: SyncMode.INCREMENTAL,
			status: SyncRunStatus.RUNNING,
			scope: `dashboard:${DASHBOARD_NUMBER}`,
			period,
		},
	});
	await db.dataSource.update({
		where: { id: source.id },
		data: { state: SourceStatus.SYNCING, lastError: null },
	});
	let cardsProcessed = 0;
	let snapshotsCreated = 0;
	const errors: Array<{ number: number; message: string }> = [];
	for (const question of questions) {
		const version = question.versions[0];
		if (version?.queryLanguage !== "API") {
			errors.push({
				number: question.number,
				message: "Question has no HubSpot API version.",
			});
			continue;
		}
		try {
			const result = await executeHubspotSalesQuery(
				db,
				JSON.parse(version.queryText),
			);
			const payload = { columns: result.columns, rows: result.rows };
			const contentHash = hash(payload);
			const externalId =
				question.sourceExternalId ?? `sales:question:${question.number}`;
			const created = await db.resultSnapshot.createMany({
				data: [
					{
						idempotencyKey: `atlas:sales:${externalId}:v${version.version}:${period}:${contentHash}`,
						sourceId: source.id,
						dashboardExternalId: `atlas:${DASHBOARD_NUMBER}`,
						questionExternalId: externalId,
						reportingPeriod: period,
						capturedAt: new Date(),
						contentHash,
						columns: json(result.columns),
						rows: json(result.rows),
						rowCount: result.rows.length,
					},
				],
				skipDuplicates: true,
			});
			cardsProcessed += 1;
			snapshotsCreated += created.count;
		} catch (error) {
			errors.push({
				number: question.number,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	const finishedAt = new Date();
	const failed = errors.length > 0;
	const lastError = failed
		? errors.map((error) => `Q${error.number}: ${error.message}`).join(" | ")
		: null;
	await db.$transaction([
		db.syncRun.update({
			where: { id: run.id },
			data: {
				status: failed ? SyncRunStatus.FAILED : SyncRunStatus.COMPLETED,
				finishedAt,
				cardsProcessed,
				snapshotsCreated,
				error: lastError,
				checkpoint: json({ errors }),
			},
		}),
		db.dataSource.update({
			where: { id: source.id },
			data: {
				state: failed ? SourceStatus.ERROR : SourceStatus.HEALTHY,
				lastSyncAt: finishedAt,
				lastError,
				freshnessDeadlineAt: new Date(finishedAt.getTime() + FRESHNESS_MS),
			},
		}),
	]);
	return {
		configured: true,
		runId: run.id,
		cardsProcessed,
		snapshotsCreated,
		errors,
	};
}
