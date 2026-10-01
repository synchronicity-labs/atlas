import type { RouterOutputs } from "@/lib/trpc/types";

export type QbrMetric = NonNullable<
	RouterOutputs["qbr"]["report"]["metrics"][string]
>;

const OWNER_TEAMS: Record<string, string> = {
	"Noah (tentative)": "Product",
	Pavan: "Finance",
	Sanjit: "Sales and Customer Success",
	Hadi: "Production",
	Ana: "Marketing",
	"Simran (tentative)": "ML",
	Tanmay: "Platform",
	Prajwal: "Research",
	Nacho: "Operations",
};

export function teamForOwner(owner: string) {
	return OWNER_TEAMS[owner] ?? "Unassigned";
}

export function teamId(label: string) {
	return label.toLowerCase().replaceAll(" ", "-");
}

export function sortedObservations(metric: QbrMetric) {
	return Object.entries(metric.observations).sort(([left], [right]) =>
		left.localeCompare(right),
	);
}

function hasCohortObservation(metric: QbrMetric) {
	return Object.values(metric.observations).some(
		(observation) => observation.cohortMonth,
	);
}

export function isManualMissing(metric: QbrMetric) {
	return (
		!metric.notApplicable &&
		!metric.automated &&
		!metric.observations["2026-Q3"] &&
		!hasCohortObservation(metric)
	);
}

export function isAtlasFollowup(metric: QbrMetric) {
	return (
		!metric.notApplicable &&
		metric.automated &&
		!metric.observations["2026-Q3"] &&
		!hasCohortObservation(metric)
	);
}

export function buildTeamRequest(
	team: string,
	metrics: [string, QbrMetric][],
	url: string,
) {
	const active = metrics.filter(([, metric]) => !metric.notApplicable);
	const supplied = active.filter(
		([, metric]) => Object.keys(metric.observations).length > 0,
	);
	const missing = active.filter(([, metric]) => isManualMissing(metric));
	const atlasFollowups = active.filter(([, metric]) => isAtlasFollowup(metric));
	return [
		`Hi ${team} team,`,
		"",
		`Please review the supplied observations and any follow-ups below. This is a review request; nothing here is certified.`,
		"",
		`Team review: ${url}`,
		...(supplied.length
			? [
					"",
					"Please verify these supplied observations:",
					...supplied.flatMap(([id, metric]) =>
						sortedObservations(metric).map(
							([period, observation]) =>
								`- ${metric.label} (${id}), ${period}${observation.cohortMonth ? ` (cohort ${observation.cohortMonth})` : ""}: ${observation.value} ${metric.unit}, ${observation.status}; Atlas question: ${metric.question?.url ?? "not registered"}; source: ${observation.evidenceSource.url}; as of ${observation.asOf}; data through ${observation.dataThrough ?? "unknown"}`,
						),
					),
				]
			: []),
		...(missing.length
			? [
					"",
					"Please provide these missing Q3 aggregates or inputs:",
					...missing.map(([id, metric]) => {
						const monthly = sortedObservations(metric)
							.map(
								([period, observation]) =>
									`${period}${observation.cohortMonth ? ` (cohort ${observation.cohortMonth})` : ""}: ${observation.value} ${metric.unit} (${observation.status})`,
							)
							.join(", ");
						return `- ${metric.label} (${id}): the Q3 aggregate is missing${monthly ? `; current monthly observations are ${monthly}` : "; no observations are saved"}.\n  Atlas question: ${metric.question?.url ?? "not registered"}\n  Manual ask: ${metric.preparation.manualAsk}\n  Collection location: ${metric.preparation.dataLocation}`;
					}),
				]
			: []),
		...(atlasFollowups.length
			? [
					"",
					"Atlas follow-up (Nacho): refresh source-complete data and calculate these missing Q3 results in Atlas:",
					...atlasFollowups.map(([id, metric]) => {
						const periods = sortedObservations(metric)
							.map(([period]) => period)
							.join(", ");
						return `- ${metric.label} (${id})${periods ? `; existing observations: ${periods}` : "; no observations are saved"}. Atlas question: ${metric.question?.url ?? "not registered"}.`;
					}),
				]
			: []),
	].join("\n");
}
