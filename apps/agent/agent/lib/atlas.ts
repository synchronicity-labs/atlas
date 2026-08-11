import { db } from "@crm/db";

const ROW_LIMIT = 40;
const QUERY_LIMIT = 24_000;

function rows(value: unknown): unknown[] {
	return Array.isArray(value) ? value.slice(0, ROW_LIMIT) : [];
}

function query(value: string): string {
	return value.length > QUERY_LIMIT
		? `${value.slice(0, QUERY_LIMIT)}\n\n[query truncated]`
		: value;
}

export async function readAtlasWorkspace() {
	const [dashboards, sources] = await Promise.all([
		db.dashboard.findMany({
			orderBy: { number: "asc" },
			select: {
				number: true,
				name: true,
				description: true,
				updatedAt: true,
				_count: { select: { tabs: true, cards: true } },
			},
		}),
		db.dataSource.findMany({
			orderBy: { label: "asc" },
			select: {
				key: true,
				label: true,
				kind: true,
				state: true,
				lastSyncAt: true,
				freshnessDeadlineAt: true,
				lastError: true,
			},
		}),
	]);
	return { dashboards, sources };
}

export async function readAtlasDashboard(number: number) {
	const dashboard = await db.dashboard.findUnique({
		where: { number },
		select: {
			number: true,
			name: true,
			description: true,
			layoutVersion: true,
			updatedAt: true,
			tabs: {
				orderBy: { position: "asc" },
				select: { number: true, name: true, position: true },
			},
			cards: {
				orderBy: [{ tab: { position: "asc" } }, { position: "asc" }],
				select: {
					x: true,
					y: true,
					width: true,
					height: true,
					visualization: true,
					tab: { select: { number: true, name: true } },
					question: {
						select: {
							number: true,
							name: true,
							description: true,
							connector: true,
							sourceExternalId: true,
							versions: {
								orderBy: { version: "desc" },
								take: 1,
								select: {
									version: true,
									queryLanguage: true,
									display: true,
								},
							},
						},
					},
				},
			},
		},
	});
	if (!dashboard) return null;

	const externalIds = dashboard.cards.flatMap((card) =>
		card.question.sourceExternalId ? [card.question.sourceExternalId] : [],
	);
	const snapshots = await db.resultSnapshot.findMany({
		where: { questionExternalId: { in: externalIds } },
		orderBy: { capturedAt: "desc" },
		select: {
			questionExternalId: true,
			reportingPeriod: true,
			capturedAt: true,
			rowCount: true,
			columns: true,
			rows: true,
		},
	});
	const latest = new Map<string, (typeof snapshots)[number]>();
	for (const snapshot of snapshots) {
		if (!latest.has(snapshot.questionExternalId)) {
			latest.set(snapshot.questionExternalId, snapshot);
		}
	}

	return {
		...dashboard,
		cards: dashboard.cards.map((card) => {
			const snapshot = card.question.sourceExternalId
				? latest.get(card.question.sourceExternalId)
				: null;
			return {
				...card,
				question: {
					...card.question,
					latestVersion: card.question.versions[0] ?? null,
					versions: undefined,
				},
				latestSnapshot: snapshot
					? { ...snapshot, rows: rows(snapshot.rows) }
					: null,
			};
		}),
	};
}

export async function readAtlasQuestion(number: number) {
	const questionRecord = await db.question.findUnique({
		where: { number },
		select: {
			id: true,
			number: true,
			name: true,
			description: true,
			connector: true,
			sourceExternalId: true,
			databaseExternalId: true,
			updatedAt: true,
			versions: {
				orderBy: { version: "desc" },
				take: 5,
				select: {
					version: true,
					queryLanguage: true,
					queryText: true,
					display: true,
					visualization: true,
					createdBy: true,
					createdAt: true,
				},
			},
			dashboardCards: {
				select: {
					dashboard: { select: { number: true, name: true } },
					tab: { select: { number: true, name: true } },
				},
			},
		},
	});
	if (!questionRecord) return null;

	const snapshots = questionRecord.sourceExternalId
		? await db.resultSnapshot.findMany({
				where: { questionExternalId: questionRecord.sourceExternalId },
				orderBy: { capturedAt: "desc" },
				take: 6,
				select: {
					reportingPeriod: true,
					capturedAt: true,
					rowCount: true,
					columns: true,
					rows: true,
				},
			})
		: [];

	return {
		...questionRecord,
		versions: questionRecord.versions.map((version, index) => ({
			...version,
			queryText: index === 0 ? query(version.queryText) : undefined,
		})),
		snapshots: snapshots.map((snapshot) => ({
			...snapshot,
			rows: rows(snapshot.rows),
		})),
	};
}
