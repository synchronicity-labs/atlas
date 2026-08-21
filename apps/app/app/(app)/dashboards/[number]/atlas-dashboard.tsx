"use client";

import ChartCustom from "@carbon/icons-react/es/ChartCustom";
import Download from "@carbon/icons-react/es/Download";
import Edit from "@carbon/icons-react/es/Edit";
import Renew from "@carbon/icons-react/es/Renew";
import Save from "@carbon/icons-react/es/Save";
import View from "@carbon/icons-react/es/View";
import { Button } from "@crm/ui/components/button";
import { Line } from "@crm/ui/components/dither-kit/area";
import { LineChart } from "@crm/ui/components/dither-kit/area-chart";
import { Bar } from "@crm/ui/components/dither-kit/bar";
import { BarChart } from "@crm/ui/components/dither-kit/bar-chart";
import { BlockLegend } from "@crm/ui/components/dither-kit/block-legend";
import type { ChartConfig } from "@crm/ui/components/dither-kit/chart-context";
import { RightYAxis } from "@crm/ui/components/dither-kit/dual-y-axis";
import { Grid } from "@crm/ui/components/dither-kit/grid";
import { Tooltip } from "@crm/ui/components/dither-kit/tooltip";
import { XAxis } from "@crm/ui/components/dither-kit/x-axis";
import { YAxis } from "@crm/ui/components/dither-kit/y-axis";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Icon } from "@crm/ui/components/icon";
import { MetricTrustIndicator } from "@crm/ui/components/metric-trust-indicator";
import { RelativeTimestamp } from "@crm/ui/components/relative-timestamp";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import {
	formatDay,
	formatMonthPeriod,
	formatUtcTimestamp,
} from "@crm/ui/lib/format";
import { cn } from "@crm/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { parseAsInteger, useQueryState } from "nuqs";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactGridLayout, {
	type Layout,
	type LayoutItem,
	useContainerWidth,
} from "react-grid-layout";
import { toast } from "sonner";
import { QuestionExplanationTooltip } from "@/components/question-explanation";
import { RudyChatTrigger } from "@/components/rudy-chat";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Dashboard = RouterOutputs["atlasDashboards"]["byNumber"];
type DashboardCard = Dashboard["cards"][number];
type Visualization = DashboardCard["visualization"];
type Column = {
	name: string;
	displayName?: string | null;
	baseType?: string | null;
};
type Datum = Record<string, string | number>;
type SnapshotData = {
	columns: unknown;
	rows: unknown;
	reportingPeriod?: string;
	capturedAt?: string;
} | null;
type DitherColor =
	| "green"
	| "blue"
	| "orange"
	| "purple"
	| "pink"
	| "red"
	| "grey";

const COLORS: DitherColor[] = [
	"green",
	"blue",
	"orange",
	"purple",
	"pink",
	"red",
];
const GRIP_DOTS = [
	"top-left",
	"top-right",
	"middle-left",
	"middle-right",
	"bottom-left",
	"bottom-right",
];
const UTC_CHART_DATETIME_FORMAT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	hour: "numeric",
	timeZone: "UTC",
});
const UTC_CHART_DATETIME_COMPACT_FORMAT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
	timeZone: "UTC",
});
const UTC_CHART_DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});
const UTC_CHART_DAY_COMPACT_FORMAT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});
const METRIC_NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 2,
});
const METRIC_CURRENCY_FORMAT = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 0,
});
const METRIC_AXIS_NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

function columns(snapshot: SnapshotData): Column[] {
	if (!snapshot || !Array.isArray(snapshot.columns)) return [];
	return snapshot.columns.flatMap((column) => {
		if (!column || typeof column !== "object" || Array.isArray(column))
			return [];
		const name = "name" in column ? column.name : null;
		if (typeof name !== "string") return [];
		return [
			{
				name,
				displayName:
					"displayName" in column && typeof column.displayName === "string"
						? column.displayName
						: null,
				baseType:
					"baseType" in column && typeof column.baseType === "string"
						? column.baseType
						: null,
			},
		];
	});
}

function rows(snapshot: SnapshotData): unknown[][] {
	if (!snapshot || !Array.isArray(snapshot.rows)) return [];
	return snapshot.rows.filter(Array.isArray) as unknown[][];
}

function humanize(value: string): string {
	return value
		.replaceAll("_", " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sourceErrorSummary(lastError: string | null): string {
	if (!lastError) return "The latest refresh failed.";
	if (lastError.includes("__ATLAS_")) {
		return "A saved question was not prepared before it reached Metabase.";
	}
	if (/\b(401|403)\b|unauthorized|forbidden/i.test(lastError)) {
		return "Metabase rejected the saved read-only credential.";
	}
	if (/Metabase request failed \(400\)|DB::Exception/i.test(lastError)) {
		return "Metabase rejected one of the saved questions.";
	}
	return "The latest refresh failed. Existing results are still available.";
}

function setting(
	card: { displaySettings: unknown },
	key: string,
): string | null {
	const value = card.displaySettings;
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === "string" ? candidate : null;
}

function booleanSetting(
	card: { displaySettings: unknown },
	key: string,
): boolean {
	const value = card.displaySettings;
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return (value as Record<string, unknown>)[key] === true;
}

function stringArraySetting(
	card: { displaySettings: unknown },
	key: string,
): string[] {
	const value = card.displaySettings;
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const candidate = (value as Record<string, unknown>)[key];
	if (!Array.isArray(candidate)) return [];
	return candidate.filter((item): item is string => typeof item === "string");
}

function visibleColumnEntries(card: DashboardCard) {
	const hiddenColumns = new Set(stringArraySetting(card, "hiddenColumns"));
	return columns(card.snapshot)
		.map((column, index) => ({ column, index }))
		.filter(({ column }) => !hiddenColumns.has(column.name));
}

function chartPeriod(value: unknown, compact = false): string {
	if (typeof value !== "string") return String(value ?? "");
	if (/^\d{4}-\d{2}-\d{2}T(?!00:00:00)/.test(value)) {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) {
			return (
				compact ? UTC_CHART_DATETIME_COMPACT_FORMAT : UTC_CHART_DATETIME_FORMAT
			).format(date);
		}
	}
	const day = value.slice(8, 10);
	if (/^\d{4}-\d{2}-\d{2}/.test(value) && day !== "01") {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) {
			return (
				compact ? UTC_CHART_DAY_COMPACT_FORMAT : UTC_CHART_DAY_FORMAT
			).format(date);
		}
	}
	return formatMonthPeriod(value, { includeMtd: true, compact });
}

