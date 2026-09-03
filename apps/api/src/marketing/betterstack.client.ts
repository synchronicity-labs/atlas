type BetterStackConfig = {
	telemetryApiKey: string;
	sqlEuHost: string;
	sqlEuRegion: string;
	sqlEuUser: string;
	sqlEuPass: string;
};

export type BetterStackSource = {
	id: string;
	name: string;
	dataRegion: string;
	tableName: string;
	teamId: string;
};

type SourceResponse = {
	data?: Array<{
		id?: unknown;
		attributes?: Record<string, unknown>;
	}>;
	pagination?: { next?: unknown };
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_SQL_BYTES = 50_000;

export function betterStackConfig(): BetterStackConfig | null {
	const telemetryApiKey = env("BETTERSTACK_TELEMETRY_API_KEY");
	const sqlEuHost = env("BETTERSTACK_SQL_EU_HOST");
	const sqlEuRegion = betterStackConnectionRegion(sqlEuHost);
	const sqlEuUser = env("BETTERSTACK_SQL_EU_USER");
	const sqlEuPass = env("BETTERSTACK_SQL_EU_PASS");
	return telemetryApiKey && sqlEuHost && sqlEuRegion && sqlEuUser && sqlEuPass
		? { telemetryApiKey, sqlEuHost, sqlEuRegion, sqlEuUser, sqlEuPass }
		: null;
}

export class BetterStackClient {
	constructor(private readonly config: BetterStackConfig) {}

	async source(exactName: string): Promise<BetterStackSource> {
		let page = 1;
		while (page <= 20) {
			const url = new URL("https://telemetry.betterstack.com/api/v1/sources");
			url.searchParams.set("page", String(page));
			url.searchParams.set("per_page", "50");
			const response = await this.request(url, {
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${this.config.telemetryApiKey}`,
				},
			});
			const payload = (await response.json()) as SourceResponse;
			for (const item of payload.data ?? []) {
				const attributes = item.attributes ?? {};
				if (text(attributes.name) !== exactName) continue;
				const source = {
					id: text(item.id),
					name: text(attributes.name),
					dataRegion: text(attributes.data_region),
					tableName: text(attributes.table_name),
					teamId: text(attributes.team_id),
				};
				if (
					!source.id ||
					source.dataRegion !== this.config.sqlEuRegion ||
					!/^[a-zA-Z0-9_]+$/.test(source.tableName) ||
					!/^\d+$/.test(source.teamId)
				) {
					throw new Error(
						"BetterStack source metadata is incomplete or unsafe.",
					);
				}
				return source;
			}
			if (!payload.pagination?.next) break;
			page += 1;
		}
		throw new Error(`BetterStack source ${exactName} was not found.`);
	}

	async sql(source: BetterStackSource, query: string) {
		assertReadOnlySql(query);
		if (source.dataRegion !== this.config.sqlEuRegion) {
			throw new Error(
				"BetterStack source does not match the configured SQL region.",
			);
		}
		const authorization = Buffer.from(
			`${this.config.sqlEuUser}:${this.config.sqlEuPass}`,
		).toString("base64");
		const response = await this.request(
			new URL(`https://${this.config.sqlEuHost}/`),
			{
				method: "POST",
				headers: {
					Authorization: `Basic ${authorization}`,
					"Content-Type": "text/plain",
				},
				body: `${query.trim().replace(/;$/, "")}\nFORMAT JSONEachRow`,
			},
		);
		const body = await response.text();
		if (!body.trim()) return [];
		return body
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	}

	private async request(url: URL, init: RequestInit) {
		for (let attempt = 1; attempt <= 4; attempt += 1) {
			const response = await fetch(url, {
				...init,
				signal: AbortSignal.timeout(60_000),
			});
			if (response.ok) return response;
			const detail = (await response.text()).slice(0, 500);
			if (attempt === 4 || !RETRYABLE_STATUS.has(response.status)) {
				throw new Error(
					`BetterStack request failed with HTTP ${response.status}: ${detail}`,
				);
			}
			await Bun.sleep(250 * 2 ** (attempt - 1));
		}
		throw new Error("BetterStack request failed after retries.");
	}
}

export function betterStackConnectionRegion(host: string): string {
	const match = /^([a-z0-9-]+)-connect\.betterstackdata\.com$/.exec(host);
	return match?.[1] ?? "";
}

function assertReadOnlySql(query: string) {
	if (
		!query ||
		Buffer.byteLength(query) > MAX_SQL_BYTES ||
		query.includes("\0")
	) {
		throw new Error("BetterStack SQL is empty or too large.");
	}
	const masked = query
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/--[^\n]*/g, " ")
		.replace(/'(?:''|[^'])*'/g, " ")
		.trim()
		.replace(/;$/, "");
	if (!/^(select|with)\b/i.test(masked) || masked.includes(";")) {
		throw new Error("BetterStack only allows one read-only query.");
	}
	if (
		/\b(alter|attach|call|copy|create|delete|detach|drop|execute|grant|insert|merge|refresh|rename|replace|revoke|truncate|update|vacuum)\b/i.test(
			masked,
		)
	) {
		throw new Error("BetterStack SQL contains a mutation token.");
	}
}

function env(name: string) {
	return process.env[name]?.trim() ?? "";
}

function text(value: unknown) {
	return typeof value === "string" || typeof value === "number"
		? String(value).trim()
		: "";
}
