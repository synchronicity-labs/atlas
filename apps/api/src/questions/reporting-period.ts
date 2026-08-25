import type { QuestionPreviewInput } from "./questions.contracts";

type ReportingPeriod = QuestionPreviewInput["reportingPeriod"];
type ResultColumn = { name: string };

const DATE_COLUMN_NAMES = [
	"period_start",
	"period_end",
	"month_start",
	"month",
	"week_start",
	"day",
	"date",
	"event_date",
	"report_date",
	"invoice_month",
	"charge_month",
	"signup_month",
	"cohort_month",
	"reporting_period",
	"period",
	"created_at",
	"submitted_at",
] as const;

function dateColumnIndex(columns: ResultColumn[]): number | null {
	for (const candidate of DATE_COLUMN_NAMES) {
		const index = columns.findIndex(
			(column) => column.name.toLowerCase() === candidate,
		);
		if (index >= 0) return index;
	}
	const fallback = columns.findIndex((column) => {
		const name = column.name.toLowerCase();
		if (["data_through", "captured_at", "updated_at"].includes(name)) {
			return false;
		}
		return /(^|_)(date|day|week|month|period|cohort)($|_)/.test(name);
	});
	return fallback >= 0 ? fallback : null;
}

function resultDate(value: unknown): Date | null {
	if (typeof value !== "string" || value.trim() === "") return null;
	const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
	const parsed = new Date(normalized);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function utcDay(value: string | null, endOfDay = false): number | null {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const parsed = new Date(
		`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`,
	);
	return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function filterQuestionResult(
	columns: ResultColumn[],
	rows: unknown[][],
	filters: ReportingPeriod,
	now = new Date(),
): unknown[][] {
	if (!filters) return rows;
	const index = dateColumnIndex(columns);
	if (index == null) return rows;

	const customFrom = utcDay(filters.from);
	const customTo = utcDay(filters.to, true);
	const hasCustomRange = customFrom != null && customTo != null;
	if (filters.range === "all" && !hasCustomRange) return rows;

	const datedRows = rows.flatMap((row) => {
		const date = resultDate(row[index]);
		return date ? [{ date, row }] : [];
	});
	if (datedRows.length === 0) return rows;

	const latest = datedRows.reduce(
		(current, item) => (item.date > current ? item.date : current),
		new Date(0),
	);
	const start = (() => {
		if (hasCustomRange) return customFrom;
		if (filters.range === "mtd") {
			return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
		}
		if (filters.range === "previous-month") {
			return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
		}
		const months = filters.range === "3m" ? 3 : filters.range === "6m" ? 6 : 12;
		return Date.UTC(
			latest.getUTCFullYear(),
			latest.getUTCMonth() - (months - 1),
			1,
		);
	})();
	const end = (() => {
		if (hasCustomRange) return customTo;
		if (filters.range === "mtd") return now.getTime();
		if (filters.range === "previous-month") {
			return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1;
		}
		return Number.POSITIVE_INFINITY;
	})();

	return rows.filter((row) => {
		const date = resultDate(row[index]);
		if (!date) return true;
		const timestamp = date.getTime();
		return timestamp >= start && timestamp <= end;
	});
}
