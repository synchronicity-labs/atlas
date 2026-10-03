export const AVERAGE_TEAM_METRIC_IDS = [
	"company_teams",
	"plg_teams",
	"enterprise_teams",
	"channel_teams",
	"productions_teams",
] as const;

export function metricRowLabel(id: string, label: string) {
	if (
		AVERAGE_TEAM_METRIC_IDS.includes(
			id as (typeof AVERAGE_TEAM_METRIC_IDS)[number],
		)
	) {
		return `Average monthly · ${label}`;
	}
	if (id.endsWith("_teams_period_end")) return `Quarter end · ${label}`;
	return label;
}

export function metricSectionId(title: string) {
	return `north-star-${title.toLowerCase().replaceAll(" ", "-")}`;
}

export function formatNorthStarValue(
	value: number,
	unit: string,
	compact: boolean,
	exact = false,
) {
	if (exact) {
		const suffix =
			unit === "percent" ? "%" : unit === "months" ? " months" : "";
		return `${unit === "usd" ? "$" : ""}${value}${suffix}`;
	}
	const suffix = unit === "months" ? " months" : "";
	const options: Intl.NumberFormatOptions =
		unit === "usd"
			? {
					style: "currency",
					currency: "USD",
					maximumFractionDigits: compact ? 1 : 2,
				}
			: unit === "percent"
				? { style: "percent", maximumFractionDigits: 1 }
				: unit === "months"
					? { maximumFractionDigits: 1 }
					: { maximumFractionDigits: 0 };
	const formatter = new Intl.NumberFormat("en-US", {
		...options,
		...(compact ? { notation: "compact" as const } : {}),
	});
	return `${formatter.format(unit === "percent" ? value / 100 : value)}${suffix}`;
}
