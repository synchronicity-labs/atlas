import { describe, expect, test } from "bun:test";
import { buildActivePilotSummary } from "@crm/db/hubspot-sales";

describe("HubSpot active pilot summary", () => {
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
