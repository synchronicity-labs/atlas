import "@crm/env/load";

import path from "node:path";
import { defineConfig, env } from "prisma/config";

const migrationDatabaseUrl =
	process.env.DIRECT_DATABASE_URL ||
	process.env.POSTGRES_URL_NON_POOLING ||
	process.env.DATABASE_URL_UNPOOLED ||
	env("DATABASE_URL");

export default defineConfig({
	schema: path.join("prisma", "schema.prisma"),
	migrations: {
		path: path.join("prisma", "migrations"),
		seed: "bun run prisma/seed.ts",
	},
	datasource: {
		url: migrationDatabaseUrl,
	},
});
