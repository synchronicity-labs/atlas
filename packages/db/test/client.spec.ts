import { describe, expect, it } from "bun:test";

const clientPath = new URL("../src/client.ts", import.meta.url).pathname;

async function runIsolated(code: string, databaseUrl = "") {
	const child = Bun.spawn([process.execPath, "--eval", code], {
		env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "production" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

describe("database initialization", () => {
	it("can import build-time modules without a database secret", async () => {
		const result = await runIsolated(`
			const { db } = await import(${JSON.stringify(clientPath)});
			console.log(typeof db);
		`);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("object");
		expect(result.stderr).toBe("");
	}, 20_000);

	it("still rejects runtime database access without configuration", async () => {
		const result = await runIsolated(`
			const { db } = await import(${JSON.stringify(clientPath)});
			try {
				db.user;
				process.exitCode = 1;
			} catch (error) {
				console.log(error.message);
			}
		`);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("DATABASE_URL is not set");
	}, 20_000);

	it("binds client methods and reuses model delegates", async () => {
		const result = await runIsolated(
			`
			const { db } = await import(${JSON.stringify(clientPath)});
			console.log(db.user === db.user);
			const disconnect = db.$disconnect;
			await disconnect();
		`,
			"postgresql://test:test@127.0.0.1:1/disconnected_test",
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("true");
	}, 20_000);
});
