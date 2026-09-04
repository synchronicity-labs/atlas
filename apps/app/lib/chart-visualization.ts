export type ChartColumn = {
	name: string;
	displayName?: string | null;
};

export type ChartDatum = Record<string, string | number>;

export type ChartSeries = {
	key: string;
	metric: string;
	label: string;
};

export type ColumnVisualization = {
	title: string | null;
	suffix: string | null;
	decimals: number | null;
	numberStyle: string | null;
};

const METADATA_COLUMN =
	/(^|_)(period_end|window_end|data_through|captured_at)$/i;

function settingsRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function configuredColumns(
	visualization: unknown,
	key: "graph.dimensions" | "graph.metrics",
): string[] | null {
	const value = settingsRecord(visualization)?.[key];
	if (!Array.isArray(value)) return null;
	return value.filter((item): item is string => typeof item === "string");
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function humanize(value: string): string {
	return value
		.replaceAll("_", " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function columnSettings(
	visualization: unknown,
	name: string,
): Record<string, unknown> | null {
	const settings = settingsRecord(
		settingsRecord(visualization)?.column_settings,
	);
	if (!settings) return null;
	for (const [key, value] of Object.entries(settings)) {
		try {
			const reference = JSON.parse(key);
			if (
				Array.isArray(reference) &&
				reference[0] === "name" &&
				reference[1] === name
			) {
				return settingsRecord(value);
			}
		} catch {}
	}
	return null;
}

function scalar(value: unknown): string | number | null {
	return typeof value === "string" || typeof value === "number" ? value : null;
}

function inferredMetrics(
	columns: ChartColumn[],
	rows: unknown[][],
	dimensions: string[],
	xKey: string,
): string[] {
	return columns.flatMap((column, index) => {
		if (
			column.name === xKey ||
			dimensions.includes(column.name) ||
			METADATA_COLUMN.test(column.name) ||
			!rows.some((row) => typeof row[index] === "number")
		) {
			return [];
		}
		return [column.name];
	});
}

function sourceData(columns: ChartColumn[], rows: unknown[][]): ChartDatum[] {
	return rows.map(
		(row) =>
			Object.fromEntries(
				columns.flatMap((column, index) => {
					const cell = scalar(row[index]);
					return cell === null ? [] : [[column.name, cell]];
				}),
			) as ChartDatum,
	);
}

export function isPercentMetric(name: string): boolean {
	if (/cohort spend|spend_usd|ndr_(usd|amount|value)/i.test(name)) return false;
	return (
		/percent|pct|requalification|ndr|conversion/i.test(name) ||
		(/margin/i.test(name) && !/margin_usd|margin usd/i.test(name)) ||
		(/rate/i.test(name) && !/run.?rate/i.test(name))
	);
}

export function isCurrencyMetric(name: string): boolean {
	if (/(^|_)(usd|eur|gbp)($|_)/i.test(name)) return true;
	if (/cash|collect|usage.*incurred|invoice.*raised/i.test(name)) return true;
	if (
		/(^|_)(count|counts|customers|organizations|orgs|subscriptions|invoices|generations|contacts|users)($|_)/i.test(
			name,
		)
	) {
		return false;
	}
	return (
		/revenue|spend|cost|value|amount|pipeline|booking|forecast|accrual|run.?rate|subscription|invoice|collection|billing/i.test(
			name,
		) || /(^|[_\s])(arr|mrr|ltv)($|[_\s])/i.test(name)
	);
}

export function visualizationRecord(value: unknown): Record<string, unknown> {
	return settingsRecord(value) ?? {};
}

export function columnVisualization(
	visualization: unknown,
	name: string,
): ColumnVisualization {
	const settings = columnSettings(visualization, name);
	return {
		title:
			typeof settings?.column_title === "string" ? settings.column_title : null,
		suffix: typeof settings?.suffix === "string" ? settings.suffix : null,
		decimals:
			typeof settings?.decimals === "number" &&
			Number.isInteger(settings.decimals) &&
			settings.decimals >= 0
				? settings.decimals
				: null,
		numberStyle:
			typeof settings?.number_style === "string" ? settings.number_style : null,
	};
}

export function explicitRightAxisMetrics(visualization: unknown): Set<string> {
	const seriesSettings = settingsRecord(
		settingsRecord(visualization)?.series_settings,
	);
	if (!seriesSettings) return new Set();
	return new Set(
		Object.entries(seriesSettings).flatMap(([metric, value]) =>
			settingsRecord(value)?.axis === "right" ? [metric] : [],
		),
	);
}

export function metricDisplayFamily(
	name: string,
	visualization?: unknown,
): "percent" | "currency" | "number" {
	const setting = columnVisualization(visualization, name);
	if (
		setting.numberStyle === "percent" ||
		setting.suffix?.trim() === "%" ||
		isPercentMetric(name)
	) {
		return "percent";
	}
	if (setting.suffix?.toLowerCase().includes("usd")) return "currency";
	if (isCurrencyMetric(name)) return "currency";
	return "number";
}

export function compatibleChartSeries(
	series: ChartSeries[],
	visualization?: unknown,
): ChartSeries[] {
	const families = new Set(
		series.map((item) => metricDisplayFamily(item.metric, visualization)),
	);
	if (families.size <= 1) return series;
	const preferred = families.has("percent")
		? "percent"
		: families.has("currency")
			? "currency"
			: "number";
	return series.filter(
		(item) => metricDisplayFamily(item.metric, visualization) === preferred,
	);
}

export function buildChartData(
	columns: ChartColumn[],
	rows: unknown[][],
	visualization: unknown,
): { data: ChartDatum[]; xKey: string; series: ChartSeries[] } {
	const columnNames = new Set(columns.map((column) => column.name));
	const configuredDimensions = configuredColumns(
		visualization,
		"graph.dimensions",
	);
	const dimensions = unique(
		(configuredDimensions ?? []).filter((name) => columnNames.has(name)),
	);
	const xKey = dimensions[0] ?? columns[0]?.name ?? "period";
	const configuredMetrics = configuredColumns(visualization, "graph.metrics");
	const metrics =
		configuredMetrics === null
			? inferredMetrics(columns, rows, dimensions, xKey)
			: unique(
					configuredMetrics.filter(
						(name) => name !== xKey && columnNames.has(name),
					),
				);
	const columnByName = new Map(columns.map((column) => [column.name, column]));
	const metricLabel = (metric: string) => {
		const column = columnByName.get(metric);
		return (
			columnVisualization(visualization, metric).title ??
			humanize(column?.displayName ?? metric)
		);
	};

	if (dimensions.length <= 1) {
		return {
			xKey,
			series: metrics.map((metric) => ({
				key: metric,
				metric,
				label: metricLabel(metric),
			})),
			data: sourceData(columns, rows),
		};
	}

	const xIndex = columns.findIndex((column) => column.name === xKey);
	const groupIndexes = dimensions
		.slice(1)
		.map((dimension) =>
			columns.findIndex((column) => column.name === dimension),
		);
	const metricIndexes = new Map(
		metrics.map((metric) => [
			metric,
			columns.findIndex((column) => column.name === metric),
		]),
	);
	const points = new Map<string, ChartDatum>();
	const series = new Map<string, ChartSeries>();

	for (const row of rows) {
		const xValue = scalar(row[xIndex]);
		if (xValue === null) continue;
		const pointKey = `${typeof xValue}:${xValue}`;
		const point = points.get(pointKey) ?? { [xKey]: xValue };
		points.set(pointKey, point);
		const groupValues = groupIndexes.map(
			(index) => scalar(row[index]) ?? "Unknown",
		);
		const groupLabel = groupValues.join(" · ");
		for (const metric of metrics) {
			const value = scalar(row[metricIndexes.get(metric) ?? -1]);
			if (value === null) continue;
			const key = JSON.stringify([metric, ...groupValues]);
			point[key] = value;
			if (!series.has(key)) {
				series.set(key, {
					key,
					metric,
					label:
						metrics.length === 1
							? groupLabel
							: `${groupLabel} · ${metricLabel(metric)}`,
				});
			}
		}
	}

	return { xKey, series: [...series.values()], data: [...points.values()] };
}
