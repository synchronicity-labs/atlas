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

export function createPylonPageReader(
	options: {
		token?: () => string | null;
		fetch?: (url: string, init: RequestInit) => Promise<Response>;
		wait?: (ms: number) => Promise<unknown>;
		now?: () => number;
	} = {},
) {
	const request = options.fetch ?? fetch;
	const wait =
		options.wait ??
		((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
	const now = options.now ?? Date.now;
	let nextRequestAt = 0;
	let pending = Promise.resolve();
	return function requestPage<T>(path: string): Promise<PylonPage<T>> {
		const result = pending.then(async () => {
			const token = (options.token ?? pylonToken)();
			if (!token) throw new Error("Pylon support access is not configured.");
			for (let attempt = 0; ; attempt += 1) {
				const delay = nextRequestAt - now();
				if (delay > 0) await wait(delay);
				nextRequestAt = now() + 2_100;
				const response = await request(`${PYLON_BASE_URL}${path}`, {
					headers: { Authorization: `Bearer ${token}` },
					signal: AbortSignal.timeout(20_000),
				});
				if (response.status === 429 && attempt < 2) {
					const header =
						response.headers.get("x-retry-after") ??
						response.headers.get("retry-after");
					const seconds = header === null ? Number.NaN : Number(header);
					const retryMs = Number.isFinite(seconds)
						? seconds * 1_000
						: header
							? Date.parse(header) - now()
							: 60_000;
					if (retryMs > 60_000)
						throw new Error(
							"Pylon rate limit exceeds the bounded retry window.",
						);
					nextRequestAt = Math.max(
						nextRequestAt,
						now() + (Number.isFinite(retryMs) ? Math.max(0, retryMs) : 60_000),
					);
					await response.body?.cancel();
					continue;
				}
				if (!response.ok)
					throw new Error(
						`Pylon request failed with status ${response.status}.`,
					);
				const page = (await response.json()) as PylonPage<T>;
				if (!Array.isArray(page.data))
					throw new Error(
						"Pylon returned an invalid page instead of a data array.",
					);
				return page;
			}
		});
		pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};
}

const requestPage = createPylonPageReader();

export async function collectPylonPages<T>(
	path: string,
	reader = requestPage,
	limit = 500,
): Promise<T[]> {
	const rows: T[] = [];
	let cursor: string | null = null;
	for (let page = 0; page < 100; page += 1) {
		const separator = path.includes("?") ? "&" : "?";
		const result: PylonPage<T> = await reader<T>(
			`${path}${separator}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
		);
		rows.push(...(result.data ?? []));
		if (!result.pagination?.has_next_page) return rows;
		if (!result.pagination.cursor || result.pagination.cursor === cursor)
			throw new Error("Pylon pagination did not advance.");
		cursor = result.pagination.cursor;
	}
	throw new Error(
		"Pylon pagination exceeded 100 pages; refusing to publish a partial result.",
	);
}

export async function fetchPylonIssues(input: {
	start: Date;
	end: Date;
}): Promise<PylonIssue[]> {
	const params = new URLSearchParams({
		start_time: input.start.toISOString(),
		end_time: input.end.toISOString(),
	});
	return collectPylonPages<PylonIssue>(`/issues?${params.toString()}`);
}

export async function fetchPylonSurveys(): Promise<PylonSurvey[]> {
	return collectPylonPages<PylonSurvey>("/surveys");
}

export async function fetchPylonSurveyResponses(
	surveyId: string,
): Promise<PylonSurveyResponse[]> {
	return collectPylonPages<PylonSurveyResponse>(
		`/surveys/${encodeURIComponent(surveyId)}/responses`,
	);
}

export function hasPylonSupportAccess(): boolean {
	return Boolean(pylonToken());
}
