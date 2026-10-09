import { describe, expect, it, mock } from "bun:test";
import type { MetabasePreviewInput } from "./metabase.client";
import { prepareGovernedMetabaseQuery } from "./prepare-metabase-query";
import type {
	RevenueDoorPolicyEvidence,
	RevenueDoorPolicyService,
} from "./revenue-door-policy.service";
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
			compileEnterprise: mock(async () => {
				throw new Error("Unexpected Enterprise revenue-door compilation");
			}),
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
	it("deduplicates weekly V3 payments by stable ID and rejects missing or conflicting IDs", async () => {
		const { client, eligibility, policy } = dependencies();
		const compileForQuestion = mock(
			async (_number: number, queryText: string) => ({
				queryText,
				evidence: {
					applied: true,
					complete: true,
				} as RevenueDoorPolicyEvidence,
			}),
		);
		const prepared = await prepareGovernedMetabaseQuery(
			{
				number: 1117,
				name: "Estimated self-serve V3 top-ups month-end",
				sourceExternalId: "weekly-revenue:v3-top-up-run-rate",
				databaseExternalId: "166",
			},
			{
				language: "SQL",
				queryText:
					"select sum(amount) from sync_prod.sync_stripe_payments where billingVersion = 'v3'",
			},
			client,
			eligibility,
			{ ...policy, compileForQuestion },
		);
		expect(prepared.input.queryText.toLowerCase()).toContain(
			"group by stripe_payment_source.id",
		);
		expect(prepared.input.queryText).toContain("throwIf(");
		expect(prepared.input.queryText.toLowerCase()).toContain(
			"uniqexact(tuple(",
		);
		expect(prepared.input.queryText.toLowerCase()).toContain(
			"select * from sync_prod.sync_stripe_payments where 1 = 1",
		);
		expect(prepared.governed?.eligibility).toMatchObject({
			policy: "MONEY",
			scope: "SUBSCRIBED_ORGANIZATIONS",
			complete: true,
		});
		const unrelated = await prepareGovernedMetabaseQuery(
			{
				number: 9001,
				name: "Unrelated payment audit",
				sourceExternalId: "other:payment-audit",
				databaseExternalId: "166",
			},
			{
				language: "SQL",
				queryText: "select sum(amount) from sync_prod.sync_stripe_payments",
			},
			client,
			eligibility,
			policy,
		);
		expect(unrelated.input.queryText.toLowerCase()).not.toContain(
			"group by stripe_payment_source.id",
		);
	});

	it("governs Enterprise usage retention with current Enterprise and revenue policies", async () => {
		const { client, eligibility, policy } = dependencies();
		const compileEnterprise = mock(async (queryText: string) => ({
			queryText,
			evidence: {
				applied: true,
				complete: true,
				policyId: "company-revenue-doors",
				status: "COMPLETE",
				matchMode: "INCLUDE_ENTERPRISE",
				door: "ENTERPRISE",
				ruleCount: 1,
				excludedPlans: [],
				excludedDomains: [],
				excludedOrganizationIds: [],
				includedPlans: [],
				includedDomains: [],
				includedOrganizationIds: [],
				includedOrganizationLabels: [],
				unresolvedDomains: [],
				contentHash: "policy-content-hash",
			} satisfies RevenueDoorPolicyEvidence,
		}));
		const prepared = await prepareGovernedMetabaseQuery(
			{
				number: 9876,
				name: "Enterprise usage retention",
				sourceExternalId: "qbr:enterprise_usage_retention",
				databaseExternalId: "166",
			},
			{
				language: "SQL",
				queryText:
					"select generationCostMillicents from sync_prod.sync_usage3 where usage_ndr_pct > 0",
			},
			client,
			eligibility,
			{ ...policy, compileEnterprise },
		);
		expect(compileEnterprise).toHaveBeenCalledTimes(1);
		expect(policy.compileForQuestion).not.toHaveBeenCalled();
		expect(eligibility.currentForRevenue).toHaveBeenCalledTimes(1);
		expect(eligibility.currentForPaidActivity).not.toHaveBeenCalled();
		expect(prepared.governed?.eligibility).toMatchObject({
			policy: "MONEY",
			scope: "SUBSCRIBED_ORGANIZATIONS",
			complete: true,
		});
		expect(prepared.revenueDoor?.evidence).toMatchObject({
			applied: true,
			complete: true,
			matchMode: "INCLUDE_ENTERPRISE",
		});
	});

	it("does not intercept an unrelated question with public number 435", async () => {
		const { client, eligibility, policy } = dependencies();
		const prepared = await prepareGovernedMetabaseQuery(
			{
				number: 435,
				name: "Unrelated source",
				sourceExternalId: "other:unrelated",
				databaseExternalId: "166",
			},
			{ language: "SQL", queryText: "select 1" },
			client,
			eligibility,
			policy,
		);
		expect(policy.compileEnterprise).not.toHaveBeenCalled();
		expect(policy.compileForQuestion).not.toHaveBeenCalled();
		expect(eligibility.currentForRevenue).not.toHaveBeenCalled();
		expect(prepared.revenueDoor).toBeNull();
		expect(prepared.governed?.eligibility.policy).toBe("PRODUCT_ACTIVITY");
	});

	it("requires complete door policy and paid activity eligibility for QBR PLG", async () => {
		const { client, eligibility, policy } = dependencies();
		const qbr = {
			...question,
			number: 9000,
			sourceExternalId: "qbr:product_m3_ndr",
			databaseExternalId: "166",
		};
		const input = {
			language: "SQL" as const,
			queryText: "select generationCostMillicents from sync_prod.sync_usage3",
		};
		await expect(
			prepareGovernedMetabaseQuery(qbr, input, client, eligibility, policy),
		).rejects.toThrow("complete applied revenue-door");
		const compile = mock(
			async (queryText: string) =>
				({ queryText, evidence: { applied: true, complete: true } }) as Awaited<
					ReturnType<RevenueDoorPolicyService["compile"]>
				>,
		);
		const prepared = await prepareGovernedMetabaseQuery(
			qbr,
			input,
			client,
			eligibility,
			{ ...policy, compile },
		);
		expect(compile).toHaveBeenCalledTimes(1);
		expect(eligibility.currentForPaidActivity).toHaveBeenCalledTimes(1);
		expect(eligibility.currentForRevenue).not.toHaveBeenCalled();
		expect(prepared.governed?.eligibility.policy).toBe("PRODUCT_ACTIVITY");
		expect(prepared.governed?.applied).toBe(true);
	});

	it("uses the explicit subscription scope for paid-account QBR questions", async () => {
		const { client, eligibility, policy } = dependencies();
		const prepared = await prepareGovernedMetabaseQuery(
			{
				number: 536,
				name: "PLG eligible paid base",
				sourceExternalId: "qbr:plg_eligible_accounts",
				databaseExternalId: "166",
			},
			{
				language: "SQL",
				queryText:
					"select 1 from sync_prod.sync_stripe_subscriptions_with_plan",
			},
			client,
			eligibility,
			{
				...policy,
				compile: mock(async (queryText: string) => ({
					queryText,
					evidence: {
						applied: true,
						complete: true,
					} as RevenueDoorPolicyEvidence,
				})),
			},
		);
		expect(eligibility.currentForPaidActivity).not.toHaveBeenCalled();
		expect(prepared.governed?.eligibility).toMatchObject({
			complete: true,
			scope: "SUBSCRIBED_ORGANIZATIONS",
			enforcement: "EXPLICIT_SUBSCRIPTION_SCOPE",
		});
	});

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

	it.each([
		[
			"abuse:users:currently-banned",
			"select count(*)::integer as currently_banned_accounts from auth.users where banned is true",
		],
		[
			"abuse:users:banned-updated-at-proxy",
			"select date_trunc('day', updated_at)::date as day, count(*)::integer as accounts_marked_banned from auth.users where banned is true and updated_at >= current_date - interval '180 days' group by 1 order by 1",
		],
		[
			"abuse:users:ban-reasons",
			"select coalesce(nullif(btrim(ban_reason), ''), '(none)') as ban_reason, count(*)::integer as banned_accounts from auth.users where banned is true and updated_at >= current_date - interval '30 days' group by 1 order by 2 desc",
		],
	])(
		"preserves the banned population for %s without dropping safety checks",
		async (sourceExternalId, queryText) => {
			const { client, eligibility, policy } = dependencies();
			const context = { ...question, sourceExternalId };
			const prepared = await prepareGovernedMetabaseQuery(
				context,
				{ language: "SQL", queryText },
				client,
				eligibility,
				policy,
			);
			expect(prepared.input.queryText).toBe(
				`select * from (${queryText}) as atlas_bounded_identity_result limit 2000`,
			);
			expect(prepared.governed).toBeNull();
			expect(eligibility.current).not.toHaveBeenCalled();
			await expect(
				prepareGovernedMetabaseQuery(
					context,
					{
						language: "SQL",
						queryText: "delete from auth.users where banned is true",
					},
					client,
					eligibility,
					policy,
				),
			).rejects.toThrow();
		},
	);

	it.each(["5182", "abuse:users:other", "abuse:users:currently-banned:copy"])(
		"still rejects an unfiltered identity query for %s",
		async (sourceExternalId) => {
			const { client, eligibility, policy } = dependencies();
			await expect(
				prepareGovernedMetabaseQuery(
					{ ...question, sourceExternalId },
					{ language: "SQL", queryText: "select * from auth.users" },
					client,
					eligibility,
					policy,
				),
			).rejects.toThrow("The Product query was not executed");
		},
	);

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
