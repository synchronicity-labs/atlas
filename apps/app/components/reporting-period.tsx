"use client";

import CalendarGlyph from "@carbon/icons-react/es/Calendar";
import { Button } from "@crm/ui/components/button";
import { Calendar } from "@crm/ui/components/calendar";
import { Icon } from "@crm/ui/components/icon";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@crm/ui/components/popover";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";

export const REPORTING_RANGES = [
	"mtd",
	"previous-month",
	"3m",
	"6m",
	"12m",
	"all",
] as const;

export type ReportingRange = (typeof REPORTING_RANGES)[number];
export type ReportingDateRange = { from: Date | undefined; to?: Date };
export type ReportingPeriodFilters = {
	range: ReportingRange;
	from: string | null;
	to: string | null;
};
export type ReportingColumn = { name: string };

export const REPORTING_RANGE_LABELS: Record<ReportingRange, string> = {
	mtd: "This month to date",
	"previous-month": "Previous month",
	"3m": "3 months",
	"6m": "6 months",
	"12m": "12 months",
	all: "All history",
};

export const REPORTING_DATE_COLUMNS = [
	"period_start",
	"period_end",
	"month_start",
	"month",
	"mo",
	"week_start",
	"wk",
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
	"createdat",
	"finished_at",
	"submitted_at",
] as const;

const URL_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_RANGE_DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});
const UTC_RANGE_DAY_YEAR_FORMAT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});

export function useReportingPeriod(defaultRange: ReportingRange = "6m") {
	const [filters, setFilters] = useQueryStates(
		{
			range: parseAsStringLiteral(REPORTING_RANGES).withDefault(defaultRange),
			from: parseAsString,
			to: parseAsString,
		},
		{ history: "push" },
	);

	return {
		filters,
		setPreset(range: ReportingRange) {
			return setFilters({ range, from: null, to: null });
		},
		setCustom(from: string, to: string) {
			return setFilters({ from, to });
		},
	};
}

