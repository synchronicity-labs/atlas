import { randomUUID } from "node:crypto";
import { assertReadOnlyQuery } from "../questions/read-only-query";
import type { MetabaseConfig } from "./metabase.config";

type MetabaseColumn = {
	id?: unknown;
	name?: unknown;
	display_name?: unknown;
	base_type?: unknown;
};

type MetabaseTableMetadata = {
	fields?: MetabaseColumn[];
};

type DatasetResponse = {
	status?: string;
	error?: string;
	error_type?: string;
	data?: {
		cols?: MetabaseColumn[];
		rows?: unknown[][];
	};
};

export type MetabaseCardResponse = {
	id: number;
	name: string;
	description?: string | null;
	display?: string;
	database_id?: number;
	query_type?: string | null;
	dataset_query?: unknown;
	result_metadata?: MetabaseColumn[];
	visualization_settings?: unknown;
};

export type MetabaseDashboardResponse = {
	id: number;
	name: string;
	description?: string | null;
	tabs?: Array<{ id: number; name: string; position?: number }>;
	dashcards?: Array<{
		id: number;
		dashboard_tab_id?: number;
		row?: number;
		col?: number;
		size_x?: number;
		size_y?: number;
		visualization_settings?: unknown;
		card?: MetabaseCardResponse | null;
	}>;
};

export type MetabaseResult = {
	columns: Array<{
		name: string;
		displayName: string | null;
		baseType: string | null;
	}>;
	rows: unknown[][];
};

export type MetabaseUserPage = MetabaseResult & {
	full: boolean;
};

export type MetabasePreviewInput = {
	language: "SQL" | "MBQL";
	queryText: string;
	databaseExternalId: string | null;
};

const PREVIEW_TIMEOUT_MS = 75_000;

function freshFieldReference(value: unknown): unknown {
	const field = structuredClone(value) as [
		unknown,
		Record<string, unknown>,
		unknown,
	];
	field[1] = { ...field[1], "lib/uuid": randomUUID() };
	return field;
}

export class MetabaseClient {
	constructor(private readonly config: MetabaseConfig) {}

	async dashboard(): Promise<MetabaseDashboardResponse> {
		return this.request(`/api/dashboard/${this.config.dashboardId}`);
	}

	async card(id: number): Promise<MetabaseCardResponse> {
		return this.request(`/api/card/${id}`);
	}

	async cardResult(id: number): Promise<MetabaseResult> {
		const raw = await this.request<DatasetResponse>(`/api/card/${id}/query`, {
			method: "POST",
			body: JSON.stringify({ parameters: [] }),
		});

		return this.result(raw);
	}

	async dashboardCardResult(
		dashcardId: number,
		cardId: number,
		period: string,
	): Promise<MetabaseResult> {
		const raw = await this.request<DatasetResponse>(
			`/api/dashboard/${this.config.dashboardId}/dashcard/${dashcardId}/card/${cardId}/query`,
			{
				method: "POST",
				body: JSON.stringify({ parameters: [], period }),
			},
		);

		return this.result(raw);
	}

	async userPage(
		card: MetabaseCardResponse,
		cursor: string | null,
		limit: number,
	): Promise<MetabaseUserPage> {
		const datasetQuery = structuredClone(card.dataset_query) as {
			stages?: Array<Record<string, unknown>>;
			[key: string]: unknown;
		};
		const stage = datasetQuery.stages?.[0];
		const fields = stage?.fields;

		if (!stage || !Array.isArray(fields) || fields.length === 0) {
			throw new Error("The configured Metabase user question has no fields.");
		}
		const sourceTable = stage["source-table"];
		const database = Number(datasetQuery.database ?? card.database_id);
		if (
			typeof sourceTable === "number" &&
			Number.isSafeInteger(sourceTable) &&
			Number.isSafeInteger(database)
		) {
			const metadata = await this.request<MetabaseTableMetadata>(
				`/api/table/${sourceTable}/query_metadata`,
			);
			const existingIds = new Set(
				fields.flatMap((entry) =>
					Array.isArray(entry) && typeof entry[2] === "number"
						? [entry[2]]
						: [],
				),
			);
			for (const metadataField of metadata.fields ?? []) {
				if (
					typeof metadataField.id !== "number" ||
					typeof metadataField.name !== "string" ||
					!["disabled", "banned", "is_anonymous"].includes(
						metadataField.name,
					) ||
					existingIds.has(metadataField.id)
				) {
					continue;
				}
				fields.push([
					"field",
					{
						"base-type": metadataField.base_type,
						"effective-type": metadataField.base_type,
						"lib/uuid": randomUUID(),
					},
					metadataField.id,
				]);
			}
		}

		delete stage.filters;
		stage.limit = limit;
		stage["order-by"] = [
			["asc", { "lib/uuid": randomUUID() }, freshFieldReference(fields[0])],
		];

		if (cursor) {
			stage.filters = [
				[
					">",
					{ "lib/uuid": randomUUID() },
					freshFieldReference(fields[0]),
					cursor,
				],
			];
		}

		const raw = await this.request<DatasetResponse>("/api/dataset", {
			method: "POST",
			body: JSON.stringify({ ...datasetQuery, parameters: [] }),
			signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
		});
		const result = this.result(raw);

		return { ...result, full: result.rows.length === limit };
	}

