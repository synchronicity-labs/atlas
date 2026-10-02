import { describe, expect, test } from "bun:test";
import { parseCsv } from "../agent/lib/persona-evidence";
import { buildExport, validateInput } from "./export-toolkit-shots";

describe("buildExport", () => {
	test("keeps source and extraction times distinct and missing acceptance fields null", () => {
		const result = buildExport(
			[
				{
					path: "config/example/project.json",
					blob: "blob-sha",
					config: {
						project: {
							client_code: "cli",
							project_code: "prj",
							project_name: "Example",
						},
						shots: [
							{
								id: "shot-1",
								status: "delivered",
								billable: true,
								version: "2",
								working: {},
							},
						],
					},
				},
			],
			{
				repo: "example-org/example-toolkit",
				ref: "main",
				commit: "a".repeat(40),
				commitTimestampUtc: "2026-10-01T11:48:01Z",
			},
			"2026-10-02T12:00:00Z",
		);
		const [shot] = result.json.shots;
		expect(shot?.source_version).toBe("2");
		expect(shot?.delivery_base).toBeNull();
		expect(shot?.acceptance_status).toBeNull();
		expect(shot?.paid_status).toBeNull();
		expect(shot?.source_commit_timestamp_utc).toBe("2026-10-01T11:48:01Z");
		expect(shot?.extracted_at_utc).toBe("2026-10-02T12:00:00Z");
		expect(shot?.source_config_url).toContain("/blob/");
		expect(result.json.repository).toBe("example-org/example-toolkit");
		expect(result.json.source_ref).toBe("main");
		expect(result.json.source_commit).toBe("a".repeat(40));
		const [csvRow] = parseCsv(result.csv);
		expect(csvRow?.acceptance_status).toBe("");
		expect(csvRow?.billable).toBe("true");
		validateInput("example-org/example-toolkit", "main", ["config/a.json"]);
		expect(() =>
			validateInput("example-org/example-toolkit", "main;echo-no", [
				"config/a.json",
			]),
		).toThrow();
		expect(() =>
			validateInput("example-org/example-toolkit", "main", ["../a.json"]),
		).toThrow();
	});
});