function timeframeLabel(card: DashboardCard): string | null {
	const explicit = setting(card, "timeframe") ?? setting(card, "periodLabel");
	if (explicit) return explicit;
	if ([1102, 1110, 1117, 1118].includes(card.question.number)) {
		return "Previous month actual → current month estimated";
	}
	if (card.question.number === 1111) {
		return "Previous month-end → current value";
	}
	const snapshot = card.snapshot;
	if (!snapshot) return null;
	const cardColumns = columns(snapshot);
	const sourceRows = rows(snapshot);
	const dateColumnIndex = cardColumns.findIndex((column) =>
		/(^|_)(month|week|day|date|hour|period)($|_)/i.test(column.name),
	);
	if (dateColumnIndex >= 0) {
		const periods = sourceRows.flatMap((row) => {
			const value = row[dateColumnIndex];
			return typeof value === "string" ? [value] : [];
		});
		const first = periods[0];
		const last = periods.at(-1);
		if (first && last) {
			return first === last
				? chartPeriod(first)
				: `${chartPeriod(first, true)}–${chartPeriod(last, true)}`;
		}
	}
	return "Timeframe not defined";
}

function CardHeading({ card }: { card: DashboardCard }) {
	const timeframe = timeframeLabel(card);
	const checkedAt = card.question.lastCheckedAt ?? card.snapshot?.capturedAt;
	return (
		<div className="absolute top-3 right-16 left-4 z-10 min-w-0">
			<p className="truncate font-medium text-sm">{card.question.name}</p>
			<div className="mt-0.5 flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-[11px] text-muted-foreground">
				<span className="min-w-0 flex-1 truncate">{timeframe}</span>
				{checkedAt ? (
					<span className="shrink-0">
						· <RelativeTimestamp value={checkedAt} prefix="Checked" />
					</span>
				) : null}
				<span className="flex shrink-0">
					<MetricTrustIndicator summary={card.verification} compact />
				</span>
			</div>
		</div>
	);
}

function isPercent(name: string): boolean {
	if (/cohort spend|spend_usd/i.test(name)) return false;
	return (
		/percent|pct|requalification|ndr|conversion/i.test(name) ||
		(/margin/i.test(name) && !/margin_usd|margin usd/i.test(name)) ||
		(/rate/i.test(name) && !/run.?rate/i.test(name))
	);
}

function isCurrency(name: string): boolean {
	if (/cash|collect|usage.*incurred|invoice.*raised/i.test(name)) return true;
	if (
		/(^|_)(count|counts|customers|organizations|orgs|subscriptions|invoices|generations|contacts|users)($|_)/i.test(
			name,
		)
	) {
		return false;
	}
	return /revenue|spend|cost|value|amount|pipeline|booking|forecast|accrual|arr|ndr_usd|run.?rate|subscription|invoice|collection|billing/i.test(
		name,
	);
}

function formatCell(value: unknown, column: Column): string {
	if (typeof value === "number") return formatMetric(value, column.name);
	if (
		typeof value === "string" &&
		(column.name === "month" || column.name.endsWith("_month"))
	) {
		return formatMonthPeriod(value, { includeMtd: true });
	}
	if (
		typeof value === "string" &&
		(column.baseType?.toLowerCase().includes("date") ||
			column.name.endsWith("_date"))
	) {
		return column.baseType?.toLowerCase().includes("datetime") ||
			column.baseType?.toLowerCase().includes("timestamp")
			? formatUtcTimestamp(value)
			: formatDay(value);
	}
	return String(value ?? "—");
}

function formatMetric(value: number, name: string): string {
	if (isPercent(name)) return `${METRIC_NUMBER_FORMAT.format(value)}%`;
	if (isCurrency(name)) return METRIC_CURRENCY_FORMAT.format(value);
	return METRIC_NUMBER_FORMAT.format(value);
}

function formatAxisMetric(value: number, name: string): string {
	if (metricFamily(name) === "number") {
		return METRIC_AXIS_NUMBER_FORMAT.format(value);
	}
	return formatMetric(value, name);
}

function chartData(card: DashboardCard): {
	data: Datum[];
	xKey: string;
	series: string[];
} {
	const cardColumns = columns(card.snapshot);
	const sourceRows = rows(card.snapshot);
	const xKey = cardColumns[0]?.name ?? "period";
	const series: string[] = [];
	for (let index = 1; index < cardColumns.length; index += 1) {
		const column = cardColumns[index];
		if (
			column &&
			!/(^|_)(period_end|window_end|data_through|captured_at)$/i.test(
				column.name,
			)
		) {
			series.push(column.name);
		}
	}
	return {
		xKey,
		series,
		data: sourceRows.map(
			(row) =>
				Object.fromEntries(
					cardColumns.flatMap((column, index) => {
						const cell = row[index];
						return typeof cell === "number" || typeof cell === "string"
							? [[column.name, cell]]
							: [];
					}),
				) as Datum,
		),
	};
}

