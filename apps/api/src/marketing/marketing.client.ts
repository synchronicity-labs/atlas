import { createSign } from "node:crypto";
import type { GoogleServiceAccount, MarketingConfig } from "./marketing.config";
import type { MarketingQuery } from "./marketing.contracts";

export type MarketingResult = {
	columns: Array<{
		name: string;
		displayName: string | null;
		baseType: string | null;
	}>;
	rows: unknown[][];
};

type GoogleReport = {
	dimensionHeaders?: Array<{ name?: string }>;
	metricHeaders?: Array<{ name?: string; type?: string }>;
	rows?: Array<{
		dimensionValues?: Array<{ value?: string }>;
		metricValues?: Array<{ value?: string }>;
	}>;
};

type SearchReport = {
	rows?: Array<{
		keys?: string[];
		clicks?: number;
		impressions?: number;
		ctr?: number;
		position?: number;
	}>;
};

type PosthogReport = {
	columns?: string[];
	types?: Array<[string, string]>;
	results?: unknown[][];
	error?: string | null;
};

const PERCENT_METRICS = new Set(["engagementRate", "bounceRate"]);

function displayName(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replaceAll("_", " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function base64Url(value: string | Buffer): string {
	return Buffer.from(value)
		.toString("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

function isoDate(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function dates(preset: "6_months_and_mtd" | "30_days" | "90_days") {
	const end = new Date();
	const start = new Date(end);
	if (preset === "6_months_and_mtd") {
		start.setUTCDate(1);
		start.setUTCMonth(start.getUTCMonth() - 6);
	} else {
		start.setUTCDate(start.getUTCDate() - (preset === "30_days" ? 29 : 89));
	}
	return { startDate: isoDate(start), endDate: isoDate(end) };
}

function normalizeDimension(name: string, value: string): string {
	if (name === "yearMonth" && /^\d{6}$/.test(value)) {
		return `${value.slice(0, 4)}-${value.slice(4)}-01T00:00:00.000Z`;
	}
	if (name === "date" && /^\d{8}$/.test(value)) {
		return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}T00:00:00.000Z`;
	}
	return value;
}

function numericMetric(name: string, value: string | undefined): number {
	const parsed = Number(value ?? 0);
	if (!Number.isFinite(parsed)) return 0;
	return PERCENT_METRICS.has(name) ? parsed * 100 : parsed;
}

export class MarketingClient {
	private readonly googleTokens = new Map<
		string,
		{ value: string; expiresAt: number }
	>();

	constructor(private readonly config: MarketingConfig) {}

	async execute(query: MarketingQuery): Promise<MarketingResult> {
		if (query.source === "ga4") return this.ga4(query);
		if (query.source === "search_console") return this.searchConsole(query);
		return this.posthog(query.query);
	}

	private async ga4(
		query: Extract<MarketingQuery, { source: "ga4" }>,
	): Promise<MarketingResult> {
		const token = await this.accessToken([
			"https://www.googleapis.com/auth/analytics.readonly",
		]);
		const dateRanges = [dates(query.dateRange)];
		const reports = await Promise.all(
			query.properties.map(async (key) => {
				const property = this.config.ga4[key];
				if (!property?.id) throw new Error(`GA4 ${key} is not configured.`);
				const response = await fetch(
					`https://analyticsdata.googleapis.com/v1beta/properties/${property.id}:runReport`,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${token}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							dateRanges,
							dimensions: query.dimensions.map((name) => ({ name })),
							metrics: query.metrics.map((name) => ({ name })),
							limit: String(query.limit),
						}),
					},
				);
				const body = (await response.json()) as GoogleReport & {
					error?: unknown;
				};
				if (!response.ok) {
					throw new Error(
						`GA4 ${property.label} request failed (${response.status}).`,
					);
				}
				return {
					key,
					label: property.label,
					rows: (body.rows ?? []).map((row) => [
						...(row.dimensionValues ?? []).map((value, index) =>
							normalizeDimension(
								query.dimensions[index] ?? "dimension",
								value.value ?? "",
							),
						),
						...(row.metricValues ?? []).map((value, index) =>
							numericMetric(query.metrics[index] ?? "metric", value.value),
						),
					]),
				};
			}),
		);

		const dimensions = query.dimensions.map((name) => ({
			name: name === "yearMonth" ? "month" : name,
			displayName: displayName(name === "yearMonth" ? "month" : name),
			baseType: /^(date|month|yearMonth)$/.test(name)
				? "type/DateTime"
				: "type/Text",
		}));
		if (query.merge === "rows") {
			return {
				columns: [
					{ name: "site", displayName: "Site", baseType: "type/Text" },
					...dimensions,
					...query.metrics.map((name) => ({
						name,
						displayName: displayName(name),
						baseType: "type/Decimal",
					})),
				],
				rows: reports.flatMap((report) =>
					report.rows.map((row) => [report.label, ...row]),
				),
			};
		}
		if (query.merge === "series") {
			if (query.metrics.length !== 1) {
				throw new Error("GA4 series queries require exactly one metric.");
			}
			const keyed = new Map<string, unknown[]>();
			for (const report of reports) {
				for (const row of report.rows) {
					const dimensionValues = row.slice(0, query.dimensions.length);
					const key = JSON.stringify(dimensionValues);
					const current = keyed.get(key) ?? [
						...dimensionValues,
						...reports.map(() => 0),
					];
					current[query.dimensions.length + reports.indexOf(report)] =
						row[query.dimensions.length] ?? 0;
					keyed.set(key, current);
				}
			}
			return {
				columns: [
					...dimensions,
					...reports.map((report) => ({
						name: report.key,
						displayName: report.label,
						baseType: "type/Decimal",
					})),
				],
				rows: [...keyed.values()].sort((a, b) =>
					String(a[0] ?? "").localeCompare(String(b[0] ?? "")),
				),
			};
		}

		const keyed = new Map<string, unknown[]>();
		for (const report of reports) {
			for (const row of report.rows) {
				const dimensionValues = row.slice(0, query.dimensions.length);
				const key = JSON.stringify(dimensionValues);
				const current = keyed.get(key) ?? [
					...dimensionValues,
					...query.metrics.map(() => 0),
				];
				for (let index = 0; index < query.metrics.length; index += 1) {
					const target = query.dimensions.length + index;
					current[target] =
						Number(current[target] ?? 0) + Number(row[target] ?? 0);
				}
				keyed.set(key, current);
			}
		}
		return {
			columns: [
				...dimensions,
				...query.metrics.map((name) => ({
					name,
					displayName: displayName(name),
					baseType: "type/Decimal",
				})),
			],
			rows: [...keyed.values()].sort((a, b) =>
				String(a[0] ?? "").localeCompare(String(b[0] ?? "")),
			),
		};
	}

	private async searchConsole(
		query: Extract<MarketingQuery, { source: "search_console" }>,
	): Promise<MarketingResult> {
		const token = await this.accessToken([
			"https://www.googleapis.com/auth/webmasters.readonly",
		]);
		const site = this.config.searchConsole[query.site];
		if (!site)
			throw new Error(`Search Console ${query.site} is not configured.`);
		const response = await fetch(
			`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					...dates(query.dateRange),
					dimensions: query.dimensions,
					rowLimit: query.limit,
					dataState: "all",
				}),
			},
		);
		const body = (await response.json()) as SearchReport;
		if (!response.ok) {
			throw new Error(`Search Console request failed (${response.status}).`);
		}
		let rows = (body.rows ?? []).map((row) => [
			...(row.keys ?? []),
			Number(row.clicks ?? 0),
			Number(row.impressions ?? 0),
			Number(row.ctr ?? 0) * 100,
			Number(row.position ?? 0),
		]);
		let dimensions: string[] = [...query.dimensions];
		if (query.aggregate === "month") {
			if (dimensions[0] !== "date") {
				throw new Error("Monthly Search Console queries must start with date.");
			}
			const grouped = new Map<
				string,
				{ clicks: number; impressions: number; weightedPosition: number }
			>();
			for (const row of rows) {
				const month = `${String(row[0]).slice(0, 7)}-01T00:00:00.000Z`;
				const clicks = Number(row[dimensions.length] ?? 0);
				const impressions = Number(row[dimensions.length + 1] ?? 0);
				const position = Number(row[dimensions.length + 3] ?? 0);
				const current = grouped.get(month) ?? {
					clicks: 0,
					impressions: 0,
					weightedPosition: 0,
				};
				current.clicks += clicks;
				current.impressions += impressions;
				current.weightedPosition += position * impressions;
				grouped.set(month, current);
			}
			dimensions = ["month"];
			rows = [...grouped.entries()]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([month, value]) => [
					month,
					value.clicks,
					value.impressions,
					value.impressions > 0 ? (value.clicks / value.impressions) * 100 : 0,
					value.impressions > 0
						? value.weightedPosition / value.impressions
						: 0,
				]);
		}
		const allMetricColumns = [
			{ name: "clicks", displayName: "Clicks", baseType: "type/Integer" },
			{
				name: "impressions",
				displayName: "Impressions",
				baseType: "type/Integer",
			},
			{ name: "ctr_pct", displayName: "CTR", baseType: "type/Decimal" },
			{
				name: "position",
				displayName: "Average position",
				baseType: "type/Decimal",
			},
		];
		const metricIndexes = query.metrics.map((name) =>
			allMetricColumns.findIndex((column) => column.name === name),
		);
		return {
			columns: [
				...dimensions.map((name) => ({
					name,
					displayName: displayName(name),
					baseType: /^(date|month)$/.test(name) ? "type/DateTime" : "type/Text",
				})),
				...metricIndexes.flatMap((index) => {
					const column = allMetricColumns[index];
					return column ? [column] : [];
				}),
			],
			rows: rows.map((row) => [
				...row.slice(0, dimensions.length),
				...metricIndexes.map((index) => row[dimensions.length + index]),
			]),
		};
	}

	private async posthog(query: string): Promise<MarketingResult> {
		const config = this.config.posthog;
		if (!config) throw new Error("PostHog is not configured.");
		const response = await fetch(
			`${config.host}/api/projects/${config.projectId}/query/`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${config.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
			},
		);
		const body = (await response.json()) as PosthogReport;
		if (!response.ok || body.error) {
			throw new Error(`PostHog query failed (${response.status}).`);
		}
		const types = new Map(body.types ?? []);
		return {
			columns: (body.columns ?? []).map((name) => ({
				name,
				displayName: displayName(name),
				baseType: /Date|DateTime/i.test(types.get(name) ?? "")
					? "type/DateTime"
					: /Int|Float|Decimal/i.test(types.get(name) ?? "")
						? "type/Decimal"
						: "type/Text",
			})),
			rows: body.results ?? [],
		};
	}

	private async accessToken(scopes: string[]): Promise<string> {
		const scope = [...scopes].sort().join(" ");
		const cached = this.googleTokens.get(scope);
		if (cached && cached.expiresAt > Date.now() + 60_000) {
			return cached.value;
		}
		const credential = this.config.google;
		if (!credential) throw new Error("Google reporting is not configured.");
		const now = Math.floor(Date.now() / 1000);
		const assertion = this.jwt(credential, scopes, now);
		const response = await fetch(
			credential.token_uri ?? "https://oauth2.googleapis.com/token",
			{
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
					assertion,
				}),
			},
		);
		const body = (await response.json()) as {
			access_token?: string;
			expires_in?: number;
		};
		if (!response.ok || !body.access_token) {
			throw new Error(`Google authorization failed (${response.status}).`);
		}
		const token = {
			value: body.access_token,
			expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
		};
		this.googleTokens.set(scope, token);
		return token.value;
	}

	private jwt(
		credential: GoogleServiceAccount,
		scopes: string[],
		now: number,
	): string {
		const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
		const payload = base64Url(
			JSON.stringify({
				iss: credential.client_email,
				scope: scopes.join(" "),
				aud: credential.token_uri ?? "https://oauth2.googleapis.com/token",
				iat: now,
				exp: now + 3600,
			}),
		);
		const unsigned = `${header}.${payload}`;
		const signature = createSign("RSA-SHA256")
			.update(unsigned)
			.end()
			.sign(credential.private_key);
		return `${unsigned}.${base64Url(signature)}`;
	}
}