export function reportingDate(value: unknown): Date | null {
	if (typeof value !== "string" || value.trim() === "") return null;
	const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
	const parsed = new Date(normalized);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function reportingDateColumnIndex(
	columns: ReportingColumn[],
): number | null {
	for (const candidate of REPORTING_DATE_COLUMNS) {
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
	if (fallback >= 0) return fallback;
	return null;
}

function parseUrlDay(value: string | null): Date | undefined {
	if (!value || !URL_DAY_PATTERN.test(value)) return undefined;
	const [yearText, monthText, dayText] = value.split("-");
	if (!yearText || !monthText || !dayText) return undefined;
	const parsed = new Date(
		Number(yearText),
		Number(monthText) - 1,
		Number(dayText),
	);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function urlDay(value: Date): string {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, "0");
	const day = String(value.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function utcDayBoundary(value: string | null, endOfDay = false): number | null {
	if (!value || !URL_DAY_PATTERN.test(value)) return null;
	const parsed = new Date(
		`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`,
	);
	return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function formatUrlDateRange(from: string, to: string): string {
	const fromDate = new Date(`${from}T12:00:00.000Z`);
	const toDate = new Date(`${to}T12:00:00.000Z`);
	if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
		return "Custom range";
	}
	return fromDate.getUTCFullYear() === toDate.getUTCFullYear()
		? `${UTC_RANGE_DAY_FORMAT.format(fromDate)} – ${UTC_RANGE_DAY_YEAR_FORMAT.format(toDate)}`
		: `${UTC_RANGE_DAY_YEAR_FORMAT.format(fromDate)} – ${UTC_RANGE_DAY_YEAR_FORMAT.format(toDate)}`;
}

export function reportingHistoryBounds(
	datasets: Array<{ columns: ReportingColumn[]; rows: unknown[][] }>,
): ReportingDateRange {
	let earliest: Date | undefined;
	let latest: Date | undefined;
	for (const dataset of datasets) {
		const index = reportingDateColumnIndex(dataset.columns);
		if (index == null) continue;
		for (const row of dataset.rows) {
			const date = reportingDate(row[index]);
			if (!date) continue;
			if (!earliest || date < earliest) earliest = date;
			if (!latest || date > latest) latest = date;
		}
	}
	return { from: earliest, to: latest };
}

function presetDateRange(
	range: ReportingRange,
	bounds: ReportingDateRange,
): ReportingDateRange {
	const now = new Date();
	if (range === "mtd") {
		return {
			from: new Date(now.getUTCFullYear(), now.getUTCMonth(), 1),
			to: new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
		};
	}
	if (range === "previous-month") {
		return {
			from: new Date(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
			to: new Date(now.getUTCFullYear(), now.getUTCMonth(), 0),
		};
	}
	if (!bounds.to) return { from: undefined };
	if (range === "all") return bounds;
	const months = range === "3m" ? 3 : range === "6m" ? 6 : 12;
	return {
		from: new Date(
			bounds.to.getFullYear(),
			bounds.to.getMonth() - (months - 1),
			1,
		),
		to: bounds.to,
	};
}

export function filterReportingRows(
	columns: ReportingColumn[],
	rows: unknown[][],
	filters: ReportingPeriodFilters,
): { rows: unknown[][]; dateColumnIndex: number | null } {
	const dateColumnIndex = reportingDateColumnIndex(columns);
	const customFrom = utcDayBoundary(filters.from);
	const customTo = utcDayBoundary(filters.to, true);
	const hasCustomRange = customFrom != null && customTo != null;
	if (dateColumnIndex == null || (filters.range === "all" && !hasCustomRange)) {
		return { rows, dateColumnIndex };
	}
	const datedRows = rows.flatMap((row) => {
		const date = reportingDate(row[dateColumnIndex]);
		return date ? [{ row, date }] : [];
	});
	if (datedRows.length === 0) return { rows, dateColumnIndex };

	const latestDate = datedRows.reduce(
		(latest, item) => (item.date > latest ? item.date : latest),
		new Date(0),
	);
	const now = new Date();
	const presetFrom = (() => {
		if (filters.range === "mtd") {
			return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
		}
		if (filters.range === "previous-month") {
			return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
		}
		const months = filters.range === "3m" ? 3 : filters.range === "6m" ? 6 : 12;
		return Date.UTC(
			latestDate.getUTCFullYear(),
			latestDate.getUTCMonth() - (months - 1),
			1,
		);
	})();
	const presetTo =
		filters.range === "mtd"
			? now.getTime()
			: filters.range === "previous-month"
				? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1
				: Number.POSITIVE_INFINITY;

	return {
		dateColumnIndex,
		rows: rows.filter((row) => {
			const date = reportingDate(row[dateColumnIndex]);
			if (!date) return true;
			const timestamp = date.getTime();
			return hasCustomRange
				? timestamp >= customFrom && timestamp <= customTo
				: timestamp >= presetFrom && timestamp <= presetTo;
		}),
	};
}

export function reportingPeriodLabel(filters: ReportingPeriodFilters): string {
	return filters.from && filters.to
		? formatUrlDateRange(filters.from, filters.to)
		: REPORTING_RANGE_LABELS[filters.range];
}

export function ReportingPeriodControl({
	filters,
	bounds,
	onPreset,
	onCustom,
	supported = true,
}: {
	filters: ReportingPeriodFilters;
	bounds: ReportingDateRange;
	onPreset: (range: ReportingRange) => void;
	onCustom: (from: string, to: string) => void;
	supported?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const hasCustomRange = Boolean(
		filters.from &&
			filters.to &&
			URL_DAY_PATTERN.test(filters.from) &&
			URL_DAY_PATTERN.test(filters.to),
	);
	const selectedRange = hasCustomRange
		? { from: parseUrlDay(filters.from), to: parseUrlDay(filters.to) }
		: presetDateRange(filters.range, bounds);
	const [draft, setDraft] = useState<ReportingDateRange>(selectedRange);
	const label = reportingPeriodLabel(filters);

	function changeOpen(next: boolean) {
		setOpen(next);
		if (next) setDraft(selectedRange);
	}

	function choosePreset(range: ReportingRange) {
		onPreset(range);
		setOpen(false);
	}

	function applyCustomRange() {
		if (!draft.from || !draft.to) return;
		onCustom(urlDay(draft.from), urlDay(draft.to));
		setOpen(false);
	}

	return (
		<Popover open={open} onOpenChange={changeOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					disabled={!supported}
					title={
						supported
							? "Choose the UTC period shown by dated questions"
							: "This question does not return a date field"
					}
					className="col-span-2 justify-start sm:col-span-1"
				>
					<Icon icon={CalendarGlyph} />
					{supported ? `Reporting period · ${label}` : "No time filter"}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				size="fit"
				align="end"
				className="max-h-[min(80vh,44rem)] max-w-[calc(100vw-1rem)] overflow-auto"
			>
				<div className="border-b p-3">
					<p className="font-medium text-sm">Choose a reporting period</p>
					<p className="mt-1 max-w-lg text-muted-foreground">
						This applies to every dated result. Past months show actuals. The
						current month can include month-to-date estimates. All dates use
						UTC.
					</p>
					<div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
						{REPORTING_RANGES.map((range) => (
							<Button
								key={range}
								variant={
									!hasCustomRange && filters.range === range
										? "secondary"
										: "ghost"
								}
								size="sm"
								onClick={() => choosePreset(range)}
							>
								{REPORTING_RANGE_LABELS[range]}
							</Button>
						))}
					</div>
				</div>
				<Calendar
					mode="range"
					selected={draft}
					onSelect={(next) => setDraft(next ?? { from: undefined })}
					{...((draft.to ?? bounds.to)
						? { defaultMonth: draft.to ?? bounds.to }
						: {})}
					numberOfMonths={2}
					showOutsideDays={false}
					autoFocus
				/>
				<div className="flex items-center justify-between gap-3 border-t p-3">
					<p className="text-muted-foreground">
						{draft.from && draft.to
							? `${urlDay(draft.from)} to ${urlDay(draft.to)} UTC`
							: "Select a start and end date."}
					</p>
					<div className="flex gap-2">
						<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button
							size="sm"
							disabled={!draft.from || !draft.to}
							onClick={applyCustomRange}
						>
							Apply dates
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
