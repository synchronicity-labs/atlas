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

const MISSING_DEPENDENCIES = [
	{
		key: "production",
		title: "Production activity and executed SOWs",
		description:
			"Production activity, commercial records, and executed SOW evidence.",
		matches: (id: string) =>
			id.startsWith("productions_") || id.startsWith("production_"),
	},
	{
		key: "finance",
		title: "Finance close and approved revenue records",
		description:
			"Finance-approved close, allocation, and revenue reconciliation evidence.",
		matches: (id: string) =>
			id.startsWith("finance_") ||
			/^(company|plg|enterprise|channel)_revenue/.test(id),
	},
	{
		key: "paid-denominators",
		title: "Historical paid and active-customer denominators",
		description:
			"Historical paid status, eligibility, and customer activity records.",
		matches: (id: string) =>
			/active_rate|active_accounts|eligible_accounts|usage_retention|customers$/.test(
				id,
			),
	},
	{
		key: "commercial-records",
		title: "Commercial roster, agreements, SOWs, and parent mapping",
		description: "Historical team, agreement, and customer-parent records.",
		matches: (id: string) =>
			/teams|booked_revenue|annual_revenue_estimate|contract_retention|top(1|3|10)$/.test(
				id,
			),
	},
] as const;

export function groupMissingNorthStarMetrics<T extends { id: string }>(
	metrics: T[],
) {
	const groups: {
		key: string;
		title: string;
		description: string;
		metrics: T[];
	}[] = MISSING_DEPENDENCIES.map(({ key, title, description }) => ({
		key,
		title,
		description,
		metrics: [],
	}));
	const other: T[] = [];
	for (const metric of metrics) {
		const dependency = MISSING_DEPENDENCIES.find((candidate) =>
			candidate.matches(metric.id),
		);
		const group = groups.find((candidate) => candidate.key === dependency?.key);
		(group?.metrics ?? other).push(metric);
	}
	for (let index = groups.length - 1; index >= 0; index--) {
		if (!groups[index]?.metrics.length) groups.splice(index, 1);
	}
	if (other.length) {
		groups.push({
			key: "other",
			title: "Other pending inputs",
			description:
				"The source dependency is not identified by the current grouping.",
			metrics: other,
		});
	}
	return groups;
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
