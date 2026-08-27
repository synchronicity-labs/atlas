import { describe, expect, test } from "bun:test";
import {
	checkRelease,
	deploymentRevision,
	healthyResponse,
	releaseProblems,
} from "./check";

const sha = "a".repeat(40);

describe("release verification", () => {
	test("requires the expected commit on a ready production deployment", () => {
		expect(
			releaseProblems(
				{ readyState: "READY", target: "production", gitSource: { sha } },
				sha,
			),
		).toEqual([]);
		expect(
			releaseProblems(
				{
					readyState: "READY",
					target: "production",
					gitSource: { sha: "b".repeat(40) },
				},
				sha,
			),
		).toContain("Deployed commit does not match the requested release");
	});

	test("does not accept missing revisions, previews, or failed builds", () => {
		expect(
			releaseProblems({ readyState: "ERROR", target: "preview" }, sha),
		).toHaveLength(3);
	});

	test("supports Git and CLI revision metadata without guessing", () => {
		expect(deploymentRevision({ meta: { githubCommitSha: sha } })).toBe(sha);
		expect(deploymentRevision({ meta: { gitCommitSha: sha } })).toBe(sha);
		expect(deploymentRevision({})).toBeNull();
	});

	test("checks API database and ingestion readiness, not just an HTTP response", () => {
		expect(healthyResponse("api", 200, { status: "ok", database: "up" })).toBe(
			true,
		);
		expect(
			healthyResponse("api", 200, { status: "ok", database: "down" }),
		).toBe(false);
		expect(
			healthyResponse("ingestion", 200, { ok: true, status: "ready" }),
		).toBe(true);
		expect(
			healthyResponse("ingestion", 200, { ok: false, status: "starting" }),
		).toBe(false);
		expect(healthyResponse("frontend", 307, null)).toBe(false);
		expect(healthyResponse("frontend", 200, null)).toBe(true);
	});

	test("rejects an invalid revision before accessing any service", async () => {
		await expect(checkRelease("main")).rejects.toThrow("40-character");
	});
});