function ScalarCard({ card }: { card: DashboardCard }) {
	const sourceRows = rows(card.snapshot);
	const current = sourceRows.at(-1);
	const previous = sourceRows.at(-2);
	const currentValue = current?.find((cell) => typeof cell === "number");
	const previousValue = previous?.find((cell) => typeof cell === "number");
	const period = current?.find((cell) => typeof cell === "string");
	const previousPeriod = previous?.find((cell) => typeof cell === "string");
	const isCurrentMonth =
		typeof period === "string" &&
		period.slice(0, 7) === new Date().toISOString().slice(0, 7);
	const percentMetric = isPercent(card.question.name);
	const formattedCurrent =
		typeof currentValue === "number"
			? formatMetric(currentValue, card.question.name)
			: null;
	const change =
		typeof currentValue === "number" &&
		typeof previousValue === "number" &&
		previousValue !== 0 &&
		(!isCurrentMonth || booleanSetting(card, "compareCurrentPeriod"))
			? percentMetric
				? currentValue - previousValue
				: ((currentValue - previousValue) / previousValue) * 100
			: null;
	const runRateComparison = [1102, 1110, 1111, 1117, 1118].includes(
		card.question.number,
	);
	let currentPeriodLabel: string | null = null;
	if (typeof period === "string") {
		const formattedPeriod = formatMonthPeriod(period);
		switch (card.question.number) {
			case 1110:
				currentPeriodLabel = `${formattedPeriod} estimated month-end usage`;
				break;
			case 1111:
				currentPeriodLabel = `${formattedPeriod} current subscription value`;
				break;
			case 1117:
				currentPeriodLabel = `${formattedPeriod} estimated month-end top-ups`;
				break;
			case 1118:
				currentPeriodLabel = `${formattedPeriod} estimated month-end variable revenue`;
				break;
			case 1102:
				currentPeriodLabel = `${formattedPeriod} estimated month-end revenue`;
				break;
			default:
				currentPeriodLabel = formatMonthPeriod(period, { includeMtd: true });
		}
	}
	const previousPeriodLabel =
		typeof previousPeriod === "string"
			? card.question.number === 1111
				? `${formatMonthPeriod(previousPeriod)} month-end`
				: `${formatMonthPeriod(previousPeriod)} actual`
			: "Previous period";

	return (
		<div className="atlas-scalar-card grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-4">
			<div className="min-w-0 shrink-0 pr-16">
				<p className="line-clamp-2 font-medium text-sm leading-5">
					{card.question.name}
				</p>
				<div className="mt-0.5 flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-[11px] text-muted-foreground">
					<span className="min-w-0 flex-1 truncate">
						{timeframeLabel(card)}
					</span>
					{card.question.lastCheckedAt || card.snapshot?.capturedAt ? (
						<span className="shrink-0">
							·{" "}
							<RelativeTimestamp
								value={
									card.question.lastCheckedAt ?? card.snapshot?.capturedAt ?? ""
								}
								prefix="Checked"
							/>
						</span>
					) : null}
					<span className="flex shrink-0">
						<MetricTrustIndicator summary={card.verification} compact />
					</span>
				</div>
			</div>
			{typeof currentValue === "number" ? (
				<div className="flex min-h-0 flex-col items-center justify-center text-center">
					<p className="atlas-scalar-value max-w-full font-medium tracking-tight tabular-nums">
						{formattedCurrent}
					</p>
					{currentPeriodLabel ? (
						<p className="mt-1 text-muted-foreground text-sm">
							{currentPeriodLabel}
						</p>
					) : null}
					{change != null && typeof previousValue === "number" ? (
						<p
							className={cn(
								"mt-0.5 text-xs",
								change >= 0 ? "text-success" : "text-destructive",
							)}
						>
							{runRateComparison ? (
								<>
									{previousPeriodLabel}:{" "}
									{formatMetric(previousValue, card.question.name)} ·{" "}
									{change >= 0 ? "+" : ""}
									{change.toFixed(2)}
									{percentMetric ? " pts" : "%"}
								</>
							) : (
								<>
									{change >= 0 ? "+" : ""}
									{change.toFixed(2)}
									{percentMetric ? " pts" : "%"} · previous{" "}
									{formatMetric(previousValue, card.question.name)}
								</>
							)}
						</p>
					) : null}
				</div>
			) : (
				<CardUnavailable />
			)}
		</div>
	);
}

function metricFamily(name: string): "percent" | "currency" | "number" {
	if (isPercent(name)) return "percent";
	if (isCurrency(name)) return "currency";
	return "number";
}

function rightAxisSeries(card: DashboardCard, series: string[]): string[] {
	if (
		/professional orgs \+ activated pool/i.test(card.question.name) &&
		series.length === 2
	) {
		return series.slice(1);
	}
	const leftFamily = metricFamily(series[0] ?? "");
	const rightSeries = series.filter(
		(seriesName) => metricFamily(seriesName) !== leftFamily,
	);
	return rightSeries.length < series.length ? rightSeries : [];
}

function cardStackType(card: object): "default" | "stacked" | "percent" {
	const settings = (card as { displaySettings?: unknown }).displaySettings;
	if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
		return "default";
	}
	const value = "stackType" in settings ? settings.stackType : null;
	return value === "stacked" || value === "percent" ? value : "default";
}

function chartConfig(series: string[]): ChartConfig {
	return Object.fromEntries(
		series.map((key, index) => [
			key,
			{ label: humanize(key), color: COLORS[index % COLORS.length] ?? "grey" },
		]),
	) as ChartConfig;
}

