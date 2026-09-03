export type ChartColumn = {
	name: string;
};

export type ChartDatum = Record<string, string | number>;

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

export function isPercentMetric(name: string): boolean {
	if (/cohort spend|spend_usd/i.test(name)) return false;
	return (
		/percent|pct|requalification|ndr|conversion/i.test(name) ||
		(/margin/i.test(name) && !/margin_usd|margin usd/i.test(name)) ||
		(/rate/i.test(name) && !/run.?rate/i.test(name))
	);
}

export function visualizationRecord(value: unknown): Record<string, unknown> {
	return settingsRecord(value) ?? {};
}

export function buildChartData(
	columns: ChartColumn[],
	rows: unknown[][],
	visualization: unknown,
): { data: ChartDatum[]; xKey: string; series: string[] } {
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
	const series =
		configuredMetrics === null
			? columns.flatMap((column, index) => {
					if (
						column.name === xKey ||
						dimensions.includes(column.name) ||
						METADATA_COLUMN.test(column.name) ||
						!rows.some((row) => typeof row[index] === "number")
					) {
						return [];
					}
					return [column.name];
				})
			: unique(
					configuredMetrics.filter(
						(name) => name !== xKey && columnNames.has(name),
					),
				);

	return {
		xKey,
		series,
		data: rows.map(
			(row) =>
				Object.fromEntries(
					columns.flatMap((column, index) => {
						const cell = row[index];
						return typeof cell === "number" || typeof cell === "string"
							? [[column.name, cell]]
							: [];
					}),
				) as ChartDatum,
		),
	};
}