	async userDetail(
		card: MetabaseCardResponse,
		externalId: string,
	): Promise<Record<string, unknown> | null> {
		const template = card.dataset_query as {
			database?: unknown;
			stages?: Array<Record<string, unknown>>;
		};
		const sourceTable = template.stages?.[0]?.["source-table"];
		const database = Number(template.database ?? card.database_id);
		if (!Number.isSafeInteger(sourceTable) || !Number.isSafeInteger(database)) {
			throw new Error(
				"The configured Metabase user question has no source table.",
			);
		}

		const metadata = await this.request<MetabaseTableMetadata>(
			`/api/table/${sourceTable}/query_metadata`,
		);
		const safeNames = new Set([
			"id",
			"email",
			"display_name",
			"created_at",
			"updated_at",
			"last_seen",
			"disabled",
			"banned",
			"is_anonymous",
			"avatar_url",
			"locale",
			"phone_number",
			"email_verified",
		]);
		const fields = (metadata.fields ?? []).filter(
			(field) =>
				typeof field.id === "number" &&
				typeof field.name === "string" &&
				safeNames.has(field.name),
		);
		const idField = fields.find((field) => field.name === "id");
		if (!idField || typeof idField.id !== "number") {
			throw new Error("The Metabase user table has no safe id field.");
		}
		const field = (metadataField: MetabaseColumn) => [
			"field",
			{
				"base-type": metadataField.base_type,
				"effective-type": metadataField.base_type,
				"lib/uuid": randomUUID(),
			},
			metadataField.id,
		];
		const raw = await this.request<DatasetResponse>("/api/dataset", {
			method: "POST",
			body: JSON.stringify({
				"lib/type": "mbql/query",
				database,
				stages: [
					{
						"lib/type": "mbql.stage/mbql",
						"source-table": sourceTable,
						fields: fields.map(field),
						filters: [
							["=", { "lib/uuid": randomUUID() }, field(idField), externalId],
						],
						limit: 1,
					},
				],
				parameters: [],
			}),
		});
		const result = this.result(raw);
		const row = result.rows[0];
		if (!row) return null;
		return Object.fromEntries(
			result.columns.map((column, index) => [column.name, row[index] ?? null]),
		);
	}

	async usersByEmail(
		card: MetabaseCardResponse,
		term: string,
	): Promise<MetabaseResult> {
		const template = card.dataset_query as {
			database?: unknown;
			stages?: Array<Record<string, unknown>>;
		};
		const sourceTable = template.stages?.[0]?.["source-table"];
		const database = Number(template.database ?? card.database_id);
		if (!Number.isSafeInteger(sourceTable) || !Number.isSafeInteger(database)) {
			throw new Error(
				"The configured Metabase user question has no source table.",
			);
		}

		const metadata = await this.request<MetabaseTableMetadata>(
			`/api/table/${sourceTable}/query_metadata`,
		);
		const safeNames = new Set([
			"id",
			"email",
			"display_name",
			"role",
			"disabled",
			"banned",
			"is_anonymous",
		]);
		const fields = (metadata.fields ?? []).filter(
			(field) =>
				typeof field.id === "number" &&
				typeof field.name === "string" &&
				safeNames.has(field.name),
		);
		const emailField = fields.find((field) => field.name === "email");
		if (!emailField || typeof emailField.id !== "number") {
			throw new Error("The Metabase user table has no safe email field.");
		}
		const field = (metadataField: MetabaseColumn) => [
			"field",
			{
				"base-type": metadataField.base_type,
				"effective-type": metadataField.base_type,
				"lib/uuid": randomUUID(),
			},
			metadataField.id,
		];
		const normalized = term.trim().toLowerCase();
		const operator = normalized.includes("@") ? "contains" : "ends-with";
		const match = normalized.includes("@") ? normalized : `@${normalized}`;
		const raw = await this.request<DatasetResponse>("/api/dataset", {
			method: "POST",
			body: JSON.stringify({
				"lib/type": "mbql/query",
				database,
				stages: [
					{
						"lib/type": "mbql.stage/mbql",
						"source-table": sourceTable,
						fields: fields.map(field),
						filters: [
							[
								operator,
								{ "case-sensitive": false, "lib/uuid": randomUUID() },
								field(emailField),
								match,
							],
						],
						limit: 500,
					},
				],
				parameters: [],
			}),
		});
		return this.result(raw);
	}

