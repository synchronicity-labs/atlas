import { createHash } from "node:crypto";

type NamedColumn = { name: string };

const NEGATIVE_FEEDBACK_QUESTION = 141;
const NEGATIVE_FEEDBACK_COLUMNS = new Set([
	"created_at",
	"model_name",
	"text_feedback",
]);
const SENSITIVE_COLUMN =
	/(^|_)(authorization|input_media_url|media_url|output_media_url|raw_payload|secret|token|webhook_url)($|_)/i;

function namedColumns(value: unknown): NamedColumn[] | null {
	if (!Array.isArray(value)) return null;
	const columns = value.filter(
		(column): column is NamedColumn =>
			column !== null &&
			typeof column === "object" &&
			!Array.isArray(column) &&
			"name" in column &&
			typeof column.name === "string",
	);
	return columns.length === value.length ? columns : null;
}

function resultRows(value: unknown): unknown[][] | null {
	if (!Array.isArray(value)) return null;
	const rows = value.filter((row): row is unknown[] => Array.isArray(row));
	return rows.length === value.length ? rows : null;
}

export function sanitizeQuestionResult<TColumn extends NamedColumn>(
	number: number,
	columnsValue: TColumn[],
	rowsValue: unknown[][],
): { columns: TColumn[]; rows: unknown[][] };
export function sanitizeQuestionResult(
	number: number,
	columnsValue: unknown,
	rowsValue: unknown,
): { columns: unknown; rows: unknown };
export function sanitizeQuestionResult(
	number: number,
	columnsValue: unknown,
	rowsValue: unknown,
): { columns: unknown; rows: unknown } {
	const columns = namedColumns(columnsValue);
	const rows = resultRows(rowsValue);
	if (!columns || !rows) {
		return number === NEGATIVE_FEEDBACK_QUESTION
			? { columns: [], rows: [] }
			: { columns: columnsValue, rows: rowsValue };
	}
	const indexes = columns.flatMap((column, index) => {
		const name = column.name.toLowerCase();
		if (SENSITIVE_COLUMN.test(name)) return [];
		if (
			number === NEGATIVE_FEEDBACK_QUESTION &&
			!NEGATIVE_FEEDBACK_COLUMNS.has(name)
		) {
			return [];
		}
		return [index];
	});
	return {
		columns: indexes.map((index) => columns[index]),
		rows: rows.map((row) => indexes.map((index) => row[index])),
	};
}

export type MetricInputContract = {
	alias: string;
	datasetKey: string;
	queryLanguage: "SQL" | "API" | "MBQL";
	queryText: string;
	expectedGrain: "EVENT" | "DAY" | "WEEK" | "MONTH" | "QUARTER";
	maxLagSeconds: number;
	required: boolean;
};

export type MetricContract = {
	key: string;
	name: string;
	ownerTeam: string;
	businessDefinition: Record<string, unknown>;
	normalizationPolicy: Record<string, unknown>;
	computation: Record<string, unknown>;
	verificationPolicy: Record<string, unknown>;
	cadence: Record<string, unknown>;
	inputs: MetricInputContract[];
};

export type SourceWatermark = {
	datasetKey: string;
	dataThrough: Date;
	complete: boolean;
};

export type ReportingWindow = {
	start: Date;
	end: Date;
	dataThrough: Date;
	label: string;
	basis: "calendar" | "rolling";
};

export function utcMonthWindow(period: string): ReportingWindow {
	const match = /^(\d{4})-(\d{2})$/.exec(period);
	if (!match) {
		throw new Error(`Invalid UTC month: ${period}`);
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	if (month < 1 || month > 12) {
		throw new Error(`Invalid UTC month: ${period}`);
	}
	const start = new Date(Date.UTC(year, month - 1, 1));
	const end = new Date(Date.UTC(year, month, 1));
	return { start, end, dataThrough: end, label: period, basis: "calendar" };
}

export function rollingWindow(
	dataThrough: Date,
	durationMs: number,
): ReportingWindow {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new Error("Rolling duration must be positive.");
	}
	const end = new Date(dataThrough);
	const start = new Date(end.getTime() - durationMs);
	return {
		start,
		end,
		dataThrough: end,
		label: `rolling-${durationMs}ms`,
		basis: "rolling",
	};
}

export function commonDataThrough(watermarks: SourceWatermark[]): Date {
	if (watermarks.length === 0) {
		throw new Error("At least one source watermark is required.");
	}
	const incomplete = watermarks.find((watermark) => !watermark.complete);
	if (incomplete) {
		throw new Error(`Dataset ${incomplete.datasetKey} is incomplete.`);
	}
	return new Date(
		Math.min(...watermarks.map((watermark) => watermark.dataThrough.getTime())),
	);
}

export function assertMetricContract(
	value: MetricContract,
): asserts value is MetricContract {
	if (!/^[a-z][a-z0-9_.-]*$/.test(value.key)) {
		throw new Error(`Invalid metric key: ${value.key}`);
	}
	if (!value.name.trim() || !value.ownerTeam.trim()) {
		throw new Error("Metric name and owner team are required.");
	}
	if (value.inputs.length === 0) {
		throw new Error("A metric requires at least one source input.");
	}
	const aliases = new Set<string>();
	for (const input of value.inputs) {
		if (!input.alias.trim() || aliases.has(input.alias)) {
			throw new Error(
				`Metric input alias is empty or duplicated: ${input.alias}`,
			);
		}
		if (!input.datasetKey.trim() || !input.queryText.trim()) {
			throw new Error(`Metric input ${input.alias} is incomplete.`);
		}
		if (!Number.isInteger(input.maxLagSeconds) || input.maxLagSeconds < 0) {
			throw new Error(`Metric input ${input.alias} has invalid lag.`);
		}
		aliases.add(input.alias);
	}
}

export function stableMetricContractHash(contract: MetricContract): string {
	assertMetricContract(contract);
	return createHash("sha256").update(stableJson(contract)).digest("hex");
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableJson).join(",")}]`;
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}
