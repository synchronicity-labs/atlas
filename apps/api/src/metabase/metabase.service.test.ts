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
