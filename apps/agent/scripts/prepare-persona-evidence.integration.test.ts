import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { csvText, parseCsv } from "../agent/lib/persona-evidence";

const script = new URL("./prepare-persona-evidence.ts", import.meta.url)
	.pathname;
const firstOrg = "00000000-0000-0000-0000-000000000001";
const secondOrg = "00000000-0000-0000-0000-000000000002";

async function fixture(mode: "empty" | "failed" | "capped") {
	const dir = await mkdtemp(join(tmpdir(), "atlas-persona-test-"));
	const inputFiles = [
		[
			"companies.csv",
			"email_domain,orgs,total_lifetime_rev\nexample.com,1,100\n",
		],
		[
			"people.csv",
			"org_id,email,lifetime_rev,first_paid\ncus_One,person@example.com,100,2026-01\n",
		],
		[
			"labels.csv",
			"org_id,email_domain,lifetime_rev,first_paid,persona_label\ncus_One,example.com,100,2026-01,\n",
		],
	] as const;
	for (const [name, content] of inputFiles)
		await writeFile(join(dir, name), content);
	let requests = 0;
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			requests++;
			const body = await request.json();
			const sql = body.native.query as string;
			let rows: Record<string, string>[] = [];
			if (
				sql.includes("sync_stripe_invoices") &&
				sql.includes("mapping_key > ''")
			) {
				rows = [
					{
						email_domain: "example.com",
						stripe_customer_id: "cus_One",
						last_invoice_created_at: "2026-01-01",
						invoice_count: "1",
						mapping_key: "example.com/cus_One",
					},
				];
			} else if (sql.includes("from public.organizations")) {
				rows = [firstOrg, secondOrg].map((id) => ({
					stripe_customer_id: "cus_One",
					product_organization_id: id,
					member_count: "2",
				}));
			} else if (sql.includes("from public.generations")) {
				if (mode === "failed")
					return Response.json(
						{ status: "failed", error: "Fixture source unavailable" },
						{ status: 400 },
					);
				if (mode === "capped")
					return Response.json({
						status: "completed",
						data: { cols: [], rows: [], rows_truncated: true },
					});
			}
			const columns = Object.keys(rows[0] ?? {});
			return Response.json({
				status: "completed",
				data: {
					cols: columns.map((name) => ({ name })),
					rows: rows.map((row) => columns.map((name) => row[name])),
				},
			});
		},
	});
	const run = async (extra: string[] = []) => {
		const process = Bun.spawn(
			[
				Bun.which("bun") ?? "bun",
				script,
				"--companies",
				join(dir, "companies.csv"),
				"--people",
				join(dir, "people.csv"),
				"--labels",
				join(dir, "labels.csv"),
				"--out",
				join(dir, "out"),
				"--start",
				"2026-07-01T00:00:00Z",
				"--end",
				"2026-08-01T00:00:00Z",
				"--fetch",
				...extra,
			],
			{
				env: {
					...Bun.env,
					METABASE_BASE_URL: `http://127.0.0.1:${server.port}`,
					METABASE_API_KEY: "fixture-not-a-secret",
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [code, stdout, stderr] = await Promise.all([
			process.exited,
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
		]);
		return { code, stdout, stderr };
	};
	return {
		dir,
		run,
		requestCount: () => requests,
		rows: async (name: string) =>
			parseCsv(await readFile(join(dir, "out", name), "utf8")),
		manifest: async () =>
			JSON.parse(await readFile(join(dir, "out", "manifest.json"), "utf8")),
		cleanup: async () => {
			server.stop(true);
			await rm(dir, { recursive: true, force: true });
		},
	};
}

describe("persona preparation CLI", () => {
	test("preserves one-to-many mappings and records true empty observations", async () => {
		const f = await fixture("empty");
		try {
			const result = await f.run();
			expect(result.code).toBe(0);
			const bridge = await f.rows("account_product_bridge.csv");
			expect(bridge.filter((row) => row.input_kind === "person")).toHaveLength(
				2,
			);
			expect(
				bridge.every((row) => row.mapping_status === "multiple_product_orgs"),
			).toBe(true);
			const evidence = await f.rows("organization_evidence.csv");
			expect(evidence).toHaveLength(2);
			expect(
				evidence.every(
					(row) =>
						row.completed_generations === "0" &&
						row.generation_lookup_status === "completed",
				),
			).toBe(true);
			expect((await f.rows("human_labels.csv"))[0]?.persona_label).toBe("");
			expect((await f.manifest()).status).toBe("completed");
		} finally {
			await f.cleanup();
		}
	});
	for (const mode of ["failed", "capped"] as const) {
		test(`${mode} generation requests remain unknown, never zero`, async () => {
			const f = await fixture(mode);
			try {
				expect((await f.run()).code).toBe(2);
				const evidence = await f.rows("organization_evidence.csv");
				expect(
					evidence.every(
						(row) =>
							row.completed_generations === "" &&
							row.generated_hours === "" &&
							row.generation_lookup_status === "not_checked",
					),
				).toBe(true);
				const manifest = await f.manifest();
				expect(manifest.status).toBe("partial");
				expect(manifest.summary.sourceFailures).toBe(1);
			} finally {
				await f.cleanup();
			}
		});
	}
	test("resumes exact queries but refuses a changed input", async () => {
		const f = await fixture("empty");
		try {
			expect((await f.run()).code).toBe(0);
			const count = f.requestCount();
			expect((await f.run(["--resume"])).code).toBe(0);
			expect(f.requestCount()).toBe(count);
			expect(
				(await f.manifest()).attempts.every(
					(attempt: { cached: boolean }) => attempt.cached,
				),
			).toBe(true);
			await writeFile(
				join(f.dir, "companies.csv"),
				"email_domain,orgs,total_lifetime_rev\nother.com,1,100\n",
			);
			const changed = await f.run(["--resume"]);
			expect(changed.code).not.toBe(0);
			expect(changed.stderr).toContain("same input files and UTC window");
			expect(f.requestCount()).toBe(count);
		} finally {
			await f.cleanup();
		}
	});
	test("preserves human review on resume and rejects changes to source keys", async () => {
		const f = await fixture("empty");
		try {
			expect((await f.run()).code).toBe(0);
			const reviewed = await f.rows("human_labels.csv");
			const first = reviewed[0];
			if (!first) throw new Error("Missing fixture label row");
			first.persona_label = "agency";
			first.reviewed_by = "Fixture reviewer";
			first.evidence_url = "https://example.com/about";
			first.review_notes = "Confirmed by customer owner";
			const reviewedText = csvText(reviewed, Object.keys(first));
			const path = join(f.dir, "out", "human_labels.csv");
			await writeFile(path, reviewedText);
			const count = f.requestCount();
			expect((await f.run(["--resume"])).code).toBe(0);
			expect(await readFile(path, "utf8")).toBe(reviewedText);
			expect((await f.manifest()).summary.completedHumanLabels).toBe(1);
			expect(f.requestCount()).toBe(count);
			const context = await f.rows("account_review_context.csv");
			expect(context).toHaveLength(1);
			expect(context[0]?.product_organization_ids).toContain(firstOrg);
			expect(context[0]?.product_organization_ids).toContain(secondOrg);
			expect(context[0]).not.toHaveProperty("persona_label");
			expect((await stat(path)).mode & 0o777).toBe(0o600);
			first.stripe_customer_id = "cus_Changed";
			const changedText = csvText(reviewed, Object.keys(first));
			await writeFile(path, changedText);
			const changed = await f.run(["--resume"]);
			expect(changed.code).not.toBe(0);
			expect(changed.stderr).toContain(
				"Human review keys or source columns changed",
			);
			expect(await readFile(path, "utf8")).toBe(changedText);
			expect(f.requestCount()).toBe(count);
		} finally {
			await f.cleanup();
		}
	});
});

describe("persona enrichment join CLI", () => {
	test("preserves account links without approving results or overwriting files", async () => {
		const dir = await mkdtemp(join(tmpdir(), "atlas-persona-join-test-"));
		try {
			const bridge = join(dir, "bridge.csv");
			const results = join(dir, "results.csv");
			const out = join(dir, "joined.csv");
			await writeFile(
				bridge,
				"email_domain,orgs,enrichment_key\nExample.com,2,example.com\nexample.com,1,example.com\nmissing.com,1,missing.com\n",
			);
			await writeFile(
				results,
				"enrichment_key,email_domain,company_name,industry\nexample.com,example.com,Fixture Company,Technology\n",
			);
			const run = async () => {
				const process = Bun.spawn(
					[
						Bun.which("bun") ?? "bun",
						new URL("./join-persona-enrichment.ts", import.meta.url).pathname,
						"--kind",
						"company",
						"--bridge",
						bridge,
						"--results",
						results,
						"--out",
						out,
					],
					{ stdout: "pipe", stderr: "pipe" },
				);
				const [code, stdout, stderr] = await Promise.all([
					process.exited,
					new Response(process.stdout).text(),
					new Response(process.stderr).text(),
				]);
				return { code, stdout, stderr };
			};
			const result = await run();
			expect(result.code).toBe(0);
			const content = await readFile(out, "utf8");
			const rows = parseCsv(content);
			expect(rows).toHaveLength(3);
			expect(rows.map((row) => row.email_domain)).toEqual([
				"Example.com",
				"example.com",
				"missing.com",
			]);
			expect(rows.map((row) => row.clay_review_status)).toEqual([
				"unreviewed",
				"unreviewed",
				"not_returned",
			]);
			expect(rows[0]?.clay_field_company_name).toBe("Fixture Company");
			expect(JSON.parse(result.stdout).rowsWithResult).toBe(2);
			expect((await stat(out)).mode & 0o777).toBe(0o600);
			expect((await run()).code).not.toBe(0);
			expect(await readFile(out, "utf8")).toBe(content);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("prior company enrichment CLI", () => {
	test("reuses fields independently and emits a minimal Clay input", async () => {
		const dir = await mkdtemp(join(tmpdir(), "atlas-company-reuse-test-"));
		try {
			const companies = join(dir, "companies.csv");
			const prior = join(dir, "prior.csv");
			const out = join(dir, "out");
			await writeFile(
				companies,
				"email_domain,enrichment_key\nexample.com,example.com\nmissing.com,missing.com\n",
			);
			await writeFile(
				prior,
				"email_domain,company_name,employee_count,industry,prior_source_generated_at,prior_source_url\nexample.com,Fixture Company,42,,2026-06-05T12:42:00Z,https://docs.google.com/spreadsheets/d/fixture\n",
			);
			const process = Bun.spawn(
				[
					Bun.which("bun") ?? "bun",
					new URL("./prepare-prior-company-enrichment.ts", import.meta.url)
						.pathname,
					"--companies",
					companies,
					"--prior",
					prior,
					"--out",
					out,
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const [code, stdout] = await Promise.all([
				process.exited,
				new Response(process.stdout).text(),
			]);
			expect(code).toBe(0);
			expect(JSON.parse(stdout).needsClayByField).toEqual({
				company_name: 1,
				employee_count: 1,
				industry: 2,
				company_type: 2,
			});
			const input = parseCsv(
				await readFile(join(out, "clay_company_enrichment_input.csv"), "utf8"),
			);
			expect(input).toHaveLength(2);
			expect(input[0]?.company_name).toBe("Fixture Company");
			expect(input[0]?.need_company_name).toBe("false");
			expect(input[0]?.need_industry).toBe("true");
			expect(input[0]).not.toHaveProperty("prior_source_url");
			expect(input[0]).not.toHaveProperty("total_lifetime_rev");
			expect(
				(await stat(join(out, "clay_company_enrichment_input.csv"))).mode &
					0o777,
			).toBe(0o600);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
