export type CatalogEvidenceCandidate = {
	questionNumber: number;
	rationale: string;
};

type CatalogEvidenceEntry = {
	title: string;
	ownerTeam: string | null;
};

export function catalogCanonicalQuestionNumber(
	entry: CatalogEvidenceEntry,
): number | null {
	const title = entry.title.trim().toLowerCase();
	const owner = entry.ownerTeam?.trim().toLowerCase() ?? "";
	if (title === "# of professional teams that used sync in the last month") {
		return 15;
	}
	if (title === "actualized revenue (monthly + ytd)") return 1006;
	if (title === "ndr") return 1105;
	if (title === "website visitors") return 2001;
	if (title === "visitor to signup conversion") return 2019;
	if (title === "seo / geo breakdown") return 2010;
	if (title === "mql / pql / sql breakdown") return 3025;
	if (title === "new logos closed (by segment)") return 3003;
	if (title === "enterprise usage" && owner === "cs") return 1103;
	return null;
}

const REVENUE_INTERPRETATIONS: CatalogEvidenceCandidate[] = [
	{
		questionNumber: 1005,
		rationale:
			"Shows Stripe cash collected. Use this to compare a cash interpretation with the requested KPI.",
	},
	{
		questionNumber: 1006,
		rationale:
			"Shows paid and open invoice billings. This is the closest current evidence for revenue booked when an invoice is raised.",
	},
	{
		questionNumber: 1102,
		rationale:
			"Shows current product run-rate from licensed subscriptions plus projected accrued usage. It is not booked or recognized revenue.",
	},
];

export function catalogEvidenceFor(
	entry: CatalogEvidenceEntry,
): CatalogEvidenceCandidate[] {
	const title = entry.title.trim().toLowerCase();
	const owner = entry.ownerTeam?.trim().toLowerCase() ?? "";

	if (title === "website visitors") {
		return [
			{
				questionNumber: 2001,
				rationale:
					"Returns current GA4 visitor totals. The result remains provisional until cross-site identity is unified.",
			},
		];
	}
	if (title === "visitor to signup conversion") {
		return [
			{
				questionNumber: 2006,
				rationale:
					"Shows the monthly visitor and eligible-signup counts used by the current conversion calculation.",
			},
			{
				questionNumber: 2019,
				rationale:
					"Shows the resulting monthly ratio. Review the visitor identity and cohort window before approving it as conversion.",
			},
		];
	}
	if (title === "seo / geo breakdown") {
		return [
			{
				questionNumber: 2009,
				rationale:
					"Shows organic clicks and impressions from Google Search Console.",
			},
			{
				questionNumber: 2010,
				rationale:
					"Shows the search queries creating demand so the team can define the intended SEO and GEO categories.",
			},
			{
				questionNumber: 2011,
				rationale:
					"Shows organic landing pages for the current search traffic.",
			},
			{
				questionNumber: 2017,
				rationale:
					"Shows identified AI-referral traffic as a candidate GEO signal.",
			},
			{
				questionNumber: 2020,
				rationale:
					"Shows search click-through rate and average position over time.",
			},
		];
	}
	if (title === "new logos closed (by segment)") {
		return [
			{
				questionNumber: 3003,
				rationale:
					"Shows current HubSpot closed-won deals. Company identity, close event, and segment rules still need approval.",
			},
			{
				questionNumber: 3013,
				rationale: "Shows the current Enterprise closed-won slice.",
			},
			{
				questionNumber: 3018,
				rationale: "Shows the current Studios closed-won slice.",
			},
		];
	}
	if (title === "sows/ msa's signed") {
		return [
			{
				questionNumber: 3003,
				rationale:
					"Shows HubSpot closed-won bookings as a comparison. It does not prove that an SOW or MSA was signed, so the contract event still needs its own source.",
			},
		];
	}
	if (title === "mql / pql / sql breakdown") {
		return [
			{
				questionNumber: 3025,
				rationale:
					"Shows the lead pipeline statuses currently available in HubSpot before the MQL, PQL, and SQL classification contract is approved.",
			},
			{
				questionNumber: 3026,
				rationale:
					"Shows the current HubSpot lead stage values so Sales can decide how they map to MQL, PQL, and SQL.",
			},
		];
	}
	if (title === "actualized revenue (monthly + ytd)") {
		return REVENUE_INTERPRETATIONS;
	}
	if (title === "ndr") {
		return [
			{
				questionNumber: 1105,
				rationale:
					owner === "cs"
						? "Shows complete-month usage NDR for the fixed starting cohort. Confirm whether Customer Success wants usage, billed, or recognized revenue and which customer segment applies."
						: "Shows complete-month usage NDR for the fixed starting cohort. Confirm whether the company KPI should use usage, billed, or recognized revenue.",
			},
			{
				questionNumber: 1106,
				rationale:
					"Shows the same complete-month usage NDR split by the starting paid tier.",
			},
		];
	}
	if (title === "gross margin") {
		return [
			{
				questionNumber: 5004,
				rationale:
					"Shows inference contribution margin only. It is useful input, but it excludes the other costs needed for company gross margin.",
			},
		];
	}
	if (title === "active rate (north star ÷ paid teams)") {
		return [
			{
				questionNumber: 15,
				rationale:
					"Shows the current professional-organization numerator under the Product definition.",
			},
			{
				questionNumber: 1104,
				rationale:
					"Shows active licensed subscriptions by plan as candidate evidence for the paid-team denominator. It still needs organization-level deduplication and an approved paid-team rule.",
			},
		];
	}
	if (title === "enterprise usage") {
		return [
			{
				questionNumber: 1103,
				rationale:
					"Shows paid-plan usage accrual over time. It does not yet join usage to each enterprise account and its contract commitment.",
			},
			{
				questionNumber: 1106,
				rationale:
					"Shows complete-month NDR by starting tier. It is a directional enterprise signal, not the requested account-level usage versus commitment view.",
			},
		];
	}
	if (title === "# of professional teams that used sync in the last month") {
		return [
			{
				questionNumber: 15,
				rationale:
					"Shows the current Product definition of a professional organization. Confirm whether the company KPI uses the same definition and population.",
			},
		];
	}

	return [];
}
