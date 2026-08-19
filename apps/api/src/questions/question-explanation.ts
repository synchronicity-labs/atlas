type QuestionExplanationInput = {
	name: string;
	description?: string | null;
	metricDescription?: string | null;
	catalogDescription?: string | null;
};

const EXPLANATIONS_BY_NAME: Record<string, string> = {
	"V2 self-serve - Primary professional orgs":
		"Counts V2 self-serve organizations with $100+ accrued value and 3+ billable generations on 2+ distinct UTC days in a complete month. Why it matters: This is the main measure of qualified self-serve organizations.",
	"V2 self-serve - Activated org pool":
		"Counts V2 self-serve organizations with 3+ billable generations on 2+ distinct UTC days in a complete month. Why it matters: This is the pool that can become professional.",
	"V2 self-serve - M3 requalification":
		"Shows the share of a starting professional-organization cohort that meets the same professional threshold again two calendar months later. Why it matters: It shows whether professional organizations keep qualifying.",
	"V2 self-serve - M3 accrued NDR":
		"Compares the same starting cohort’s accrued value two calendar months later with its accrued value in the starting month. Why it matters: It shows whether that cohort’s economic value grew or shrank.",
	"Product accrual run-rate":
		"Adds monthly usage incurred when generations finish to the licensed invoice-item base. This is a run-rate reconstruction, not cash collected or recognized revenue. Why it matters: It shows the monthly product revenue pace used in the original Revenue close model.",
	"Paid usage accrual":
		"Sums generation value in the UTC month when each generation finished. This is usage incurred, not an invoice or cash receipt. Why it matters: It isolates the usage part of the product run-rate.",
	"Licensed subscription base proxy":
		"Sums licensed Stripe invoice-item value after keeping one latest state per invoice-item id. This is an invoice-item proxy, not the live active-subscription base. Why it matters: It estimates the subscription part of the original product run-rate.",
	"Paid customer monthly revenue":
		"Sums the warehouse paid-customer revenue table as a native SQL replacement for Metabase question 1256. Atlas compares both results on each refresh before it marks this question as verified.",
	"Stripe paid invoice collections":
		"Sums cash paid on Stripe invoices after keeping one latest state per invoice id. This is money collected, not invoices raised or recognized revenue. Why it matters: It reconciles the run-rate model with cash received.",
	"Stripe paid + open invoice billings":
		"Sums Stripe invoice amount due after keeping one latest state per invoice id, grouped by invoice creation month. This is invoices raised, not cash collected. Why it matters: It shows what was billed during the month.",
	"Usage-spend NDR":
		"Divides next-month usage from the fixed prior-month organization cohort by that cohort’s starting usage. Organizations with no next-month usage count as zero. Why it matters: It shows whether usage from the same customer cohort grew or shrank.",
	"Product run-rate composition · history + MTD":
		"Shows monthly usage incurred and the licensed invoice-item proxy as separate parts of the product run-rate reconstruction. The current month is month to date.",
	"Revenue reconciliation · history + MTD":
		"Shows paid-customer revenue, Stripe cash collected, and Stripe invoices raised side by side. These are different views and must not be added together. The current month is month to date.",
	"Usage-spend NDR · history + MTD":
		"Shows the fixed-cohort Usage-spend NDR calculation for each complete month pair in the history window. The current month is only included when the comparison period is available.",
	"Annualized product run-rate":
		"Multiplies the monthly product accrual run-rate by 12. This is a pace estimate, not a forecast or recognized annual revenue.",
	"Paid usage organizations":
		"Counts distinct organizations with paid-plan generation usage in each complete UTC month, using the generation finish time.",
	"NDR starting cohort spend":
		"Shows the starting-month usage for the fixed organization cohort. This is the denominator of Usage-spend NDR.",
	"NDR retained cohort spend":
		"Shows next-month usage from the fixed starting cohort. This is the numerator of Usage-spend NDR.",
	"Negative generation feedback":
		"Lists generations that received negative feedback so the team can inspect the affected user, model, workflow, and failure context.",
	"Coverage by surface, monthly":
		"Shows the share of generations that received feedback each month, split by product surface.",
	"Capture rate, weekly by surface — all terminal denominator":
		"Shows the weekly share of finished generation attempts that produced a saved feedback signal, split by product surface.",
	"Capture rate by model and surface (last 90 days)":
		"Compares the share of generation attempts with saved feedback across models and product surfaces over the last 90 days.",
	"Reason attach rate, monthly, by signal precision":
		"Shows how often saved feedback includes a reason each month, split by how precisely Atlas can interpret the signal.",
	"Defect tags by model and sync mode (pick rate)":
		"Shows which defect tags users select for each model and sync mode, as a share of feedback where a tag could be selected.",
	"Defect tags by input type combination (pipeline attribution)":
		"Shows which defect tags appear for each combination of input types, to identify which pipeline inputs are linked to quality problems.",
	"Upvote rate by model and surface (last 90 days)":
		"Compares the share of positive ratings across models and product surfaces over the last 90 days.",
	"Rating latency by surface — when to prompt":
		"Shows how long users wait before rating a result on each product surface, to help choose when to ask for feedback.",
	"First-result score placement accuracy by user history depth":
		"Checks whether the first-result score prompt appears at the intended point, split by how much prior product history the user has.",
	"Triage queue — newest negative ratings with artifacts":
		"Lists the newest negative ratings with the related generation artifacts so the team can review and assign each issue.",
	"Highlight tags — what is working (pick rate)":
		"Shows which positive highlight tags users select, as a share of feedback where a highlight could be selected.",
	"Failed-attempt reasons (feedback on FAILED and REJECTED)":
		"Groups the feedback reasons attached to generation attempts whose final status is failed or rejected.",
	"Guardrail: generations per paid org-month, by plan":
		"Shows the average number of generations for each paid organization-month, split by plan, to detect changes in usage depth.",
	"Guardrail: generations per paid org — latest month":
		"Shows the average number of generations per paid organization in the latest complete month.",
	"Ratings carrying a reason — latest month":
		"Shows the share of ratings in the latest complete month that include a written or selected reason.",
	"Upvote rate — latest month":
		"Shows the share of saved ratings that were positive in the latest complete month.",
};

function section(value: string, label: "Description" | "Why"): string | null {
	const match = value.match(
		new RegExp(
			`${label}:\\s*([\\s\\S]*?)(?=(?:Type|Input|Description|Why):|$)`,
			"i",
		),
	);
	return match?.[1]?.trim() || null;
}

function normalizeDescription(value: string): string {
	const description = section(value, "Description");
	if (!description) return normalizeMetricLanguage(value);
	const why = section(value, "Why");
	return normalizeMetricLanguage(
		why ? `${description} Why it matters: ${why}` : description,
	);
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

export function questionExplanation({
	name,
	description,
	metricDescription,
	catalogDescription,
}: QuestionExplanationInput): string {
	const knownExplanation = EXPLANATIONS_BY_NAME[name];
	if (knownExplanation) return normalizeMetricLanguage(knownExplanation);

	for (const value of [description, metricDescription, catalogDescription]) {
		const normalized = value?.trim();
		if (normalized) return normalizeDescription(normalized);
	}

	return `This question returns the data behind “${name}”. Open it to see the exact query, source, and timeframe.`;
}
