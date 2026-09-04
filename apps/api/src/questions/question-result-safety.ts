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
	if (!columns || !rows) return { columns: columnsValue, rows: rowsValue };
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
