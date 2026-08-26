import { describe, expect, test } from "bun:test";
import {
	buildActivePilotSummary,
	buildEnterpriseBookings,
	buildQ3LifecycleFunnel,
	buildStudioBookings,
	resolvePilotCompany,
} from "@crm/db/hubspot-sales";

describe("HubSpot active pilot summary", () => {
	test("refuses arbitrary company selection when a deal has multiple domains", () => {
		const companies = new Map([
			["agency", { name: "Agency", domain: "agency.example" }],
			["customer", { name: "Customer", domain: "customer.example" }],
		]);

		expect(resolvePilotCompany(["agency", "customer"], companies)).toBeNull();
		expect(resolvePilotCompany(["customer"], companies)).toEqual({
			name: "Customer",
			domain: "customer.example",
		});
	});

	test("reconciles the current registry and weekly entries and exits", () => {
		const result = buildActivePilotSummary({
			now: new Date("2026-08-26T12:00:00.000Z"),
			dataThrough: new Date("2026-08-26T11:45:00.000Z"),
			deals: [
				{
					id: "active-new",
					name: "Alpha pilot",
					companyIds: ["alpha"],
					pipelineId: "enterprise",
					stageId: "pilot",
					ownerId: "owner-1",
					createdAt: new Date("2026-08-01T00:00:00.000Z"),
					stageHistory: [
						{
							stageId: "discovery",
							changedAt: new Date("2026-08-01T00:00:00.000Z"),
						},
						{
							stageId: "pilot",
							changedAt: new Date("2026-08-25T08:00:00.000Z"),
						},
					],
				},
				{
					id: "active-existing",
					name: "Beta pilot",
					companyIds: ["beta"],
					pipelineId: "studio",
					stageId: "pilot-poc",
					ownerId: "owner-2",
					createdAt: new Date("2026-07-01T00:00:00.000Z"),
					stageHistory: [
						{
							stageId: "pilot-poc",
							changedAt: new Date("2026-07-01T00:00:00.000Z"),
						},
					],
				},
				{
					id: "exited",
					name: "Gamma pilot",
					companyIds: ["gamma"],
					pipelineId: "enterprise",
					stageId: "closed-lost",
					ownerId: "owner-1",
					createdAt: new Date("2026-07-01T00:00:00.000Z"),
					stageHistory: [
						{
							stageId: "pilot",
							changedAt: new Date("2026-07-01T00:00:00.000Z"),
						},
						{
							stageId: "closed-lost",
							changedAt: new Date("2026-08-24T09:00:00.000Z"),
						},
					],
				},
			],
			pipelines: new Map([
				[
					"enterprise",
					{
						stages: new Map([
							["discovery", "Discovery"],
							["pilot", "Pilot"],
							["closed-lost", "Closed lost"],
						]),
					},
				],
				["studio", { stages: new Map([["pilot-poc", "Pilot/POC"]]) }],
			]),
			owners: new Map([
				["owner-1", "Ada"],
				["owner-2", "Grace"],
			]),
			companies: new Map([
				["alpha", "Alpha"],
				["beta", "Beta"],
				["gamma", "Gamma"],
			]),
		});

		expect(result.rows).toEqual([
			[
				"2026-08-24T00:00:00.000Z",
				2,
				1,
				1,
				"Alpha; Beta",
				"Ada; Grace",
				"2026-08-26T11:45:00.000Z",
			],
		]);
	});
});