function BarSeriesChart({ card }: { card: DashboardCard }) {
	const source = chartData(card);
	if (source.data.length === 0 || source.series.length === 0) {
		return <CardUnavailable message={setting(card, "unavailableMessage")} />;
	}
	const config = chartConfig(source.series);

	return (
		<div
			className={cn(
				"relative h-full min-h-[180px] px-3 pb-3",
				timeframeLabel(card) ? "pt-16" : "pt-12",
			)}
		>
			<CardHeading card={card} />
			<div className="flex h-full min-h-0 flex-col gap-2">
				<BlockLegend config={config} className="shrink-0" />
				<div className="min-h-0 flex-1">
					<BarChart
						data={source.data}
						config={config}
						stackType={cardStackType(card)}
						bloom="low"
						bloomOnHover
						margins={{ left: 54, right: 18, top: 4, bottom: 24 }}
					>
						<Grid strokeDasharray="2 4" />
						<XAxis
							dataKey={source.xKey}
							tickFormatter={(value) => chartPeriod(value, true)}
							maxTicks={7}
						/>
						<YAxis
							tickFormatter={(value) =>
								formatMetric(value, source.series[0] ?? "")
							}
						/>
						<Tooltip
							labelKey={source.xKey}
							labelFormatter={(value) => chartPeriod(value)}
							valueFormatter={(value, name) => formatMetric(value, name)}
						/>
						{source.series.map((key, index) => (
							<Bar
								key={key}
								dataKey={key}
								variant={index % 2 === 0 ? "gradient" : "hatched"}
								isClickable
							/>
						))}
					</BarChart>
				</div>
			</div>
		</div>
	);
}

function SeriesChart({ card }: { card: DashboardCard }) {
	const source = chartData(card);
	if (source.data.length === 0 || source.series.length === 0)
		return <CardUnavailable message={setting(card, "unavailableMessage")} />;
	const candidateRightKeys = rightAxisSeries(card, source.series);
	const candidateRightKeySet = new Set(candidateRightKeys);
	const candidateLeftKeys = source.series.filter(
		(key) => !candidateRightKeySet.has(key),
	);
	let data = source.data;
	let rightKeys: string[] = [];
	let rightScale: {
		min: number;
		max: number;
		leftMin: number;
		leftMax: number;
	} | null = null;

	if (candidateLeftKeys.length > 0 && candidateRightKeys.length > 0) {
		const leftValues: number[] = [];
		const rightValues: number[] = [];
		for (const point of data) {
			for (const key of candidateLeftKeys) {
				const value = Number(point[key]);
				if (Number.isFinite(value)) leftValues.push(value);
			}
			for (const key of candidateRightKeys) {
				const value = Number(point[key]);
				if (Number.isFinite(value)) rightValues.push(value);
			}
		}
		if (leftValues.length > 0 && rightValues.length > 0) {
			const leftMin = Math.min(0, ...leftValues);
			const leftMax = Math.max(0, ...leftValues);
			const rightMin = Math.min(0, ...rightValues);
			const rightMax = Math.max(0, ...rightValues);
			const leftRange = Math.max(1, leftMax - leftMin);
			const rightRange = Math.max(1, rightMax - rightMin);
			rightKeys = candidateRightKeys;
			rightScale = { min: rightMin, max: rightMax, leftMin, leftMax };
			const rightKeySet = new Set(rightKeys);
			data = data.map(
				(point) =>
					Object.fromEntries(
						Object.entries(point).map(([key, value]) => [
							key,
							rightKeySet.has(key) && typeof value === "number"
								? leftMin + ((value - rightMin) / rightRange) * leftRange
								: value,
						]),
					) as Datum,
			);
		}
	}

	const config = chartConfig(source.series);
	const dual = rightKeys.length > 0;
	const rightKeySet = new Set(rightKeys);
	const leftKey = source.series.find((key) => !rightKeySet.has(key));
	const rightKey = rightKeys[0];
	const inverseRight = (value: number) => {
		if (!rightScale) return value;
		const leftRange = Math.max(1, rightScale.leftMax - rightScale.leftMin);
		return (
			rightScale.min +
			((value - rightScale.leftMin) / leftRange) *
				(rightScale.max - rightScale.min)
		);
	};

	return (
		<div
			className={cn(
				"relative h-full min-h-[180px] px-3 pb-3",
				timeframeLabel(card) ? "pt-16" : "pt-12",
			)}
		>
			<CardHeading card={card} />
			<div className="flex h-full min-h-0 flex-col gap-2">
				<BlockLegend config={config} className="shrink-0" />
				<div className="min-h-0 flex-1">
					<LineChart
						data={data}
						config={config}
						bloom="off"
						margins={{ left: 44, right: dual ? 54 : 18, top: 4, bottom: 24 }}
					>
						<Grid strokeDasharray="2 4" />
						<XAxis
							dataKey={source.xKey}
							tickFormatter={(value) => chartPeriod(value, true)}
							maxTicks={5}
						/>
						<YAxis
							tickFormatter={(value) => formatAxisMetric(value, leftKey ?? "")}
						/>
						{dual ? (
							<RightYAxis
								tickFormatter={(value) =>
									formatAxisMetric(inverseRight(value), rightKey ?? "")
								}
							/>
						) : null}
						<Tooltip
							labelKey={source.xKey}
							labelFormatter={(value) => chartPeriod(value)}
							valueFormatter={(value, name) =>
								formatMetric(
									rightKeySet.has(name) ? inverseRight(value) : value,
									name,
								)
							}
						/>
						{source.series.map((key, index) => (
							<Line
								key={key}
								dataKey={key}
								variant={index % 2 === 0 ? "gradient" : "hatched"}
								isClickable
							/>
						))}
					</LineChart>
				</div>
			</div>
		</div>
	);
}

