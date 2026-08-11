export type MetabaseConfig = {
	baseUrl: string;
	apiKey: string;
	dashboardId: number;
	userQuestionId: number;
	cardBatchSize: number;
	userBatchSize: number;
	maxBackfillMonths: number;
};

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function metabaseConfig(): MetabaseConfig | null {
	const baseUrl = process.env.METABASE_BASE_URL?.trim().replace(/\/$/, "");
	const apiKey = process.env.METABASE_API_KEY?.trim();

	if (!baseUrl || !apiKey) return null;

	return {
		baseUrl,
		apiKey,
		dashboardId: positiveInteger(process.env.METABASE_DASHBOARD_ID, 1717),
		userQuestionId: positiveInteger(
			process.env.METABASE_USER_QUESTION_ID,
			2509,
		),
		cardBatchSize: positiveInteger(process.env.METABASE_SYNC_BATCH_SIZE, 8),
		userBatchSize: positiveInteger(process.env.METABASE_USER_BATCH_SIZE, 500),
		maxBackfillMonths: positiveInteger(
			process.env.METABASE_MAX_BACKFILL_MONTHS,
			24,
		),
	};
}