describe("HubSpot bookings reports", () => {
	const pipeline = {
		id: "pipeline",
		label: "Pipeline",
		order: 0,
		stages: new Map([
			["won", { label: "Closed won", order: 0, probability: 1 }],
			["open", { label: "Evaluation", order: 1, probability: 0.5 }],
		]),
	};
	const common = {
		now: new Date("2026-08-26T12:00:00.000Z"),
		dataThrough: new Date("2026-08-26T11:45:00.000Z"),
		months: 1,
		pipelines: new Map([["pipeline", pipeline]]),
		owners: new Map([["owner", "Ada"]]),
		companies: new Map([["company", "Acme"]]),
	};
	const deals = [
		{
			id: "won",
			name: "Acme order",
			companyIds: ["company"],
			pipelineId: "pipeline",
			stageId: "won",
			ownerId: "owner",
			amount: 1_000,
			isWon: true,
			createdAt: new Date("2026-08-03T00:00:00.000Z"),
			closeAt: new Date("2026-08-05T00:00:00.000Z"),
		},
		{
			id: "open",
			name: "Unmapped evaluation",
			companyIds: [],
			pipelineId: "pipeline",
			stageId: "open",
			ownerId: "owner",
			amount: 500,
			isWon: false,
			createdAt: new Date("2026-08-10T00:00:00.000Z"),
			closeAt: null,
		},
	];

	test("keeps Studio booked value separate from unavailable delivery state", () => {
		const result = buildStudioBookings({ ...common, deals });

		expect(result.rows).toEqual([
			[
				"2026-08-01T00:00:00.000Z",
				"Acme",
				"Closed won",
				1_000,
				null,
				"Ada",
				"unavailable",
				"unavailable",
				"2026-08-26T11:45:00.000Z",
			],
		]);
	});

	test("reports enterprise pipeline and bookings without inventing contract classifications", () => {
		const result = buildEnterpriseBookings({ ...common, deals });

		expect(result.rows).toEqual([
			[
				"2026-08-01T00:00:00.000Z",
				"all enterprise stages",
				1_500,
				1_000,
				null,
				null,
				null,
				1,
				"2026-08-26T11:45:00.000Z",
			],
		]);
	});
});

describe("Q3 enterprise lifecycle funnel", () => {
	test("uses exact lifecycle transitions and keeps signature evidence unavailable", () => {
		const result = buildQ3LifecycleFunnel({
			dataThrough: new Date("2026-07-13T00:00:00.000Z"),
			lifecycle: [
				{
					weekStart: new Date("2026-07-01T00:00:00.000Z"),
					periodEnd: new Date("2026-07-06T00:00:00.000Z"),
					mql: 1,
					pql: 0,
					sql: 0,
				},
				{
					weekStart: new Date("2026-07-06T00:00:00.000Z"),
					periodEnd: new Date("2026-07-13T00:00:00.000Z"),
					mql: 0,
					pql: 1,
					sql: 1,
				},
			],
			inbound: [
				{
					weekStart: new Date("2026-07-01T00:00:00.000Z"),
					periodEnd: new Date("2026-07-06T00:00:00.000Z"),
					enterpriseInbound: 1,
				},
				{
					weekStart: new Date("2026-07-06T00:00:00.000Z"),
					periodEnd: new Date("2026-07-13T00:00:00.000Z"),
					enterpriseInbound: 2,
				},
			],
			deals: ["newbusiness", "existingbusiness", "direct"].map(
				(dealType, index) => ({
					id: String(index),
					pipelineId: "989457121",
					isWon: true,
					closeAt: new Date("2026-07-10T10:00:00.000Z"),
					amount: 1000,
					dealType,
				}),
			),
			contracts: [
				{
					documentType: "SOW",
					evidenceDate: new Date("2026-07-10T00:00:00.000Z"),
					commercial: true,
				},
				{
					documentType: "ORDER_FORM",
					evidenceDate: new Date("2026-07-10T00:00:00.000Z"),
					commercial: true,
				},
			],
		});
		const records = result.rows.map((row) =>
			Object.fromEntries(
				result.columns.map((column, index) => [column.name, row[index]]),
			),
		);
		const totals = (column: string) =>
			records.reduce((sum, row) => sum + Number(row[column] ?? 0), 0);

		expect(totals("enterprise_inbound")).toBe(3);
		expect(totals("mql")).toBe(1);
		expect(totals("pql")).toBe(1);
		expect(totals("sql")).toBe(1);
		expect(totals("crm_paid_closed_won")).toBe(3);
		expect(totals("net_new_logos")).toBe(1);
		expect(totals("renewals")).toBe(1);
		expect(totals("unmapped_deals")).toBe(1);
		expect(totals("paid_sow_documents")).toBe(1);
		expect(totals("paid_order_form_documents")).toBe(1);
		expect(records.every((row) => row.signed_paid_sows === null)).toBe(true);
	});
});
