import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@crm/db";
import { AtlasQueryService } from "../src/atlas-query/atlas-query.service";
import { QuestionsService } from "../src/questions/questions.service";
import { RudyService } from "../src/rudy/rudy.service";

const databaseUrl = process.env.DATABASE_URL;
const localDatabase =
	databaseUrl &&
	["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname);

describe.skipIf(!localDatabase)("private QBR preparation storage", () => {
	it("migrates private history and removes it from versions and proposals", async () => {
		const schema = `"qbr_${randomUUID().replaceAll("-", "")}"`;
		const migration = await Bun.file(
			new URL(
				"../../../packages/db/prisma/migrations/20261002140000_separate_qbr_preparations/migration.sql",
				import.meta.url,
			),
		).text();
		await db.$transaction(async (tx) => {
			await tx.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
			await tx.$executeRawUnsafe(
				`CREATE TABLE ${schema}."question" (id TEXT PRIMARY KEY)`,
			);
			await tx.$executeRawUnsafe(
				`CREATE TABLE ${schema}."questionVersion" ("questionId" TEXT, version INTEGER, visualization JSONB, "createdAt" TIMESTAMP(3))`,
			);
			await tx.$executeRawUnsafe(
				`CREATE TABLE ${schema}."questionChangeProposal" (visualization JSONB)`,
			);
			await tx.$executeRawUnsafe(
				`INSERT INTO ${schema}."question" VALUES ('fixture')`,
			);
			for (const version of [1, 3]) {
				await tx.$executeRawUnsafe(
					`INSERT INTO ${schema}."questionVersion" VALUES ('fixture', $1, $2::jsonb, '2026-10-01')`,
					version,
					JSON.stringify({
						color: "blue",
						qbr: {
							definitionHash: "unchanged",
							preparation: { gap: `private-${version}` },
						},
					}),
				);
			}
			await tx.$executeRawUnsafe(
				`INSERT INTO ${schema}."questionChangeProposal" SELECT visualization FROM ${schema}."questionVersion"`,
			);
			for (const statement of migration
				.replaceAll('"public"', schema)
				.split(";")) {
				if (!statement.trim() || ["BEGIN", "COMMIT"].includes(statement.trim()))
					continue;
				await tx.$executeRawUnsafe(statement);
			}
			const history = await tx.$queryRawUnsafe<
				Array<{
					version: number;
					quarter: string;
					preparation: unknown;
					createdAt: Date;
				}>
			>(`SELECT * FROM ${schema}."qbrPreparation" ORDER BY version`);
			expect(
				history.map(({ version, quarter, preparation, createdAt }) => ({
					version,
					quarter,
					preparation,
					createdAt: createdAt.toISOString(),
				})),
			).toEqual(
				[1, 3].map((version) => ({
					version,
					quarter: "2026-Q3",
					preparation: { gap: `private-${version}` },
					createdAt: "2026-10-01T00:00:00.000Z",
				})),
			);
			for (const table of ["questionVersion", "questionChangeProposal"]) {
				const rows = await tx.$queryRawUnsafe<
					Array<{ visualization: unknown }>
				>(`SELECT visualization FROM ${schema}."${table}"`);
				expect(rows).toEqual(
					[1, 3].map(() => ({
						visualization: {
							color: "blue",
							qbr: { definitionHash: "unchanged" },
						},
					})),
				);
			}
			await tx.$executeRawUnsafe(`DROP SCHEMA ${schema} CASCADE`);
		});
	});

	it("keeps private revisions out of signed-in, internal, and Rudy question reads", async () => {
		const id = randomUUID();
		const question = await db.question.create({
			data: {
				id,
				number: -Math.floor(Math.random() * 1_000_000_000) - 1,
				name: "Private QBR regression",
				connector: "ATLAS",
				versions: {
					create: [1, 2].map((version) => ({
						version,
						queryLanguage: "SQL" as const,
						queryText: "SELECT 1",
						display: "table",
						visualization: { color: "blue" },
						createdBy: "test",
					})),
				},
				qbrPreparations: {
					create: [1, 2].map((version) => ({
						quarter: "2026-Q3",
						version,
						preparation: {
							gap: `private-${version}`,
							sources: [{ url: "https://example.com/private-source" }],
						},
					})),
				},
			},
		});
		try {
			const unused = undefined as never;
			const questions = new QuestionsService(
				db,
				unused,
				unused,
				unused,
				unused,
				unused,
				unused,
				unused,
				unused,
			);
			const signedIn = await questions.byNumber(question.publicNumber);
			const internal = await new AtlasQueryService(db).question(
				question.publicNumber,
				{},
			);
			const rudyService = new RudyService(db, unused);
			const rudy = await Reflect.get(rudyService, "readContext").call(
				rudyService,
				{
					kind: "question",
					id: String(question.publicNumber),
				},
			);
			expect(signedIn.versions).toHaveLength(2);
			expect(internal.definition?.visualization).toEqual({ color: "blue" });
			for (const result of [signedIn, internal, rudy]) {
				expect(JSON.stringify(result)).not.toContain("private-1");
				expect(JSON.stringify(result)).not.toContain("private-2");
				expect(JSON.stringify(result)).not.toContain("private-source");
				expect(JSON.stringify(result)).not.toContain("qbrPreparations");
			}
			expect(await db.qbrPreparation.count({ where: { questionId: id } })).toBe(
				2,
			);
		} finally {
			await db.question.delete({ where: { id } });
		}
	});
});