function TableCard({ card }: { card: DashboardCard }) {
	const columnEntries = visibleColumnEntries(card);
	const allRows = rows(card.snapshot);
	const sourceRows =
		setting(card, "visibleRows") === "all" ? allRows : allRows.slice(0, 8);
	if (columnEntries.length === 0) return <CardUnavailable />;
	return (
		<div
			className={cn(
				"relative h-full overflow-auto",
				timeframeLabel(card) ? "pt-16" : "pt-12",
			)}
		>
			<CardHeading card={card} />
			<table className="w-full text-left text-xs">
				<thead className="sticky top-0 bg-card text-muted-foreground">
					<tr>
						{columnEntries.map(({ column }) => (
							<th key={column.name} className="border-b px-3 py-2 font-normal">
								{humanize(column.displayName ?? column.name)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{sourceRows.map((row) => (
						<tr
							key={`${card.id}:${JSON.stringify(row)}`}
							className="border-b last:border-0"
						>
							{columnEntries.map(({ column, index }) => (
								<td key={column.name} className="max-w-48 truncate px-3 py-2">
									{formatCell(row[index], column)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function csvValue(value: unknown): string {
	let text =
		value === null || value === undefined
			? ""
			: typeof value === "object"
				? JSON.stringify(value)
				: String(value);
	if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
	return `"${text.replaceAll('"', '""')}"`;
}

function exportCardCsv(card: DashboardCard) {
	const columnEntries = visibleColumnEntries(card);
	const sourceRows = rows(card.snapshot);
	if (columnEntries.length === 0) return;
	const csv = [
		columnEntries.map(({ column }) =>
			csvValue(column.displayName ?? column.name),
		),
		...sourceRows.map((row) =>
			columnEntries.map(({ index }) => csvValue(row[index])),
		),
	]
		.map((row) => row.join(","))
		.join("\n");
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `${card.question.name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")}.csv`;
	anchor.click();
	URL.revokeObjectURL(url);
}

function CardUnavailable({ message }: { message?: string | null }) {
	return (
		<div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 p-6 text-center">
			<p className="font-medium text-sm">Source result unavailable</p>
			<p className="max-w-sm text-muted-foreground text-xs leading-5">
				{message ?? "No source result is available for this question yet."}
			</p>
		</div>
	);
}

function readinessLabel(value: string | null | undefined): string {
	switch (value) {
		case "NEEDS_DEFINITION":
			return "Needs a decision";
		case "NEEDS_SOURCE":
			return "Needs a source";
		case "NEEDS_EVIDENCE":
			return "Needs evidence";
		case "READY_TO_IMPLEMENT":
			return "Ready to build";
		case "IMPLEMENTING":
			return "Being built";
		case "RECONCILING":
			return "Checking the result";
		case "BLOCKED":
			return "Blocked";
		default:
			return "Not ready";
	}
}

function pendingReason(card: DashboardCard): string {
	return (
		card.question.catalog?.latestAttempt?.detail ??
		card.question.source?.lastError ??
		card.question.catalog?.sourceHint ??
		"Atlas does not have a saved result for this KPI yet."
	);
}

function PendingKpiRail({ cards }: { cards: DashboardCard[] }) {
	if (cards.length === 0) return null;
	return (
		<section className="rounded-lg border bg-card">
			<div className="flex flex-col gap-1 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="font-medium text-sm">Not on the board yet</p>
					<p className="text-muted-foreground text-xs">
						{cards.length} {cards.length === 1 ? "KPI needs" : "KPIs need"} work
						before Atlas can show a value.
					</p>
				</div>
				<Button asChild variant="ghost" size="sm">
					<Link href="/metrics">Review all metrics</Link>
				</Button>
			</div>
			<div className="grid divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
				{cards.map((card) => (
					<Link
						key={card.id}
						href={`/questions/${card.question.publicNumber}`}
						className="group flex min-w-0 items-start justify-between gap-4 px-4 py-3 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
					>
						<div className="min-w-0">
							<p className="truncate font-medium text-sm">
								{card.question.name}
							</p>
							<p className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-5">
								{card.question.explanation}
							</p>
							<p className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-5">
								{pendingReason(card)}
							</p>
						</div>
						<span className="shrink-0 rounded-full border px-2 py-1 text-[10px] text-muted-foreground">
							{readinessLabel(card.question.catalog?.readiness)}
						</span>
					</Link>
				))}
			</div>
		</section>
	);
}

function ReportCardHeader({
	title,
	period,
	comparison,
	updatedAt,
	verification,
}: {
	title: string;
	period?: string | null;
	comparison?: string | null;
	updatedAt?: string | null;
	verification: DashboardCard["verification"];
}) {
	return (
		<div className="absolute inset-x-0 top-0 z-10 px-5 pt-4">
			<p className="max-w-[75%] truncate font-medium text-sm">{title}</p>
			{period || comparison || updatedAt ? (
				<div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
					{period ? (
						<span className="rounded-full bg-muted px-2 py-1">{period}</span>
					) : null}
					{comparison ? (
						<span className="rounded-full bg-muted px-2 py-1">
							{comparison}
						</span>
					) : null}
					{updatedAt ? (
						<span className="rounded-full bg-muted px-2 py-1">
							<RelativeTimestamp value={updatedAt} />
						</span>
					) : null}
				</div>
			) : null}
			<div className="mt-1">
				<MetricTrustIndicator summary={verification} compact />
			</div>
		</div>
	);
}

function MetricStripCard({ card }: { card: DashboardCard }) {
	const sourceRows = rows(card.snapshot);
	return (
		<div className="relative flex h-full min-h-[220px] items-center px-5 pt-20 pb-4">
			<ReportCardHeader
				title={card.question.name}
				period={setting(card, "periodLabel")}
				comparison={setting(card, "comparisonLabel")}
				updatedAt={card.snapshot?.capturedAt}
				verification={card.verification}
			/>
			{sourceRows.length ? (
				<div
					className="grid w-full gap-x-5 gap-y-6"
					style={{
						gridTemplateColumns: `repeat(${Math.min(sourceRows.length, 5)}, minmax(0, 1fr))`,
					}}
				>
					{sourceRows.map((row) => {
						const label = String(row[0] ?? "Metric");
						const value = typeof row[1] === "number" ? row[1] : null;
						const change = typeof row[3] === "number" ? row[3] : null;
						const error = typeof row[5] === "string" ? row[5] : null;
						return (
							<div key={label} className="min-w-0 text-center">
								<p className="truncate text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
									{label}
								</p>
								<p className="mt-2 truncate font-medium text-2xl tabular-nums tracking-tight">
									{value === null ? "—" : formatMetric(value, label)}
								</p>
								{change !== null ? (
									<p
										className={cn(
											"mt-1 text-xs tabular-nums",
											change >= 0 ? "text-success" : "text-destructive",
										)}
									>
										{change >= 0 ? "↑" : "↓"} {Math.abs(change).toFixed(2)}%
									</p>
								) : error ? (
									<p className="mt-1 truncate text-muted-foreground text-[10px]">
										Unavailable
									</p>
								) : null}
							</div>
						);
					})}
				</div>
			) : (
				<CardUnavailable message={setting(card, "unavailableMessage")} />
			)}
		</div>
	);
}

function ForecastStageCard({ card }: { card: DashboardCard }) {
	const values = rows(card.snapshot).flatMap((row) => {
		const stage = typeof row[0] === "string" ? row[0] : null;
		const probability = typeof row[1] === "number" ? row[1] : 0;
		const dealCount = typeof row[2] === "number" ? row[2] : 0;
		const amount = typeof row[3] === "number" ? row[3] : 0;
		return stage && amount > 0
			? [{ stage, probability, dealCount, amount }]
			: [];
	});
	const total = values.reduce((sum, value) => sum + value.amount, 0);
	return (
		<div className="relative flex h-full min-h-[280px] flex-col px-5 pt-20 pb-5">
			<ReportCardHeader
				title={card.question.name}
				period={setting(card, "periodLabel")}
				updatedAt={card.snapshot?.capturedAt}
				verification={card.verification}
			/>
			{values.length ? (
				<>
					<p className="mt-1 font-medium text-3xl tabular-nums tracking-tight">
						{formatMetric(total, "forecast amount")}
					</p>
					<div className="mt-auto flex h-14 w-full overflow-hidden rounded-sm border bg-muted/30">
						{values.map((value, index) => (
							<div
								key={value.stage}
								className="border-background/70 border-r last:border-r-0"
								style={{
									flexGrow: Math.max(value.amount, total * 0.008),
									backgroundColor: `var(--chart-${(index % 5) + 1})`,
								}}
							/>
						))}
					</div>
					<div className="mt-3 grid gap-3 sm:grid-cols-3">
						{values.slice(0, 3).map((value, index) => (
							<div key={value.stage} className="min-w-0">
								<div className="flex items-center gap-2">
									<span
										className="size-2 shrink-0 rounded-sm"
										style={{
											backgroundColor: `var(--chart-${(index % 5) + 1})`,
										}}
									/>
									<p className="truncate text-muted-foreground text-xs">
										{value.stage}
									</p>
								</div>
								<p className="mt-1 font-medium text-sm tabular-nums">
									{formatMetric(value.amount, "forecast amount")} ·{" "}
									{value.probability}%
								</p>
							</div>
						))}
					</div>
				</>
			) : (
				<CardUnavailable message={setting(card, "unavailableMessage")} />
			)}
		</div>
	);
}

const QuestionCard = memo(
	function QuestionCard({
		card,
		editing,
		visualization,
		onVisualization,
	}: {
		card: DashboardCard;
		editing: boolean;
		visualization: Visualization;
		onVisualization: (visualization: Visualization) => void;
	}) {
		const presentation = setting(card, "presentation");
		const questionDefinition = (
			card.question as unknown as { definition?: unknown }
		).definition;
		return (
			<div
				className={cn(
					"group relative h-full overflow-visible rounded-lg border bg-card shadow-xs",
					editing && "ring-1 ring-primary/15",
				)}
			>
				<div
					className={cn(
						"absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm backdrop-blur-sm transition-opacity",
						editing || visualization === "TABLE"
							? "opacity-100"
							: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
					)}
				>
					<QuestionExplanationTooltip
						questionName={card.question.name}
						explanation={card.question.explanation}
						definition={questionDefinition}
					/>
					<RudyChatTrigger
						record={{
							kind: "question",
							id: String(card.question.publicNumber),
						}}
						label={`Ask Rudy about question ${card.question.publicNumber}`}
						iconOnly
						variant="ghost"
					/>
					<Button
						asChild
						variant="ghost"
						size="icon-xs"
						aria-label="Open question"
					>
						<Link
							href={`/questions/${card.question.publicNumber}`}
							draggable={false}
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => event.stopPropagation()}
						>
							<Icon icon={View} />
						</Link>
					</Button>
					{visualization === "TABLE" && card.snapshot ? (
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="Export CSV"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.stopPropagation();
								exportCardCsv(card);
							}}
						>
							<Icon icon={Download} />
						</Button>
					) : null}
					{editing ? (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Change visualization"
								>
									<Icon icon={ChartCustom} />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{(["NUMBER", "BAR", "LINE", "TABLE"] as const).map(
									(visualization) => (
										<DropdownMenuItem
											key={visualization}
											onSelect={() => onVisualization(visualization)}
										>
											{humanize(visualization.toLowerCase())}
										</DropdownMenuItem>
									),
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
					{editing ? (
						<Button
							variant="ghost"
							size="icon-xs"
							className="atlas-card-drag cursor-grab active:cursor-grabbing"
							aria-label="Move question"
						>
							<span className="grid grid-cols-2 gap-0.5">
								{GRIP_DOTS.map((dot) => (
									<span
										key={dot}
										className="size-0.5 rounded-full bg-current"
									/>
								))}
							</span>
						</Button>
					) : null}
				</div>
				{presentation === "metric-strip" ? (
					<MetricStripCard card={card} />
				) : presentation === "forecast-stage" ? (
					<ForecastStageCard card={card} />
				) : visualization === "NUMBER" ? (
					<ScalarCard card={card} />
				) : visualization === "TABLE" ? (
					<TableCard card={card} />
				) : visualization === "BAR" ? (
					<BarSeriesChart card={card} />
				) : (
					<SeriesChart card={card} />
				)}
			</div>
		);
	},
	(previous, next) =>
		previous.card === next.card &&
		previous.editing === next.editing &&
		previous.visualization === next.visualization,
);

function toLayout(cards: DashboardCard[]): Layout {
	return cards.map((card) => ({
		i: card.id,
		x: card.x,
		y: card.y,
		w: card.width,
		h: card.height,
		minW: 4,
		minH: 3,
	}));
}

function stackLayout(layout: Layout): Layout {
	let nextY = 0;
	return [...layout]
		.sort((left, right) => left.y - right.y || left.x - right.x)
		.map((item) => {
			const stacked = { ...item, x: 0, y: nextY, w: 24 };
			nextY += item.h;
			return stacked;
		});
}

function AtlasGrid({
	cards,
	editing,
	layout,
	visualizations,
	onLayout,
	onVisualization,
}: {
	cards: DashboardCard[];
	editing: boolean;
	layout: Layout;
	visualizations: Record<string, Visualization>;
	onLayout: (layout: Layout) => void;
	onVisualization: (id: string, visualization: Visualization) => void;
}) {
	const { width, containerRef, mounted } = useContainerWidth({
		initialWidth: 1200,
	});
	const isStacked = width < 768;
	const renderedLayout = useMemo(
		() => (isStacked ? stackLayout(layout) : layout),
		[isStacked, layout],
	);
	const dragStart = useRef<Layout>(layout);
	const latest = useRef<Layout>(layout);

	useEffect(() => {
		latest.current = layout;
	}, [layout]);

	function stopDrag(
		result: Layout,
		oldItem: LayoutItem | null,
		newItem: LayoutItem | null,
	) {
		if (!oldItem || !newItem) return;
		const target = dragStart.current.find(
			(item) =>
				item.i !== newItem.i &&
				item.x === newItem.x &&
				item.y === newItem.y &&
				item.w === newItem.w &&
				item.h === newItem.h,
		);
		if (!target) return;
		onLayout(
			result.map((item) =>
				item.i === target.i
					? { ...item, x: oldItem.x, y: oldItem.y }
					: item.i === newItem.i
						? { ...item, x: target.x, y: target.y }
						: item,
			),
		);
	}

	return (
		<div ref={containerRef}>
			{mounted ? (
				<ReactGridLayout
					width={width}
					layout={renderedLayout}
					gridConfig={{
						cols: 24,
						rowHeight: 38,
						margin: [8, 8],
						containerPadding: [0, 0],
					}}
					dragConfig={{
						enabled: editing && !isStacked,
						handle: ".atlas-card-drag",
						bounded: true,
					}}
					resizeConfig={{
						enabled: editing && !isStacked,
						handles: ["se"],
					}}
					className="atlas-grid"
					data-editing={editing}
					onLayoutChange={(next) => {
						latest.current = next;
						if (editing && !isStacked) onLayout(next);
					}}
					onDragStart={() => {
						dragStart.current = latest.current;
					}}
					onDragStop={stopDrag}
				>
					{cards.map((card) => (
						<div key={card.id}>
							<QuestionCard
								card={card}
								editing={editing}
								visualization={visualizations[card.id] ?? card.visualization}
								onVisualization={(visualization) =>
									onVisualization(card.id, visualization)
								}
							/>
						</div>
					))}
				</ReactGridLayout>
			) : null}
		</div>
	);
}

export function AtlasDashboard({ number }: { number: number }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const dashboard = useQuery(
		trpc.atlasDashboards.byNumber.queryOptions({ number }),
	);
	const [tabNumber, setTabNumber] = useQueryState(
		"tab",
		parseAsInteger.withDefault(1).withOptions({ history: "push" }),
	);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<Layout>([]);
	const [visualizations, setVisualizations] = useState<
		Record<string, Visualization>
	>({});
	const save = useMutation(
		trpc.atlasDashboards.updateLayout.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(
					trpc.atlasDashboards.byNumber.queryFilter({ number }),
				);
				setEditing(false);
				toast.success("Dashboard layout saved");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const refresh = useMutation(
		trpc.atlasDashboards.refresh.mutationOptions({
			onSuccess: async (result) => {
				await queryClient.invalidateQueries(
					trpc.atlasDashboards.byNumber.queryFilter({ number }),
				);
				toast.success(
					result.cardsProcessed === 0
						? "No runnable questions yet. Review the KPI work below."
						: result.completed
							? `${result.cardsProcessed} questions ran and the dashboard is fresh`
							: `${result.cardsProcessed} questions ran · ${result.remainingQuestions} remaining`,
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const data = dashboard.data;
	const selectedTab =
		data?.tabs.find((tab) => tab.number === tabNumber) ?? data?.tabs[0];
	const baseCards = useMemo<DashboardCard[]>(
		() => data?.cards.filter((card) => card.tabId === selectedTab?.id) ?? [],
		[data?.cards, selectedTab?.id],
	);
	const pendingCards = useMemo(
		() => baseCards.filter((card) => !card.snapshot),
		[baseCards],
	);
	const readyCards = useMemo(
		() => baseCards.filter((card) => card.snapshot),
		[baseCards],
	);
	const visibleCards = editing ? baseCards : readyCards;

	useEffect(() => {
		if (!data || !selectedTab) return;
		if (tabNumber !== selectedTab.number) void setTabNumber(selectedTab.number);
	}, [data, selectedTab, setTabNumber, tabNumber]);

	function beginEditing() {
		setDraft(toLayout(baseCards));
		setVisualizations({});
		setEditing(true);
	}

	function saveLayout() {
		if (!selectedTab) return;
		const layout = new Map(draft.map((item) => [item.i, item]));
		save.mutate({
			number,
			tabNumber: selectedTab.number,
			items: baseCards.map((card) => {
				const item = layout.get(card.id);
				return {
					id: card.id,
					x: item?.x ?? card.x,
					y: item?.y ?? card.y,
					width: item?.w ?? card.width,
					height: item?.h ?? card.height,
					visualization: visualizations[card.id] ?? card.visualization,
				};
			}),
		});
	}

	if (!data) return <div className="h-96 animate-pulse rounded-lg bg-muted" />;
	const fresh =
		data.source?.freshnessDeadlineAt != null &&
		new Date(data.source.freshnessDeadlineAt).getTime() > Date.now();
	const sourceLabel = data.source?.label ?? "Source";
	const sourceUpdatedAt = data.source?.lastSyncAt ?? null;
	const sourceErrors = data.sources.filter(
		(source) => source.state === "ERROR",
	);
	const everySourceFailed =
		data.sources.length > 0 && sourceErrors.length === data.sources.length;

	return (
		<div className="flex flex-col gap-5">
			<header className="flex flex-col gap-4">
				<div>
					<p className="text-muted-foreground text-xs">
						Atlas dashboard {data.number}
					</p>
					<h1 className="mt-1 font-medium text-3xl tracking-tight">
						{data.name}
					</h1>
					<p className="mt-2 max-w-3xl text-muted-foreground text-sm">
						{data.description ??
							"Questions arranged into a shared operating view."}
					</p>
				</div>
				<div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<span className="rounded-full border border-border/70 bg-muted/35 px-2.5 py-1 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
							Calendar periods · UTC
						</span>
						<StatusIndicator
							tone={
								sourceErrors.length > 0
									? everySourceFailed
										? "error"
										: "warning"
									: fresh
										? "success"
										: "warning"
							}
							label={
								sourceErrors.length > 0 ? (
									`${sourceErrors.length} of ${data.sources.length} sources need attention`
								) : fresh ? (
									sourceUpdatedAt ? (
										<>
											{sourceLabel} snapshot ·{" "}
											<RelativeTimestamp value={sourceUpdatedAt} prefix="" />
										</>
									) : (
										`${sourceLabel} snapshot is fresh`
									)
								) : sourceUpdatedAt ? (
									<>
										{sourceLabel} data is stale ·{" "}
										<RelativeTimestamp value={sourceUpdatedAt} />
									</>
								) : (
									`${sourceLabel} data is stale`
								)
							}
							size="sm"
						/>
						<MetricTrustIndicator summary={data.verification} />
					</div>
					<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
						<RudyChatTrigger
							record={{ kind: "dashboard", id: String(data.number) }}
						/>
						<Button asChild variant="outline" size="sm">
							<Link href="/questions">Browse questions</Link>
						</Button>
						{data.sourceUrl ? (
							<Button asChild variant="outline" size="sm">
								<Link href={data.sourceUrl} target="_blank" rel="noreferrer">
									Open in HubSpot
								</Link>
							</Button>
						) : null}
						{data.source ? (
							<Button
								variant="outline"
								size="sm"
								disabled={refresh.isPending}
								onClick={() => refresh.mutate({ number })}
							>
								<Icon icon={Renew} />
								{refresh.isPending ? "Running questions" : "Run questions"}
							</Button>
						) : null}
						{editing ? (
							<>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setEditing(false)}
								>
									Cancel
								</Button>
								<Button
									size="sm"
									disabled={save.isPending}
									onClick={saveLayout}
								>
									<Icon icon={Save} />
									{save.isPending ? "Saving" : "Save layout"}
								</Button>
							</>
						) : (
							<Button variant="outline" size="sm" onClick={beginEditing}>
								<Icon icon={Edit} />
								Edit layout
							</Button>
						)}
					</div>
				</div>
			</header>

			<nav
				className="flex min-h-10 gap-5 overflow-x-auto border-b"
				aria-label="Dashboard tabs"
			>
				{data.tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => void setTabNumber(tab.number)}
						className={cn(
							"relative shrink-0 pb-3 text-sm text-muted-foreground",
							tab.number === selectedTab?.number &&
								"text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary",
						)}
					>
						{tab.name}
					</button>
				))}
			</nav>

			{sourceErrors.length > 0 ? (
				<div className="rounded-lg border bg-card p-4 text-sm">
					<p className="font-medium">
						{everySourceFailed
							? "Source refresh failed"
							: "Some KPIs could not refresh"}
					</p>
					<p className="mt-1 text-muted-foreground">
						{sourceErrors
							.map((source) =>
								source.lastError
									? `${source.label}: ${sourceErrorSummary(source.lastError)}`
									: `${source.label} needs attention`,
							)
							.join(" ")}
						{readyCards.length > 0
							? " Existing results remain visible below."
							: ""}
					</p>
				</div>
			) : null}

			{!editing ? <PendingKpiRail cards={pendingCards} /> : null}

			{visibleCards.length > 0 ? (
				<AtlasGrid
					cards={visibleCards}
					editing={editing}
					layout={editing ? draft : toLayout(visibleCards)}
					visualizations={visualizations}
					onLayout={setDraft}
					onVisualization={(id, visualization) =>
						setVisualizations((current) => ({
							...current,
							[id]: visualization,
						}))
					}
				/>
			) : pendingCards.length === 0 ? (
				<div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
					<p className="font-medium">No questions on this tab yet</p>
					<p className="mt-1 max-w-sm text-muted-foreground text-sm">
						Refresh the Metabase source or add an Atlas question to this
						dashboard.
					</p>
				</div>
			) : null}
		</div>
	);
}
