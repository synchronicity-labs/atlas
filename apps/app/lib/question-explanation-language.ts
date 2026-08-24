function humanize(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replaceAll("_", " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeMetricLanguage(value: string): string {
	return value
		.replace(/\bat least\s+100\s+USD\b/gi, "$100+")
		.replace(/\b100\s+USD\b/gi, "$100+")
		.replace(
			/\bthree\s+completed\s+billable\s+generations\b/gi,
			"3+ billable generations",
		)
		.replace(/\bthree\s+billable\s+generations\b/gi, "3+ billable generations")
		.replace(
			/\bthree\s+completed\s+generations\b/gi,
			"3+ completed generations",
		)
		.replace(
			/\b(?:two|2\+)\s+active\s+days\b/gi,
			"generations on 2+ distinct UTC days",
		)
		.replace(/\bat least\s+two\s+distinct\s+days\b/gi, "2+ distinct UTC days")
		.replace(/\btwo\s+distinct\s+days\b/gi, "2+ distinct UTC days");
}

const VALUE_LABELS: Record<string, string> = {
	accrued_operating_value: "Accrued subscription value plus completed usage",
	activated_organization_months: "Organizations that met the activation rule",
	all_non_deleted_generations: "All generations that were not deleted",
	completed_non_deleted_generations:
		"Generations that finished successfully and were not deleted",
	first_generation_organization:
		"One organization, grouped by its first completed generation",
	organization_month: "One organization per UTC month",
	professional_organization_month:
		"One professional organization per UTC month",
	professional_organization_months:
		"Organizations that met the professional rule",
	same_cohort_month_three_accrued_value:
		"Accrued value from the same organizations two calendar months later",
	starting_month_accrued_value:
		"Accrued value from those organizations in the starting month",
	starting_professional_organization_cohort:
		"Organizations that met the professional definition in the starting month",
	v2_self_serve: "V2 self-serve plans",
};

const RULE_LABELS: Record<string, string> = {
	billingType: "Billing type",
	breakdowns: "Shown by",
	cohort: "Starting organizations",
	comparison: "Comparison",
	currentMonth: "Current month",
	entity: "What is counted",
	excluded: "Excluded",
	excludedPlans: "Excluded plans",
	formula: "How it is calculated",
	includedPlans: "Included plans",
	includedStatuses: "Subscription status",
	currentMonthOffset: "When Atlas checks again",
	denominator: "Starting amount",
	minimumActiveDays: "Required active days",
	minimumCompletedBillableGenerations: "Required generations",
	minimumCompletedGenerations: "Required generations",
	maturityDays: "Observation window",
	numerator: "Later amount",
	population: "Who is included",
	professional: "Professional organization rule",
	professionalDefinition: "Professional organization rule",
	requalificationMonthOffset: "When Atlas checks again",
	revenueDoor: "Revenue group",
	secondDayReturn: "Returned on another day",
	activation: "Activated within the window",
	conversion: "Started a subscription",
	timeField: "Revenue month",
	periodAssignment: "Assigned to a period by",
	valueBasis: "Value counted",
};

const HIDDEN_RULE_KEYS = new Set([
	"activeDayDefinition",
	"billableDefinition",
	"cashBasis",
	"completedStatus",
	"definition",
	"definitionState",
	"questionName",
	"questionNumber",
	"sourcePlanSnapshot",
	"statusBasis",
]);

const RULE_ORDER: Record<string, number> = {
	entity: 0,
	population: 1,
	revenueDoor: 2,
	cohort: 3,
	professional: 4,
	professionalDefinition: 4,
	minimumCompletedGenerations: 5,
	minimumCompletedBillableGenerations: 5,
	minimumActiveDays: 6,
	billingType: 7,
	includedStatuses: 8,
	includedPlans: 9,
	excludedPlans: 10,
	timeField: 11,
	periodAssignment: 11,
	valueBasis: 12,
	formula: 13,
	denominator: 14,
	numerator: 15,
	comparison: 16,
	currentMonth: 17,
	currentMonthOffset: 18,
	requalificationMonthOffset: 18,
};

const THRESHOLD_ORDER: Record<string, number> = {
	minimumAccruedValueUsd: 0,
	minimumCompletedBillableGenerations: 1,
	minimumActiveDays: 2,
};

function explainThreshold(key: string, value: unknown): string | null {
	if (typeof value !== "number") return null;
	switch (key) {
		case "minimumAccruedValueUsd":
			return `At least $${value.toLocaleString("en-US")} in accrued value`;
		case "minimumCompletedBillableGenerations":
			return `At least ${value} completed billable generations`;
		case "minimumCompletedGenerations":
			return `At least ${value} completed generations`;
		case "minimumActiveDays":
			return `Completed generations on at least ${value} separate UTC days`;
		case "currentMonthOffset":
		case "requalificationMonthOffset":
			return `${value} months after the starting month (M+${value})`;
		default:
			return null;
	}
}

function explainProfessionalRule(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const rule = value as Record<string, unknown>;
	const accrued =
		typeof rule.minimumAccruedValueUsd === "number"
			? `at least $${rule.minimumAccruedValueUsd.toLocaleString("en-US")} in accrued value`
			: null;
	const generations =
		typeof rule.minimumCompletedBillableGenerations === "number"
			? `at least ${rule.minimumCompletedBillableGenerations} completed billable generations`
			: null;
	const days =
		typeof rule.minimumActiveDays === "number"
			? `activity on at least ${rule.minimumActiveDays} separate UTC days`
			: null;
	const requirements = [accrued, generations, days].filter(Boolean);
	if (requirements.length === 0) return null;
	return requirements.join(", ").replace(/, ([^,]+)$/, ", and $1");
}

function explainValue(value: unknown, key = ""): string {
	if (value === null || value === undefined) return "Not set";
	if (typeof value === "boolean") return value ? "Yes" : "No";
	if (key === "professional") {
		const professionalRule = explainProfessionalRule(value);
		if (professionalRule) return professionalRule;
	}
	const threshold = explainThreshold(key, value);
	if (threshold) return threshold;
	if (Array.isArray(value))
		return value.map((item) => explainValue(item)).join(", ");
	if (typeof value === "object") {
		const entries = Object.entries(value).sort(
			([left], [right]) =>
				(THRESHOLD_ORDER[left] ?? 99) - (THRESHOLD_ORDER[right] ?? 99),
		);
		const thresholdGroup = entries.every(
			([nestedKey]) => THRESHOLD_ORDER[nestedKey] !== undefined,
		);
		return entries
			.map(([nestedKey, nested]) => {
				const explained = explainValue(nested, nestedKey);
				return thresholdGroup
					? explained
					: `${RULE_LABELS[nestedKey] ?? humanize(nestedKey)}: ${explained}`;
			})
			.join(" · ");
	}
	const raw = String(value);
	if (key === "periodAssignment" || key === "timeField") {
		if (/generationCreatedAt|created_at/i.test(raw)) {
			return "The UTC month when the generation started and its plan was recorded";
		}
		if (/generationEndedAt/i.test(raw)) {
			return "The UTC month when the generation finished and its final billable cost became known";
		}
	}
	if (key === "valueBasis" && /generationCostMillicents/i.test(raw)) {
		return "The final generation cost converted from millicents to US dollars";
	}
	const normalized = normalizeMetricLanguage(
		VALUE_LABELS[raw] ?? raw.replaceAll("_", " "),
	);
	if (key === "professionalDefinition") {
		return normalized.replace(/,\s*(?:and\s+)?/g, " · ");
	}
	return normalized;
}

export function definitionRows(definition: unknown) {
	if (
		!definition ||
		typeof definition !== "object" ||
		Array.isArray(definition)
	) {
		return [];
	}
	return Object.entries(definition)
		.filter(([key]) => !HIDDEN_RULE_KEYS.has(key))
		.sort(
			([left], [right]) => (RULE_ORDER[left] ?? 99) - (RULE_ORDER[right] ?? 99),
		)
		.map(([key, value]) => ({
			label: RULE_LABELS[key] ?? humanize(key),
			value: explainValue(value, key),
		}));
}
