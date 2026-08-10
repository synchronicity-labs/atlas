import {
	DataSourceKind,
	db,
	ExternalRecordKind,
	IdentityLinkMethod,
} from "@crm/db";
import {
	beginRun,
	completeRun,
	ensureSource,
	failRun,
	inputJson,
	persistSourceRecord,
	stringValue,
} from "./customer-source";

const SOURCE_KEY = "posthog:product";
const FRESHNESS_MS = 6 * 60 * 60 * 1000;

type PosthogConfig = {
	host: string;
	apiKey: string;
	projectId: string;
};

type PosthogPerson = {
	id?: string | number;
	uuid?: string;
	created_at?: string | null;
	last_seen_at?: string | null;
	properties?: Record<string, unknown> | null;
	distinct_ids?: unknown[];
};

type Activity = {
	events30d: number;
	activeDays30d: number;
	sessions30d: number;
	pageviews30d: number;
	lastEventName: string | null;
	lastEventAt: string | null;
};

function config(): PosthogConfig | null {
	const host = process.env.POSTHOG_HOST?.trim().replace(/\/$/, "");
	const apiKey = process.env.POSTHOG_API_KEY?.trim();
	const projectId = process.env.POSTHOG_PROJECT_ID?.trim();
	return host && apiKey && projectId ? { host, apiKey, projectId } : null;
}

function personId(person: PosthogPerson): string | null {
	return stringValue(person.uuid ?? person.id);
}

function asNumber(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function selectedProperties(
	properties: Record<string, unknown> | null | undefined,
) {
	const keys = [
		"email",
		"organization_id",
		"organization_plan",
		"signup_onboarding_cohort",
		"sync_source",
		"sync_attr_source_type",
		"sync_attr_subdomain",
		"sync_attr_landing_page",
		"sync_attr_referrer",
		"sync_attr_utm_source",
		"sync_attr_utm_medium",
		"sync_attr_utm_campaign",
		"$initial_current_url",
		"$initial_referring_domain",
		"$initial_utm_source",
		"$initial_utm_medium",
		"$initial_utm_campaign",
	];
	return Object.fromEntries(
		keys.flatMap((key) => {
			const value = properties?.[key];
			return value === null || value === undefined || value === ""
				? []
				: [[key, value]];
		}),
	);
}

class PosthogClient {
	constructor(private readonly value: PosthogConfig) {}

	async byDistinctId(distinctId: string): Promise<PosthogPerson | null> {
		const body = await this.request<{
			results?: Record<string, PosthogPerson>;
		}>(`/api/projects/${this.value.projectId}/persons/batch_by_distinct_ids/`, {
			method: "POST",
			body: JSON.stringify({ distinct_ids: [distinctId] }),
		});
		return body.results?.[distinctId] ?? null;
	}

	async byEmail(email: string): Promise<PosthogPerson | null> {
		const body = await this.request<{ results?: PosthogPerson[] }>(
			`/api/projects/${this.value.projectId}/persons/?limit=10&email=${encodeURIComponent(email)}`,
		);
		return (
			(body.results ?? []).find(
				(person) =>
					stringValue(person.properties?.email)?.toLowerCase() ===
					email.toLowerCase(),
			) ?? null
		);
	}

	async activity(id: string): Promise<Activity> {
		if (
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				id,
			)
		) {
			return {
				events30d: 0,
				activeDays30d: 0,
				sessions30d: 0,
				pageviews30d: 0,
				lastEventName: null,
				lastEventAt: null,
			};
		}
		const query = `select count() as events_30d, uniq(toDate(timestamp)) as active_days_30d, uniq($session_id) as sessions_30d, countIf(event = '$pageview') as pageviews_30d, argMax(event, timestamp) as last_event_name, max(timestamp) as last_event_at from events where person_id = '${id}' and timestamp >= now() - interval 30 day`;
		const body = await this.request<{
			results?: unknown[][];
			error?: string | null;
		}>(`/api/projects/${this.value.projectId}/query/`, {
			method: "POST",
			body: JSON.stringify({
				name: "Atlas product user activity",
				query: { kind: "HogQLQuery", query },
			}),
		});
		const row = body.results?.[0] ?? [];
		return {
			events30d: asNumber(row[0]),
			activeDays30d: asNumber(row[1]),
			sessions30d: asNumber(row[2]),
			pageviews30d: asNumber(row[3]),
			lastEventName: stringValue(row[4]),
			lastEventAt: stringValue(row[5]),
		};
	}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`${this.value.host}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.value.apiKey}`,
				"Content-Type": "application/json",
				...init.headers,
			},
			signal: AbortSignal.timeout(30_000),
		});
		const body = (await response.json()) as T & {
			detail?: string;
			error?: string | null;
		};
		if (!response.ok || body.error) {
			throw new Error(`PostHog request failed (${response.status}).`);
		}
		return body;
	}
}

