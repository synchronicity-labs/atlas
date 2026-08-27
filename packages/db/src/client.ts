import "@crm/env/load";

import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "./generated/prisma/client";

export interface PrismaLogRecord {
	level: Prisma.LogLevel;
	message: string;
	target: string;
	durationMs?: number;
}

export type PrismaLogSink = (record: PrismaLogRecord) => void;

const consoleSink: PrismaLogSink = ({ level, message, target, durationMs }) => {
	const suffix = durationMs === undefined ? "" : ` (+${durationMs}ms)`;
	const line = `[prisma:${level}] ${message}${suffix} [${target}]`;

	if (level === "error") {
		console.error(line);
	} else if (level === "warn") {
		console.warn(line);
	} else {
		console.log(line);
	}
};

let sink: PrismaLogSink = consoleSink;

export function setPrismaLogSink(next: PrismaLogSink | null): void {
	sink = next ?? consoleSink;
}

const logQueries = process.env.PRISMA_LOG_QUERIES === "true";

const logDefinitions: Prisma.LogDefinition[] = [
	{ level: "warn", emit: "event" },
	{ level: "error", emit: "event" },
	...(logQueries
		? ([
				{ level: "query", emit: "event" },
				{ level: "info", emit: "event" },
			] satisfies Prisma.LogDefinition[])
		: []),
];

const createPrismaClient = () => {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error(
			"DATABASE_URL is not set. Run with Doppler or configure the deployment environment before using the database.",
		);
	}
	const connectionUrl = new URL(connectionString);
	const sslMode = connectionUrl.searchParams.get("sslmode");
	if (sslMode && ["prefer", "require", "verify-ca"].includes(sslMode)) {
		connectionUrl.searchParams.set("sslmode", "verify-full");
	}
	const client = new PrismaClient({
		adapter: new PrismaPg({ connectionString: connectionUrl.toString() }),
		log: logDefinitions,
	});

	client.$on("error", ({ message, target }) => {
		sink({ level: "error", message, target });
	});
	client.$on("warn", ({ message, target }) => {
		sink({ level: "warn", message, target });
	});
	client.$on("info", ({ message, target }) => {
		sink({ level: "info", message, target });
	});
	client.$on("query", ({ query, duration, target }) => {
		sink({ level: "query", message: query, target, durationMs: duration });
	});

	return client;
};

const globalForPrisma = globalThis as unknown as {
	prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export type Db = ReturnType<typeof createPrismaClient>;

let client = globalForPrisma.prisma;

export const db = new Proxy({} as Db, {
	get(_target, property) {
		if (!client) {
			client = createPrismaClient();
			if (process.env.NODE_ENV !== "production") {
				globalForPrisma.prisma = client;
			}
		}
		const value = Reflect.get(client, property, client);
		return typeof value === "function" ? value.bind(client) : value;
	},
});
