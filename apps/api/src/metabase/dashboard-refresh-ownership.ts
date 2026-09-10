import schedules from "./dashboard-schedules.json";

export const scheduledMetabaseDashboards = schedules.map(
	({ number }) => number,
);

export function ownsScheduledSource(dashboard: number, placements: number[]) {
	return (
		!scheduledMetabaseDashboards.includes(dashboard) ||
		(scheduledMetabaseDashboards.find((number) =>
			placements.includes(number),
		) ?? dashboard) === dashboard
	);
}