export async function syncPosthogProductUser(productUserId: string) {
	const value = config();
	const source = await ensureSource({
		key: SOURCE_KEY,
		kind: DataSourceKind.POSTHOG,
		label: "PostHog product analytics",
		configured: value !== null,
	});
	if (!value) return { configured: false, matched: false, snapshotCreated: 0 };

	const user = await db.productUser.findUnique({
		where: { id: productUserId },
		select: { id: true, externalId: true, email: true },
	});
	if (!user) return { configured: true, matched: false, snapshotCreated: 0 };

	const client = new PosthogClient(value);
	let method: IdentityLinkMethod = IdentityLinkMethod.EXACT_EXTERNAL_ID;
	let person = await client.byDistinctId(user.externalId);
	if (!person && user.email) {
		person = await client.byEmail(user.email);
		method = IdentityLinkMethod.EXACT_EMAIL;
	}
	const id = person ? personId(person) : null;
	if (!person || !id) {
		return { configured: true, matched: false, snapshotCreated: 0 };
	}

	const activity = await client.activity(id);
	const matchingDistinctIds = (person.distinct_ids ?? [])
		.map(stringValue)
		.filter((entry): entry is string => Boolean(entry))
		.filter(
			(entry) =>
				entry === user.externalId ||
				entry.toLowerCase() === user.email?.toLowerCase(),
		);
	const payload = {
		personId: id,
		createdAt: stringValue(person.created_at),
		lastSeenAt: stringValue(person.last_seen_at),
		properties: selectedProperties(person.properties),
		matchingDistinctIds,
		activity,
	};
	const persisted = await persistSourceRecord({
		sourceId: source.id,
		kind: ExternalRecordKind.PERSON,
		externalId: id,
		payload,
		sourceCreatedAt: person.created_at ? new Date(person.created_at) : null,
		sourceUpdatedAt: person.last_seen_at ? new Date(person.last_seen_at) : null,
	});
	await db.productUserSourceLink.upsert({
		where: {
			productUserId_sourceRecordId: {
				productUserId: user.id,
				sourceRecordId: persisted.record.id,
			},
		},
		create: {
			productUserId: user.id,
			sourceRecordId: persisted.record.id,
			method,
			confidence: method === IdentityLinkMethod.EXACT_EXTERNAL_ID ? 1 : 0.98,
			evidence: inputJson({
				field:
					method === IdentityLinkMethod.EXACT_EXTERNAL_ID
						? "external_id"
						: "email",
				value:
					method === IdentityLinkMethod.EXACT_EXTERNAL_ID
						? user.externalId
						: user.email,
			}),
		},
		update: {
			method,
			confidence: method === IdentityLinkMethod.EXACT_EXTERNAL_ID ? 1 : 0.98,
		},
	});

	return {
		configured: true,
		matched: true,
		snapshotCreated: persisted.snapshotCreated,
	};
}

export async function syncPosthogLinkedUsers(limit = 100) {
	const value = config();
	const source = await ensureSource({
		key: SOURCE_KEY,
		kind: DataSourceKind.POSTHOG,
		label: "PostHog product analytics",
		configured: value !== null,
	});
	if (!value) return { configured: false, processed: 0, matched: 0 };

	const run = await beginRun({ sourceId: source.id, scope: "posthog:users" });
	try {
		const users = await db.productUser.findMany({
			where: {
				OR: [{ contactLinks: { some: {} } }, { companyLinks: { some: {} } }],
			},
			orderBy: [{ lastSeenAt: "desc" }, { externalId: "asc" }],
			take: limit,
			select: { id: true },
		});
		let matched = 0;
		let snapshots = 0;
		for (const user of users) {
			const result = await syncPosthogProductUser(user.id);
			if (result.matched) matched += 1;
			snapshots += result.snapshotCreated;
		}
		await completeRun({
			runId: run.id,
			sourceId: source.id,
			records: users.length,
			snapshots,
			checkpoint: { matched },
			freshnessMs: FRESHNESS_MS,
		});
		return { configured: true, processed: users.length, matched };
	} catch (error) {
		await failRun(run.id, source.id, error);
		throw error;
	}
}
