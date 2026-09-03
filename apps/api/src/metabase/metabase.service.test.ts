import { describe, expect, mock, test } from "bun:test";
import { MetabaseService } from "./metabase.service";

function rawMirror(existing = false) {
	const db = {
		sourceCard: { upsert: mock(async () => ({})) },
		question: { update: mock(async () => ({})) },
		questionVersion: { findFirstOrThrow: mock(async () => ({})) },
		resultSnapshot: {
			findUnique: mock(async () => (existing ? { id: "snapshot" } : null)),
			create: mock(async () => ({ id: "snapshot" })),
		},
	};
	const publish = mock(async () => undefined);
	const service = Object.assign(Object.create(MetabaseService.prototype), {
		db,
		productMetrics: { publish },
		ensureQuestion: mock(async () => ({ id: "question" })),
		ensureDashboardPlacement: mock(async () => undefined),
	}) as {
		persistDashboardCard(input: unknown): Promise<boolean>;
	};
	const input = {
		sourceId: "source",
		syncRunId: "raw-run",
		dashboardId: "dashboard",
		dashboard: { id: 1717, name: "Product scoreboard" },
		placement: {
			id: 1,
			card: { id: 8164, name: "Professional organizations", display: "scalar" },
		},
		period: "2026-07",
		result: {
			columns: [{ name: "value", displayName: null, baseType: "type/Integer" }],
			rows: [[527]],
		},
	};
	return { db, publish, service, input };
}

describe("raw Metabase dashboard snapshots", () => {
	test("stores source evidence without publishing it as an executed Atlas query", async () => {
		const { db, publish, service, input } = rawMirror();
		expect(await service.persistDashboardCard(input)).toBe(true);
		expect(db.sourceCard.upsert).toHaveBeenCalledTimes(1);
		expect(db.resultSnapshot.create).toHaveBeenCalledTimes(1);
		expect(db.questionVersion.findFirstOrThrow).not.toHaveBeenCalled();
		expect(db.question.update).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});

	test("does not duplicate a raw snapshot or change verification on a repeated sync", async () => {
		const { db, publish, service, input } = rawMirror(true);
		expect(await service.persistDashboardCard(input)).toBe(false);
		expect(db.resultSnapshot.create).not.toHaveBeenCalled();
		expect(db.question.update).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});
});

describe("Metabase visualization settings", () => {
	test("creates an immutable question version when only visualization changes", async () => {
		const create = mock(async (_input: unknown) => ({}));
		const db = {
			question: {
				findUnique: mock(async () => ({ id: "question" })),
				update: mock(async () => ({})),
			},
			questionVersion: {
				findFirst: mock(async () => ({
					version: 3,
					queryLanguage: "SQL",
					queryText: "select 1",
					display: "bar",
					visualization: { "graph.metrics": ["terminal_generations"] },
					createdBy: "metabase",
				})),
				create,
			},
		};
		const service = Object.assign(Object.create(MetabaseService.prototype), {
			db,
		}) as {
			ensureQuestion(sourceId: string, card: unknown): Promise<unknown>;
		};

		await service.ensureQuestion("source", {
			id: 137,
			name: "Generation feedback rate by model",
			display: "bar",
			query_type: "native",
			dataset_query: { native: { query: "select 1" } },
			visualization_settings: {
				"graph.metrics": ["coverage_of_completed_pct", "upvote_pct"],
			},
		});

		expect(create).toHaveBeenCalledTimes(1);
		expect(create.mock.calls[0]?.[0]).toMatchObject({
			data: {
				version: 4,
				visualization: {
					"graph.metrics": ["coverage_of_completed_pct", "upvote_pct"],
				},
			},
		});
	});

	test("keeps card settings when placement settings are empty", async () => {
		const create = mock(async (_input: unknown) => ({}));
		const db = {
			dashboard: { findUniqueOrThrow: mock(async () => ({ id: "dashboard" })) },
			dashboardTab: { findUnique: mock(async () => null) },
			dashboardCard: {
				findFirst: mock(async () => null),
				create,
			},
		};
		const service = Object.assign(Object.create(MetabaseService.prototype), {
			db,
		}) as {
			ensureDashboardPlacement(
				dashboard: unknown,
				placement: unknown,
				questionId: string,
			): Promise<void>;
		};

		await service.ensureDashboardPlacement(
			{ id: 1, name: "Product scoreboard" },
			{
				id: 10,
				visualization_settings: {},
				card: {
					id: 137,
					display: "bar",
					visualization_settings: {
						"graph.dimensions": ["model"],
						"graph.metrics": ["coverage_of_completed_pct", "upvote_pct"],
					},
				},
			},
			"question",
		);

		expect(create.mock.calls[0]?.[0]).toMatchObject({
			data: {
				displaySettings: {
					"graph.dimensions": ["model"],
					"graph.metrics": ["coverage_of_completed_pct", "upvote_pct"],
				},
			},
		});
	});
});