	async preparePreview(
		input: MetabasePreviewInput,
	): Promise<MetabasePreviewInput> {
		if (input.language !== "MBQL" || input.databaseExternalId !== "34") {
			return input;
		}
		const datasetQuery = JSON.parse(input.queryText) as unknown;
		if (
			!datasetQuery ||
			typeof datasetQuery !== "object" ||
			Array.isArray(datasetQuery)
		) {
			throw new Error("The MBQL query must be a JSON object.");
		}
		if (
			(datasetQuery as Record<string, unknown>).database !==
			Number(input.databaseExternalId)
		) {
			throw new Error("The MBQL database does not match this question.");
		}
		const parameters = (datasetQuery as Record<string, unknown>).parameters;
		if (
			parameters != null &&
			(!Array.isArray(parameters) || parameters.length > 0)
		) {
			throw new Error(
				"Atlas cannot compile this visual query with bound parameters yet.",
			);
		}
		const native = await this.request<{ query?: unknown; params?: unknown }>(
			"/api/dataset/native",
			{
				method: "POST",
				body: JSON.stringify({ ...datasetQuery, parameters: [] }),
				signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
			},
		);
		if (
			native.params != null &&
			(!Array.isArray(native.params) || native.params.length > 0)
		) {
			throw new Error(
				"Atlas cannot apply its user filter to a compiled query with bound parameters yet.",
			);
		}
		if (typeof native.query !== "string" || !native.query.trim()) {
			throw new Error("Metabase did not return SQL for this visual query.");
		}
		assertReadOnlyQuery("SQL", native.query);
		return { ...input, language: "SQL", queryText: native.query };
	}

	async preview(input: MetabasePreviewInput): Promise<MetabaseResult> {
		let datasetQuery: Record<string, unknown>;

		if (input.language === "SQL") {
			const database = Number(input.databaseExternalId);
			if (!Number.isSafeInteger(database) || database <= 0) {
				throw new Error("This question has no Metabase database connection.");
			}
			datasetQuery = {
				database,
				type: "native",
				native: { query: input.queryText },
			};
		} else {
			const parsed = JSON.parse(input.queryText) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("The MBQL query must be a JSON object.");
			}
			datasetQuery = parsed as Record<string, unknown>;
		}

		const raw = await this.request<DatasetResponse>("/api/dataset", {
			method: "POST",
			body: JSON.stringify({ ...datasetQuery, parameters: [] }),
			signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
		});
		return this.result(raw);
	}

	private result(raw: DatasetResponse): MetabaseResult {
		if (raw.status === "failed" || raw.error) {
			throw new Error(
				`Metabase query failed${raw.error_type ? ` (${raw.error_type})` : ""}.`,
			);
		}

		return {
			columns: (raw.data?.cols ?? []).map((column) => ({
				name: String(column.name ?? column.display_name ?? "column"),
				displayName: column.display_name ? String(column.display_name) : null,
				baseType: column.base_type ? String(column.base_type) : null,
			})),
			rows: raw.data?.rows ?? [],
		};
	}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`${this.config.baseUrl}${path}`, {
			...init,
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": this.config.apiKey,
				...init.headers,
			},
		});

		if (!response.ok) {
			const reason = await this.errorReason(response);
			throw new Error(
				`Metabase request failed (${response.status}) for ${path}${reason ? `: ${reason}` : "."}`,
			);
		}

		return (await response.json()) as T;
	}

	private async errorReason(response: Response): Promise<string | null> {
		try {
			const body = (await response.json()) as {
				error?: unknown;
				message?: unknown;
			};
			const value = body.error ?? body.message;
			return typeof value === "string"
				? value.replace(/\s+/g, " ").slice(0, 320)
				: null;
		} catch {
			return null;
		}
	}
}
