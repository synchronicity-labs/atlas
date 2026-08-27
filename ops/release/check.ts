import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export const services = [
	{ name: "frontend", domain: "atlas.pr.sync.so", health: "/sign-in" },
	{ name: "api", domain: "atlas-api.pr.sync.so", health: "/health" },
	{ name: "ingestion", domain: "agent.pr.sync.so", health: "/eve/v1/health" },
] as const;

type Deployment = {
	readyState?: string;
	target?: string;
	gitSource?: { sha?: string };
	meta?: { githubCommitSha?: string; gitCommitSha?: string };
};

export function deploymentRevision(deployment: Deployment) {
	return (
		deployment.gitSource?.sha ??
		deployment.meta?.githubCommitSha ??
		deployment.meta?.gitCommitSha ??
		null
	);
}

export function releaseProblems(deployment: Deployment, expected: string) {
	const problems: string[] = [];
	if (deployment.readyState !== "READY")
		problems.push("Deployment is not ready");
	if (deployment.target !== "production")
		problems.push("Alias is not on production");
	if (deploymentRevision(deployment) !== expected)
		problems.push("Deployed commit does not match the requested release");
	return problems;
}

export function healthyResponse(name: string, status: number, body: unknown) {
	if (status !== 200) return false;
	if (name === "frontend") return true;
	if (!body || typeof body !== "object") return false;
	const result = body as Record<string, unknown>;
	return name === "api"
		? result.status === "ok" && result.database === "up"
		: result.ok === true && result.status === "ready";
}

async function vercelApi(path: string) {
	try {
		const { stdout } = await execute(
			"vercel",
			["api", path, "--scope", "sync-labs", "--raw"],
			{ timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
		);
		return JSON.parse(stdout);
	} catch {
		throw new Error(
			"Could not inspect Vercel. Check CLI login and team access.",
		);
	}
}

export async function checkRelease(expected: string) {
	if (!/^[a-f0-9]{40}$/.test(expected))
		throw new Error("Use the full 40-character Git commit SHA.");
	const results = await Promise.all(
		services.map(async (service) => {
			try {
				const alias = await vercelApi(`/v4/aliases/${service.domain}`);
				const id = alias.deployment?.id;
				if (typeof id !== "string" || !/^dpl_[a-zA-Z0-9]+$/.test(id))
					throw new Error("Production alias has no deployment.");
				const deployment: Deployment = await vercelApi(
					`/v13/deployments/${id}`,
				);
				const problems = releaseProblems(deployment, expected);
				const response = await fetch(
					`https://${service.domain}${service.health}`,
					{
						redirect: "manual",
						signal: AbortSignal.timeout(20_000),
					},
				);
				const body = service.name === "frontend" ? null : await response.json();
				if (!healthyResponse(service.name, response.status, body))
					problems.push("Health check failed");
				return {
					service: service.name,
					commit: deploymentRevision(deployment),
					ready: problems.length === 0,
					problems,
				};
			} catch {
				return {
					service: service.name,
					commit: null,
					ready: false,
					problems: [
						"Release could not be checked. Check Vercel CLI access and service health.",
					],
				};
			}
		}),
	);
	return results;
}

if (import.meta.main) {
	const expected = process.argv[2];
	if (!expected) {
		console.error("Usage: bun run release:check <full-commit-sha>");
		process.exitCode = 1;
	} else {
		try {
			const results = await checkRelease(expected);
			for (const result of results) console.log(JSON.stringify(result));
			process.exitCode = results.every((result) => result.ready) ? 0 : 1;
		} catch (error) {
			console.error(
				error instanceof Error ? error.message : "Release check failed",
			);
			process.exitCode = 1;
		}
	}
}
