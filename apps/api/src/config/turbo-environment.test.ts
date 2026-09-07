import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("Turbo passes the dedicated Modal credential to API tasks without hashing it", () => {
	const config = JSON.parse(
		readFileSync(new URL("../../../../turbo.json", import.meta.url), "utf8"),
	);
	expect(config.globalPassThroughEnv).toContain("ATLAS_MODAL_INGEST_SECRET");
	expect(config.globalEnv).not.toContain("ATLAS_MODAL_INGEST_SECRET");
});
