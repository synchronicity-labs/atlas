const PYLON_BASE_URL = "https://api.usepylon.com";

type PylonPage<T> = {
	data?: T[];
	pagination?: {
		cursor?: string | null;
		has_next_page?: boolean;
	};
};

export type PylonIssue = {
	id: string;
	created_at?: string | null;
	state?: string | null;
	source?: string | { name?: string | null } | null;
	tags?: Array<string | { name?: string | null }> | null;
	team?: string | { name?: string | null } | null;
	first_response_seconds?: number | null;
	business_hours_first_response_seconds?: number | null;
	resolution_time?: number | null;
};

export type PylonSurvey = {
	id: string;
	name?: string | null;
	type?: string | null;
};

export type PylonSurveyResponse = {
	id: string;
	submitted_at?: string | null;
	answers?: Array<{
		question_type?: string | null;
		value?: unknown;
	}> | null;
};

function pylonToken(): string | null {
	return process.env.PYLON_API_KEY?.trim() || null;
}

async function requestPage<T>(path: string): Promise<PylonPage<T>> {
	const token = pylonToken();
	if (!token) throw new Error("Pylon support access is not configured.");
	const response = await fetch(`${PYLON_BASE_URL}${path}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!response.ok) {
		throw new Error(`Pylon request failed with status ${response.status}.`);
	}
	return (await response.json()) as PylonPage<T>;
}

async function collectPages<T>(path: string, limit = 100): Promise<T[]> {
	const rows: T[] = [];
	let cursor: string | null = null;
	for (let page = 0; page < 100; page += 1) {
		const separator = path.includes("?") ? "&" : "?";
		const result: PylonPage<T> = await requestPage<T>(
			`${path}${separator}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
		);
		rows.push(...(result.data ?? []));
		if (!result.pagination?.has_next_page || !result.pagination.cursor) break;
		cursor = result.pagination.cursor;
	}
	return rows;
}

export async function fetchPylonIssues(input: {
	start: Date;
	end: Date;
}): Promise<PylonIssue[]> {
	const params = new URLSearchParams({
		start_time: input.start.toISOString(),
		end_time: input.end.toISOString(),
	});
	return collectPages<PylonIssue>(`/issues?${params.toString()}`);
}

export async function fetchPylonSurveys(): Promise<PylonSurvey[]> {
	return collectPages<PylonSurvey>("/surveys");
}

export async function fetchPylonSurveyResponses(
	surveyId: string,
): Promise<PylonSurveyResponse[]> {
	return collectPages<PylonSurveyResponse>(
		`/surveys/${encodeURIComponent(surveyId)}/responses`,
	);
}

export function hasPylonSupportAccess(): boolean {
	return Boolean(pylonToken());
}
