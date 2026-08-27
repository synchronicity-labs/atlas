import { describe, expect, it, mock } from "bun:test";
import type { MetabasePreviewInput } from "./metabase.client";
import { prepareGovernedMetabaseQuery } from "./prepare-metabase-query";
import {
	buildTinybirdEligibility,
	governTinybirdQuery,
} from "./tinybird-eligibility.service";

function dependencies() {
	const snapshot = buildTinybirdEligibility(
		[],
		new Date("2026-08-28T12:00:00Z"),
		0,
		"ALL_IDENTITIES",
		"PRODUCT_ACTIVITY",
	);
	return {
		client: {
			preparePreview: mock(async (input: MetabasePreviewInput) => input),
		},
		eligibility: {
			current: mock(async () => snapshot),
			currentForPaidActivity: mock(async () => ({
				...snapshot,
				scope: "SUBSCRIBED_ORGANIZATIONS" as const,
			})),
			currentForRevenue: mock(async () => ({
				...snapshot,
				scope: "SUBSCRIBED_ORGANIZATIONS" as const,
				policy: "MONEY" as const,
			})),
			govern: mock(governTinybirdQuery),
		},
		policy: {
			compileForQuestion: mock(async () => {
				throw new Error("Unexpected revenue-door compilation");
			}),
		},
	};
}

const question = {
	number: 5042,
	name: "Negative generation feedback",
	sourceExternalId: "5182",
	databaseExternalId: "34",
};

describe("shared Metabase preview and refresh preparation", () => {
	it("filters Product SQL at the source and limits identity result rows", async () => {
		const { client, eligibility, policy } = dependencies();
		const prepared = await prepareGovernedMetabaseQuery(
			question,
			{ language: "SQL", queryText: "select * from public.generations" },
			client,
			eligibility,
			policy,
		);
		expect(prepared.governed?.applied).toBe(true);
		expect(prepared.governed?.eligibility.enforcement).toBe(
			"POSTGRES_LIVE_JOIN",
		);
		expect(prepared.input.queryText).toContain("atlas_population_generations");
		expect(prepared.input.queryText).toEndWith("limit 2000");
		expect(eligibility.current).toHaveBeenCalledTimes(1);
	});

	it("applies the same filter after compiling a Product visual question", async () => {
		const { eligibility, policy } = dependencies();
		const client = {
			preparePreview: mock(
				async (input: MetabasePreviewInput): Promise<MetabasePreviewInput> => ({
					...input,
					language: "SQL",
					queryText: "select * from public.generation_feedback",
				}),
			),
		};
		const prepared = await prepareGovernedMetabaseQuery(
			question,
			{ language: "MBQL", queryText: '{"database":34}' },
			client,
			eligibility,
			policy,
		);
		expect(prepared.input.language).toBe("SQL");
		expect(prepared.input.queryText).toContain(
			"atlas_population_generation_feedback",
		);
		expect(prepared.governed?.eligibility.complete).toBe(true);
	});

	it("keeps abuse enforcement records outside the clean-user filter", async () => {
		const { client, eligibility, policy } = dependencies();
		const prepared = await prepareGovernedMetabaseQuery(
			{ ...question, sourceExternalId: "cron:abuse:enforcement-detail" },
			{ language: "SQL", queryText: "select * from auth.users" },
			client,
			eligibility,
			policy,
		);
		expect(prepared.governed).toBeNull();
		expect(eligibility.current).not.toHaveBeenCalled();
		expect(prepared.input.queryText).toEndWith("limit 2000");
	});

	it("keeps the money and paid-activity policies distinct", async () => {
		const { client, eligibility, policy } = dependencies();
		const input = {
			language: "SQL" as const,
			queryText:
				"select count(*) from sync_prod.sync_usage3 where \"organizationPlanType\" in ('creator')",
		};
		await prepareGovernedMetabaseQuery(
			{ ...question, name: "Paid-plan activity", databaseExternalId: "166" },
			input,
			client,
			eligibility,
			policy,
		);
		expect(eligibility.currentForPaidActivity).toHaveBeenCalledTimes(1);
		const money = await prepareGovernedMetabaseQuery(
			{ ...question, name: "Usage revenue", databaseExternalId: "166" },
			input,
			client,
			eligibility,
			policy,
		);
		expect(eligibility.currentForRevenue).toHaveBeenCalledTimes(1);
		expect(money.governed?.eligibility.policy).toBe("MONEY");
	});

	it("binds supported template variables before compilation", async () => {
		const { client, eligibility, policy } = dependencies();
		const prepared = await prepareGovernedMetabaseQuery(
			question,
			{
				language: "SQL",
				queryText:
					"select date_trunc({{bucket}}, created_at) from public.generations",
			},
			client,
			eligibility,
			policy,
		);
		expect(prepared.input.queryText).toContain(
			"date_trunc('month', created_at)",
		);
	});

	it.each(["SQL", "MBQL"] as const)(
		"stops %s Product queries when the population filter cannot be applied",
		async (language) => {
			const { eligibility, policy } = dependencies();
			const client = {
				preparePreview: mock(
					async (
						input: MetabasePreviewInput,
					): Promise<MetabasePreviewInput> => ({
						...input,
						language: "SQL",
						queryText: "select * from public.unrecognized_product_records",
					}),
				),
			};
			await expect(
				prepareGovernedMetabaseQuery(
					question,
					{
						language,
						queryText: language === "SQL" ? "select 1" : '{"database":34}',
					},
					client,
					eligibility,
					policy,
				),
			).rejects.toThrow("The Product query was not executed");
		},
	);
});
