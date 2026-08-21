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
		"How did total accrued value change for the same professional organizations two calendar months later? Atlas divides the later value by the starting-month value. An organization with no later value contributes zero. Why it matters: It shows whether the same group grew or shrank in value.",
	"V2 self-serve - Professional orgs + activated pool trend":
		"Shows the monthly number of activated and professional Billing V2 self-serve organizations. Activated organizations completed at least 3 billable generations on at least 2 separate UTC days. Professional organizations also reached at least $100 in accrued value. Why it matters: It shows the size of the qualified customer base and the pool that can feed it.",
	"V2 self-serve - M3 requalification + NDR":
		"Shows two Month 3 retention measures for each starting professional group. Requalification is the share that met the professional rules again two calendar months later. Net dollar retention compares the group’s later accrued value with its starting value. Why it matters: It shows whether organizations return and whether their value grows or shrinks.",
	"V2 self-serve - Activated to professional rate":
		"What share of activated Billing V2 self-serve organizations also reached at least $100 in accrued value in the same UTC month? Why it matters: It shows how much of the activated pool becomes professional.",
	"V2 self-serve - 14d return + activation rates":
		"For organizations with a first completed generation, what share returned on another UTC day and what share completed at least 3 generations on at least 2 separate UTC days within 14 days? Only groups with a full 14-day observation window are included. Why it matters: It shows whether new organizations return and build an early usage habit.",
	"V2 self-serve - 30d product-led subscription conversion":
		"Of the organizations that completed a generation before subscribing, what share started a subscription within 30 days? Only groups with a full 30-day observation window are included. Why it matters: It measures paid conversion after real product use.",
	"V2 self-serve - Accrued value from professional orgs":
		"How much accrued usage value came from Billing V2 self-serve organizations that met the professional rules in each complete UTC month? Why it matters: It shows the value behind the professional-organization count.",
	"V2 self-serve - Weekly generation completion rate":
		"What share of non-deleted Billing V2 self-serve generations finished with the final status Completed in each UTC week? Why it matters: It is a reliability check for the main generation flow.",
	"V2 self-serve - Paid-qualified professional org-months":
		"What share of professional organization-months also had at least $100 of paid subscription and usage invoices in the same UTC month? Why it matters: It shows whether accrued product value is turning into paid Billing V2 revenue.",
	"Professional orgs with a user who deleted their account after qualifying":
		"Counts professional organizations where a contributing user later deleted their account. The organization stays in the historical professional count. Why it matters: It separates strong past product use from a later account-deletion signal.",
	"V3 cohort - Primary professional orgs":
		"How many Billing V3 self-serve organizations reached at least $100 in accrued value and completed at least 3 billable generations on at least 2 separate UTC days in a complete month? Enterprise organizations are excluded. Why it matters: It applies the same professional-use rule to the newer billing group.",
	"V3 cohort - Activated org pool":
		"How many Billing V3 self-serve organizations completed at least 3 billable generations on at least 2 separate UTC days in a complete month? The $100 accrued-value rule does not apply. Enterprise organizations are excluded. Why it matters: It is the pool that can become professional.",
	"V3 cohort - M3 requalification":
		"Of the Billing V3 organizations that were professional in the starting month, what share met the same rules again two calendar months later? Only fully observed groups are included. Why it matters: It shows whether professional Billing V3 organizations keep qualifying.",
	"V3 cohort - M3 accrued NDR":
		"How did accrued value change for the same Billing V3 professional organizations two calendar months later? Atlas divides their later value by their starting value. Only fully observed groups are included. Why it matters: It shows whether the same Billing V3 group grew or shrank in value.",
	"V3 cohort - M3 retention placeholder":
		"Shows when enough Billing V3 professional organizations have reached Month 3 to calculate requalification and net dollar retention. Why it matters: It prevents Atlas from presenting an immature retention result as meaningful.",
	"V3 cohort - Leading adoption metrics":
		"Shows new Billing V3 organizations, organizations with generation activity, and completed generations by UTC month. The current month is partial. Enterprise organizations are excluded. Why it matters: It gives an early adoption read while the Month 3 groups are still maturing.",
	"V3 cohort - 14d second-day return + activation":
		"For Billing V3 organizations with a first completed generation, what share returned on another UTC day and what share completed at least 3 generations on at least 2 separate UTC days within 14 days? Why it matters: It shows whether new Billing V3 organizations return and build an early usage habit.",
	"V3 cohort - Activated org-months reaching professional":
		"What share of activated Billing V3 self-serve organizations also reached at least $100 in accrued value in the same UTC month? Enterprise organizations are excluded. Why it matters: It shows how much of the activated Billing V3 pool becomes professional.",
	"V3 cohort - 30d product-led subscription conversion":
		"Of the Billing V3 organizations that completed a generation before subscribing, what share started a subscription within 30 days? Only fully observed groups are included. Why it matters: It measures paid conversion after real product use.",
	"V3 cohort - Paid-plan usage and accrued value":
		"Shows Billing V3 self-serve organizations with paid-plan generation activity, their completed generations, and the related accrued usage value by UTC month. The current month is partial. Why it matters: It measures product use, but not new revenue. Billing V3 revenue comes from subscriptions and top-up payments.",
	"V3 cohort - Paid-qualified placeholder":
		"Shows when enough professional Billing V3 organization-months exist to compare accrued value with paid subscriptions and top-up payments. Why it matters: It prevents Atlas from treating credit consumption as new revenue or publishing an immature rate.",
	"V3 cohort - Weekly generation completion rate":
		"What share of non-deleted Billing V3 generations finished with the final status Completed in each UTC week? Why it matters: It is a reliability check for the Billing V3 generation flow.",
	"Professional orgs by surface":
		"Shows professional Billing V2 self-serve organizations by the surface they used: API or non-API product flows. Why it matters: It shows where the qualified customer base is coming from.",
	"Activated org pool by surface":
		"Shows activated Billing V2 self-serve organizations by the surface they used: API or non-API product flows. Why it matters: It shows which surface supplies the pool that can become professional.",
	"Activated to professional rate by surface":
		"For API and non-API product flows, what share of activated Billing V2 organizations also became professional in the same UTC month? Why it matters: It compares how often each surface reaches the $100 accrued-value rule.",
	"Professional accrued value by surface":
		"Shows accrued usage value from professional Billing V2 organizations, split between API and non-API product flows. Why it matters: It shows which surface produces the most value from professional organizations.",
	"Weekly completion rate by surface":
		"Shows the weekly generation completion rate for API and non-API Billing V2 product flows. Why it matters: It makes reliability differences between the two surfaces visible.",
	"M3 requalification by surface":
		"For API and non-API Billing V2 product flows, what share of each starting professional group met the professional rules again two calendar months later? Why it matters: It compares repeat professional use by surface.",
	"M3 accrued NDR by surface":
		"For API and non-API Billing V2 product flows, how did accrued value from the same starting professional group change two calendar months later? Why it matters: It compares retained value by surface.",
	"Coverage — latest month (target 25%)":
		"What share of eligible completed generations received a saved rating in the latest complete UTC month? The target is 25%. Why it matters: It shows whether the team is collecting enough feedback to judge product quality.",
	"Upvote rate, monthly by model":
		"For each model and UTC month, what share of saved ratings were positive? Models with too few ratings should be treated as directional. Why it matters: It shows which models users rate most positively.",
	"First-result score: monthly average and promoter share":
		"Shows the average first-result score and the share of high and low scores by UTC month. Scores use a 1-to-5 scale. Why it matters: It measures the first result, which strongly affects whether a new organization returns.",
	"Upvote rate and volume: first generation vs beyond":
		"Compares positive-rating share and rating count for an organization’s first completed generation versus later generations. Why it matters: It shows whether first experiences are rated differently from established use.",
	"First generation coverage — latest week":
		"What share of organizations’ first completed generations received a saved rating in the latest complete UTC week? Why it matters: It checks whether Atlas captures feedback on the first product experience.",
	"Upvote rate by workflow (last 90 days)":
		"For each product workflow, what share of saved ratings were positive during the last 90 days? Workflows with too few ratings are excluded. Why it matters: It shows where users report the strongest and weakest results.",
	"First generation vs overall coverage, weekly":
		"Compares weekly rating coverage for organizations’ first completed generations with rating coverage for all eligible completed generations. Why it matters: It shows whether feedback collection is improving for the first experience and for the product overall.",
	"Coverage, monthly, against the 25% target":
		"Shows monthly rating coverage for all eligible completed generations and for first completed generations, compared with the 25% target. Why it matters: It makes the feedback-data gap visible without mixing incompatible denominators.",
	"First generation: coverage and upvote share by workflow":
		"For each workflow, shows how often an organization’s first completed generation received a rating and what share of those ratings were positive. Why it matters: It identifies first-use workflows that need better quality or better feedback capture.",
	"Coverage and upvote rate by model (last 90 days)":
		"For each model, shows rating coverage and positive-rating share during the last 90 days. Low-volume models are excluded. Why it matters: It separates how often users rate a model from how positively they rate it.",
	"Coverage by workflow: all vs first generation":
		"For each workflow, compares rating coverage for all eligible completed generations with coverage for organizations’ first completed generation. Why it matters: It shows where feedback is missing from the first experience or from ongoing use.",
	"LLM-inferred defect categories (historical vocabulary)":
		"Groups historical written feedback into defect categories using an automated text classifier. Feedback with no usable text stays unclassified. Why it matters: It helps summarize older free-text feedback, but it is not a user-selected label.",
	"Product blockers on low star scores, by context":
		"Shows the blockers selected when a user gave a first-result score of 1, 2, or 3, split by product context. Why it matters: It identifies the main reasons behind low first-result scores.",
	"Attribution 01 - Signups → activated → professional by source":
		"For each acquisition source, shows new organizations, organizations that activated, and organizations that ever became professional. The view starts on June 12, 2026, when server-side attribution began. Internal organizations are excluded. Why it matters: It shows which channels produce qualified product use, not only signups.",
	"Attribution 02 - Weekly signups by source":
		"Shows new organizations by acquisition source and UTC week since server-side attribution began. The current week is partial. Why it matters: It shows how the acquisition mix changes over time.",
	"Attribution 03 - Unknown-attribution rate, weekly":
		"Shows the weekly share of new organizations with no captured acquisition source. Since August 17, 2026, a visitor with no referrer is recorded as Direct, so later Unknown results mainly mean missing capture, older traffic, or bot activity. Why it matters: It is the data-quality check for every attribution result.",
	"Attribution 04 - Campaign detail (tagged traffic only)":
		"Shows signup, activation, and professional conversion for traffic with a campaign tag or advertising click identifier. Why it matters: It is the campaign-level view used to compare paid acquisition once campaigns have enough volume.",
	"Attribution 05 - Rollup provenance (data quality)":
		"Shows how each organization received its attribution: at signup, from the creating user, from partner provisioning, from a later backfill, or not at all. Why it matters: It makes the origin and limits of the attribution data visible.",
	"Cash per paid-org month · live":
		"Compares cash collected per month of paid time for the Billing V2 control group and Billing V3 treatment group. Organizations need at least 14 days of paid history to enter the sample. Why it matters: It compares cash generation while accounting for different paid tenure.",
	"30-day churn · live":
		"Compares the share of paying Billing V2 and Billing V3 organizations that churned within 30 days. Only organizations with a complete 30-day observation window are included. Why it matters: It gives the first comparable retention signal for the billing experiment.",
	"Implied cash LTV · live":
		"Estimates customer lifetime value by dividing cash per paid-organization month by the observed 30-day churn rate. This is a directional estimate, not observed lifetime revenue. Why it matters: It combines early cash and retention into one cautious comparison.",
	"Current experiment read · methodology detail":
		"Shows the inputs behind the current Billing V2 versus Billing V3 read: cash, paid time, churn counts, uncertainty range, implied lifetime, and implied customer lifetime value. Why it matters: It lets the team inspect the calculation instead of trusting only the headline.",
	"Live experiment enrollment funnel":
		"Shows assigned organizations, paid converters, organizations old enough for the cash sample, and organizations with complete 30-day and 60-day observation windows. Internal, disabled, and banned organizations are excluded. Why it matters: It shows whether the experiment has enough mature data to support a decision.",
	"Live cash, churn & implied LTV":
		"Shows the current Billing V2 versus Billing V3 cash, churn, and estimated customer lifetime value from fixed experiment assignments and deduplicated Stripe payments. Published historical reads do not change when late data arrives. Why it matters: It is the versioned summary of the billing experiment.",
	"Experiment maturity milestones":
		"Shows the dates when enough Billing V2 and Billing V3 organizations should have complete 30-day and 60-day observation windows, plus the first Billing V3 credit-expiry event. Why it matters: It states when each experiment result becomes readable.",
	"Reactivation funnel by send — manual + automated":
		"For each drop-off or win-back email send, shows recipients, delivery, opens, clicks, later product return, and later professional requalification. Returning means any generation after the email; requalification means meeting the professional rules again. Why it matters: It measures product return, not only email engagement. There is no holdout group, so the result is not proof that the email caused the return.",
	"Did opening or clicking predict coming back?":
		"Compares later product return and professional requalification for recipients who did not engage, opened without clicking, or clicked. The clicked groups are small and there is no holdout. Why it matters: It shows whether email engagement is associated with return, but it does not prove causation.",
	"Natural requalification baseline by churn month":
		"For each month when professional organizations stopped qualifying, shows the share that qualified again within one, two, or three months without relying on an email send. Recent groups are incomplete. Why it matters: It gives the natural return rate that a reactivation campaign must beat.",
	"Generation success rate today":
		"What share of generations created since 00:00 UTC today are not marked Failed? Null and in-progress statuses count as non-failed, so this is not a strict completion rate. Why it matters: It is a fast warning signal for generation failures today.",
	"Generation success rate this week":
		"What share of generations created since 00:00 UTC Monday are not marked Failed? Null and in-progress statuses count as non-failed, so this is not a strict completion rate. Why it matters: It is a fast warning signal for generation failures this week.",
	"Weekly generation success rate":
		"Shows the share of generations not marked Failed for each of the latest 10 UTC weeks. The current week is partial, and null or in-progress statuses count as non-failed. Why it matters: It shows whether the failure signal is improving or getting worse over time.",
	"Generation success by model":
		"Shows the seven-day non-failure rate and generation count for each model. Null and in-progress statuses count as non-failed. Why it matters: It helps find a model-specific reliability problem while keeping volume in view.",
	"Generation success by input type":
		"Shows the seven-day non-failure rate, generation count, and frame count for video and image inputs. Null and in-progress statuses count as non-failed. Why it matters: It helps find reliability differences between input types.",
	"Failure rate by hour today":
		"Shows failed generations as a share of all generations for each UTC hour today. Why it matters: It makes a sudden reliability incident visible within the day.",
	"Failed generations":
		"Lists every non-deleted failed generation from the last 24 hours, newest first. Sensitive URLs, tokens, and raw payloads are removed. Why it matters: It gives the team an exportable list for incident review.",
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
	"Triage queue — newest negative ratings with job ids and artifacts":
		"Lists the newest negative ratings with the related generation, job reference, and saved artifacts so the team can review and assign each issue. Why it matters: It gives the team one queue for investigating recent quality problems.",
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
