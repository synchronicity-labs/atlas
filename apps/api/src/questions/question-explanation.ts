type QuestionExplanationInput = {
	name: string;
	description?: string | null;
	metricDescription?: string | null;
	catalogDescription?: string | null;
};

const EXPLANATIONS_BY_NAME: Record<string, string> = {
	"V2 self-serve - Primary professional orgs":
		"How many V2 self-serve organizations reached $100+ accrued value and completed 3+ billable generations on 2+ distinct UTC days in a complete month? Why it matters: This is the main measure of qualified self-serve organizations.",
	"V2 self-serve - Activated org pool":
		"How many V2 self-serve organizations completed 3+ billable generations on 2+ distinct UTC days in a complete month? The $100+ accrued-value rule does not apply here. Why it matters: This is the pool that can become professional.",
	"V2 self-serve - M3 requalification":
		"Of the organizations that were professional in the starting month, what share met the same rules again two calendar months later? Why it matters: It shows whether professional organizations keep qualifying.",
	"V2 self-serve - M3 accrued NDR":
		"How did total accrued value change for the same professional organizations two calendar months later? Atlas divides their later value by their starting-month value. An organization with no later value contributes zero. Why it matters: It shows whether the group’s economic value grew or shrank.",
	"Product accrual run-rate":
		"Adds monthly usage incurred when generations finish to the licensed invoice-item base. This is a run-rate reconstruction, not cash collected or recognized revenue. Why it matters: It shows the monthly product revenue pace used in the original Revenue close model.",
	"Paid usage accrual":
		"Sums generation value in the UTC month when each generation finished. This is usage incurred, not an invoice or cash receipt. Why it matters: It isolates the usage part of the product run-rate.",
	"Licensed subscription base proxy":
		"Sums licensed Stripe invoice-item value after keeping one latest state per invoice-item id. This is an invoice-item proxy, not the live active-subscription base. Why it matters: It estimates the subscription part of the original product run-rate.",
	"Paid customer monthly revenue":
		"Sums the warehouse paid-customer revenue table by UTC month. This is the native SQL version of Metabase question 1256. Atlas only marks it verified when both versions match for the same months. Why it matters: It gives the revenue close an auditable paid-customer total.",
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
	"Estimated self-serve month-end revenue":
		"What will self-serve revenue be by the end of the current UTC month if the month-to-date pace continues? Atlas adds the current V2 and V3 subscription value, estimated V2 postpaid usage, and estimated V3 top-up payments. This is an open-month operating estimate, not booked revenue or cash collected. Why it matters: It gives an early view of the full-month self-serve result.",
	"Self-serve revenue history and current-month pace":
		"How did self-serve revenue change by month? Complete months use actual V2 and V3 subscription value, V2 postpaid usage, and V3 top-up payments. Only the open month includes a month-end estimate. Why it matters: It shows the actual revenue mix and the current month’s direction without treating V3 credit consumption as new revenue.",
	"Self-serve subscription run-rate by billing type and plan":
		"What is the monthly value of active or past-due self-serve subscriptions, split by billing type and plan? Atlas reads each plan’s recurring licensed price and quantity from Stripe. Hobbyist, Creator, Growth, and Scale are V2; every other allowed self-serve plan is V3. Why it matters: It shows the recurring base and lets new V3 plans appear without a code change.",
	"Estimated self-serve V2 usage month-end":
		"What will V2 postpaid usage revenue be by the end of the current UTC month if the month-to-date pace continues? Complete months use actual successful usage grouped by generation finish time. Failed generations and V3 credit consumption are excluded. Why it matters: It isolates the variable revenue produced by V2 usage.",
	"Self-serve subscription run-rate":
		"What is the current monthly value of active or past-due V2 and V3 self-serve subscriptions? Atlas reads the recurring licensed price and quantity from Stripe and compares the result with the previous month-end. Why it matters: It shows the recurring part of self-serve revenue separately from usage and top-ups.",
	"Estimated self-serve V3 top-ups month-end":
		"What will successful V3 top-up payments total by the end of the current UTC month if the month-to-date pace continues? V3 credit consumption is excluded because it spends prepaid credits instead of creating new revenue. Why it matters: It isolates the variable revenue event for V3.",
	"Estimated self-serve variable revenue month-end":
		"What will variable self-serve revenue be by the end of the current UTC month if the month-to-date pace continues? Atlas adds estimated V2 postpaid usage and estimated V3 top-up payments. Subscription value and V3 credit consumption are excluded. Why it matters: It compares the two variable billing paths without double counting revenue.",
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

	return `“${name}” does not have a plain-language definition yet. Treat the result as a draft until the metric owner confirms what it should measure. Why it matters: Atlas should not present an unexplained number as trusted.`;
}
