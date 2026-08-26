import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@crm/db";

process.env.DATABASE_URL ??= "postgresql://user:pass@127.0.0.1:5432/atlas";
const { AtlasAuthoringService } = await import("./atlas-authoring.service");

const input = {
	requestKey: "weekly-product-health",
	name: "Weekly product health",
	businessDefinition: "Weekly active teams with a successful generation.",
	decisionUse: "Product uses this to find activation regressions.",
	ownerTeam: "Product",
	cadence: "weekly" as const,
	dimensions: ["model", "plan"],
	sourceHints: ["Product Postgres"],
	acceptanceChecks: ["Reconcile totals to the generation fact table."],
};

describe("AtlasAuthoringService", () => {
	test("returns an existing idempotent draft without creating another", async () => {
		const createdAt = new Date("2026-08-26T12:00:00.000Z");
		const findUnique = mock(() =>
			Promise.resolve({
				publicNumber: 220,
				name: input.name,
				status: "DRAFT",
				purpose: "RECONCILIATION",
				sourceExternalId: `rudy-cron:${input.requestKey}`,
				createdAt,
			}),
		);
		const transaction = mock(() => Promise.reject(new Error("must not run")));
		const service = new AtlasAuthoringService({
			question: { findUnique },
			$transaction: transaction,
		} as unknown as Db);

		const result = await service.createDraft(input);

		expect(result.created).toBe(false);
		expect(result.cronEligible).toBe(false);
		expect(result.question.number).toBe(220);
		expect(transaction).not.toHaveBeenCalled();
	});

	test("creates only a draft reconciliation question", async () => {
		const createdAt = new Date("2026-08-26T12:00:00.000Z");
		const create = mock((_request: { data: Record<string, unknown> }) =>
			Promise.resolve({
				publicNumber: 221,
				name: input.name,
				status: "DRAFT",
				purpose: "RECONCILIATION",
				sourceExternalId: `rudy-cron:${input.requestKey}`,
				createdAt,
			}),
		);
		const transactionDatabase = {
			$executeRaw: mock(() => Promise.resolve(1)),
			dataSource: {
				upsert: mock(() => Promise.resolve({ id: "source" })),
			},
			question: {
				findUnique: mock(() => Promise.resolve(null)),
				aggregate: mock(() => Promise.resolve({ _max: { number: 500 } })),
				create,
			},
		};
		const database = {
			question: { findUnique: mock(() => Promise.resolve(null)) },
			$transaction: (
				callback: (value: typeof transactionDatabase) => unknown,
			) => callback(transactionDatabase),
		} as unknown as Db;
		const service = new AtlasAuthoringService(database);

		const result = await service.createDraft(input);

		expect(result.created).toBe(true);
		expect(result.cronEligible).toBe(false);
		const data = create.mock.calls[0]?.[0].data as {
			status: string;
			purpose: string;
			metricVersionId?: string;
		};
		expect(data.status).toBe("DRAFT");
		expect(data.purpose).toBe("RECONCILIATION");
		expect(data.metricVersionId).toBeUndefined();
	});
});
