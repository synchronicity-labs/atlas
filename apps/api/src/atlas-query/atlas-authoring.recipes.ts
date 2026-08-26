import { QueryLanguage } from "@crm/db";

export const ATLAS_AUTOMATED_REPORT_DASHBOARD = 13;
export const ATLAS_AUTOMATED_REPORT_SOURCE = "atlas:automated-reports";

type Recipe = {
	key: string;
	version: number;
	requestKey: string;
	queryLanguage: QueryLanguage;
	queryText: string;
	description: string;
	display: string;
	visualization: Record<string, unknown>;
};

const recipes: Recipe[] = [
	{
		key: "product.cancellation-feedback-incentive-weekly",
		version: 1,
		requestKey: "weekly-cancellation-feedback-incentive",
		queryLanguage: QueryLanguage.API,
		queryText: JSON.stringify({
			source: "automated_report",
			recipe: "product.cancellation-feedback-incentive-weekly",
			version: 1,
		}),
		description: [
			"Complete Monday-Sunday UTC cancellation-feedback incentive outcomes by organization.",
			"The governed population excludes internal, anonymous, and banned Product users.",
			"Offer exposure is measured by exit_survey_incentive_shown. Current instrumentation cannot count feature-flag-positive organizations that never opened the offer.",
			"Product Postgres is canonical for feedback, reward, call, and structured-reason outcomes. PostHog supplies offer, decline, save, and continued-cancellation events and reconciles reward and call counts.",
			"The result contains aggregate counts and structured reasons only. It excludes names, emails, user IDs, organization IDs, competitor names, and free text.",
		].join("\n\n"),
		display: "table",
		visualization: {
			columns: [
				"week_start",
				"row_kind",
				"reason",
				"offer_shown_organizations",
				"feedback_submissions",
				"written_reward_claims",
				"call_requests",
				"incentive_declines",
				"continued_cancellations",
				"saved_after_reward",
				"reward_granted_usd",
				"reason_responses",
				"data_through",
			],
		},
	},
];

export function atlasAuthoringRecipe(input: {
	key: string;
	version: number;
}): Recipe | null {
	return (
		recipes.find(
			(recipe) => recipe.key === input.key && recipe.version === input.version,
		) ?? null
	);
}

export function atlasAuthoringRecipeSummaries() {
	return recipes.map(({ key, version, requestKey }) => ({
		key,
		version,
		requestKey,
	}));
}
