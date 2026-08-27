import {
	DataSourceKind,
	db,
	ExternalRecordKind,
	IdentityLinkMethod,
	RecordSource,
	SyncMode,
} from "@crm/db";
import { domainFromEmail, normalizeDomain } from "@crm/db/domain";
import {
	beginRun,
	completeRun,
	dateValue,
	ensureSource,
	failRun,
	inputJson,
	persistSourceRecord,
	stringValue,
} from "./customer-source";

const SOURCE_KEY = "hubspot:crm";
const FRESHNESS_MS = 6 * 60 * 60 * 1000;
const COMPANY_PROPERTIES = [
	"name",
	"domain",
	"website",
	"description",
	"industry",
	"city",
	"state",
	"country",
	"phone",
	"linkedin_company_page",
	"lifecyclestage",
	"hs_lead_status",
	"hubspot_owner_id",
];
const CONTACT_PROPERTIES = [
	"firstname",
	"lastname",
	"email",
	"phone",
	"jobtitle",
	"lifecyclestage",
	"hs_lead_status",
	"hubspot_owner_id",
	"createdate",
	"hubspot_owner_assigneddate",
	"notes_last_contacted",
	"company",
];
const DEAL_PROPERTIES = [
	"dealname",
	"amount",
	"amount_in_home_currency",
	"dealstage",
	"pipeline",
	"closedate",
	"createdate",
	"hs_lastmodifieddate",
	"hubspot_owner_id",
	"dealtype",
	"days_to_close",
	"hs_is_closed",
	"hs_is_closed_won",
	"hs_is_closed_lost",
	"hs_deal_stage_probability",
	"hs_forecast_amount",
	"hs_forecast_probability",
	"hs_projected_amount",
	"hs_projected_amount_in_home_currency",
	"hs_arr",
	"hs_mrr",
	"hs_acv",
	"hs_tcv",
	"hs_manual_forecast_category",
	"hs_analytics_source",
	"hs_analytics_source_data_1",
	"hs_analytics_source_data_2",
	"hs_object_source_label",
	"closed_lost_reason",
	"closed_won_reason",
];
const DEAL_HISTORY_PROPERTIES = [
	"amount",
	"amount_in_home_currency",
	"dealstage",
	"pipeline",
	"closedate",
	"hs_is_closed_won",
];

type HubspotConfig = { baseUrl: string; accessToken: string };

type HubspotRecord = {
	id: string;
	createdAt?: string;
	updatedAt?: string;
	archived?: boolean;
	properties?: Record<string, unknown>;
	propertiesWithHistory?: Record<
		string,
		Array<{
			value?: unknown;
			timestamp?: string;
			sourceType?: string;
			sourceId?: string;
			updatedByUserId?: number;
		}>
	>;
	associations?: {
		companies?: { results?: Array<{ id?: string }> };
		contacts?: { results?: Array<{ id?: string }> };
	};
};

type HubspotPage = {
	results?: HubspotRecord[];
	paging?: { next?: { after?: string } };
};

type HubspotSearchFilter = {
	propertyName: string;
	operator: "BETWEEN" | "EQ" | "GTE" | "LT";
	value: string;
	highValue?: string;
};

type HubspotEngagement = {
	engagement?: {
		id?: number;
		type?: string;
		createdAt?: number;
		timestamp?: number;
	};
};

type HubspotEngagementPage = {
	results?: HubspotEngagement[];
	hasMore?: boolean;
	offset?: number;
};

type HubspotPipeline = {
	id: string;
	label?: string;
	displayOrder?: number;
	stages?: Array<{
		id?: string;
		label?: string;
		displayOrder?: number;
		metadata?: Record<string, unknown>;
	}>;
};

type HubspotOwner = {
	id: string;
	firstName?: string;
	lastName?: string;
	email?: string;
	userId?: number;
	createdAt?: string;
	updatedAt?: string;
	archived?: boolean;
};

function config(): HubspotConfig | null {
	const accessToken = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
	if (!accessToken) return null;
	return {
		baseUrl:
			process.env.HUBSPOT_BASE_URL?.trim().replace(/\/$/, "") ??
			"https://api.hubapi.com",
		accessToken,
	};
}

class HubspotClient {
	constructor(private readonly value: HubspotConfig) {}

	async page(input: {
		object: "companies" | "contacts" | "deals";
		properties: string[];
		after: string | null;
		associations?: string[];
	}): Promise<HubspotPage> {
		const params = new URLSearchParams({
			limit: input.object === "deals" ? "50" : "100",
			archived: "false",
			properties: input.properties.join(","),
		});
		if (input.object === "deals") {
			params.set("propertiesWithHistory", DEAL_HISTORY_PROPERTIES.join(","));
		}
		if (input.after) params.set("after", input.after);
		if (input.associations?.length) {
			params.set("associations", input.associations.join(","));
		}
		return this.request(`/crm/v3/objects/${input.object}?${params.toString()}`);
	}

	async pipelines(): Promise<{ results?: HubspotPipeline[] }> {
		return this.request("/crm/v3/pipelines/deals");
	}

	async owners(after: string | null): Promise<{
		results?: HubspotOwner[];
		paging?: { next?: { after?: string } };
	}> {
		const params = new URLSearchParams({ limit: "100", archived: "false" });
		if (after) params.set("after", after);
		return this.request(`/crm/v3/owners/?${params.toString()}`);
	}

	async searchTotal(
		object: string,
		filters: HubspotSearchFilter[],
	): Promise<number> {
		const response = await this.request<{ total?: number }>(
			`/crm/v3/objects/${object}/search`,
			{
				method: "POST",
				body: JSON.stringify({
					limit: 1,
					filterGroups: [{ filters }],
				}),
			},
		);
		return response.total ?? 0;
	}

	async objectPage(input: {
		object: string;
		properties: string[];
		after: string | null;
	}): Promise<HubspotPage> {
		const params = new URLSearchParams({
			limit: "100",
			archived: "false",
			properties: input.properties.join(","),
		});
		if (input.after) params.set("after", input.after);
		return this.request(`/crm/v3/objects/${input.object}?${params.toString()}`);
	}

	async companies(ids: string[]): Promise<HubspotPage> {
		return this.request("/crm/v3/objects/companies/batch/read", {
			method: "POST",
			body: JSON.stringify({
				archived: false,
				properties: COMPANY_PROPERTIES,
				inputs: ids.map((id) => ({ id })),
			}),
		});
	}

	async pipelineKind(object: string): Promise<{ results?: HubspotPipeline[] }> {
		return this.request(`/crm/v3/pipelines/${object}`);
	}

	async engagementPage(
		offset: number,
		limit = 250,
	): Promise<HubspotEngagementPage> {
		const params = new URLSearchParams({
			limit: String(limit),
			offset: String(offset),
		});
		return this.request(`/engagements/v1/engagements/paged?${params}`);
	}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		let lastStatus = 0;
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const response = await fetch(`${this.value.baseUrl}${path}`, {
				...init,
				headers: {
					Authorization: `Bearer ${this.value.accessToken}`,
					...(init.body ? { "Content-Type": "application/json" } : {}),
					...init.headers,
				},
				signal: AbortSignal.timeout(30_000),
			});
			lastStatus = response.status;
			if (response.ok) return (await response.json()) as T;
			if (response.status !== 429 && response.status < 500) break;
			if (attempt === 4) break;
			const delay = hubspotRetryDelay(
				response.headers.get("retry-after"),
				attempt,
			);
			await response.body?.cancel();
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
		throw new Error(`HubSpot request failed (${lastStatus}).`);
	}
}

export function hubspotRetryDelay(
	header: string | null,
	attempt: number,
	now = Date.now(),
): number {
	const backoff = Math.min(1000 * 2 ** attempt, 8_000);
	if (!header?.trim()) return backoff;
	const seconds = Number(header);
	const requested = Number.isFinite(seconds)
		? seconds * 1000
		: Date.parse(header) - now;
	return Number.isFinite(requested) && requested > 0
		? Math.max(backoff, Math.min(requested, 60_000))
		: backoff;
}

function properties(record: HubspotRecord): Record<string, unknown> {
	return record.properties ?? {};
}

async function linkCompanyDomain(companyId: string, domain: string) {
	if (domainFromEmail(`person@${domain}`) !== domain) return 0;
	const users = await db.productUser.findMany({
		where: { email: { endsWith: `@${domain}`, mode: "insensitive" } },
		select: { id: true },
	});
	if (users.length === 0) return 0;
	await db.productUserCompanyLink.createMany({
		data: users.map((user) => ({
			productUserId: user.id,
			companyId,
			method: IdentityLinkMethod.EXACT_DOMAIN,
			confidence: 0.92,
			evidence: inputJson({ field: "email_domain", value: domain }),
		})),
		skipDuplicates: true,
	});
	const memberships = await db.productOrganizationMembership.findMany({
		where: { productUserId: { in: users.map((user) => user.id) } },
		distinct: ["productOrganizationId"],
		select: { productOrganizationId: true },
	});
	if (memberships.length > 0) {
		await db.productOrganizationCompanyLink.createMany({
			data: memberships.map((membership) => ({
				productOrganizationId: membership.productOrganizationId,
				companyId,
				method: IdentityLinkMethod.MEMBER_DOMAIN,
				confidence: 0.85,
				evidence: inputJson({ field: "member_email_domain", value: domain }),
			})),
			skipDuplicates: true,
		});
	}
	return users.length;
}

async function persistCompany(sourceId: string, record: HubspotRecord) {
	const values = properties(record);
	const domain = normalizeDomain(stringValue(values.domain ?? values.website));
	const sourceName = stringValue(values.name);
	const name = sourceName ?? domain;
	const payload = {
		id: record.id,
		properties: Object.fromEntries(
			COMPANY_PROPERTIES.map((key) => [key, values[key] ?? null]),
		),
	};
	const prior = await db.sourceRecord.findUnique({
		where: {
			sourceId_kind_externalId: {
				sourceId,
				kind: ExternalRecordKind.COMPANY,
				externalId: record.id,
			},
		},
		select: { companyId: true },
	});
	if (!name) {
		const persisted = await persistSourceRecord({
			sourceId,
			kind: ExternalRecordKind.COMPANY,
			externalId: record.id,
			companyId: prior?.companyId ?? null,
			payload,
			sourceCreatedAt: dateValue(record.createdAt),
			sourceUpdatedAt: dateValue(record.updatedAt),
		});
		return persisted.snapshotCreated;
	}
	let company = prior?.companyId
		? await db.company.findUnique({ where: { id: prior.companyId } })
		: null;
	if (!company && domain) {
		company = await db.company.findUnique({ where: { domain } });
	}
	const sourceData = {
		name,
		domain,
		website: stringValue(values.website),
		description: stringValue(values.description),
		industry: stringValue(values.industry),
		city: stringValue(values.city),
		stateCode: stringValue(values.state),
		country: stringValue(values.country),
		phone: stringValue(values.phone),
		linkedinUrl: stringValue(values.linkedin_company_page),
	};
	if (company) {
		const overwrite = company.source === RecordSource.HUBSPOT;
		company = await db.company.update({
			where: { id: company.id },
			data: Object.fromEntries(
				Object.entries(sourceData).flatMap(([key, value]) => {
					const current = company?.[key as keyof typeof company];
					return value && (overwrite || !current) ? [[key, value]] : [];
				}),
			),
		});
	} else {
		company = await db.company.create({
			data: { ...sourceData, name, source: RecordSource.HUBSPOT },
		});
	}
	const persisted = await persistSourceRecord({
		sourceId,
		kind: ExternalRecordKind.COMPANY,
		externalId: record.id,
		companyId: company.id,
		payload,
		sourceCreatedAt: dateValue(record.createdAt),
		sourceUpdatedAt: dateValue(record.updatedAt),
	});
	if (domain) await linkCompanyDomain(company.id, domain);
	return persisted.snapshotCreated;
}

async function associatedCompanyId(
	sourceId: string,
	record: HubspotRecord,
	email: string | null,
): Promise<string | null> {
	const ids = (record.associations?.companies?.results ?? [])
		.map((association) => stringValue(association.id))
		.filter((id): id is string => Boolean(id));
	if (ids.length === 1) {
		const sourceRecord = await db.sourceRecord.findUnique({
			where: {
				sourceId_kind_externalId: {
					sourceId,
					kind: ExternalRecordKind.COMPANY,
					externalId: ids[0] as string,
				},
			},
			select: { companyId: true },
		});
		if (sourceRecord?.companyId) return sourceRecord.companyId;
	}
	const domain = domainFromEmail(email);
	if (!domain) return null;
	return (
		(await db.company.findUnique({ where: { domain }, select: { id: true } }))
			?.id ?? null
	);
}

async function linkContact(
	contactId: string,
	companyId: string | null,
	email: string,
) {
	const identities = await db.productUserIdentity.findMany({
		where: { kind: "email", normalizedValue: email },
		select: { productUserId: true },
	});
	if (identities.length === 0) return 0;
	await db.productUserContactLink.createMany({
		data: identities.map((identity) => ({
			productUserId: identity.productUserId,
			contactId,
			method: IdentityLinkMethod.EXACT_EMAIL,
			confidence: 1,
			evidence: inputJson({ field: "email", value: email }),
		})),
		skipDuplicates: true,
	});
	if (companyId) {
		await db.productUserCompanyLink.createMany({
			data: identities.map((identity) => ({
				productUserId: identity.productUserId,
				companyId,
				method: IdentityLinkMethod.SOURCE_ASSOCIATION,
				confidence: 1,
				evidence: inputJson({ source: "hubspot_contact", value: email }),
			})),
			skipDuplicates: true,
		});
	}
	return identities.length;
}

async function persistContact(sourceId: string, record: HubspotRecord) {
	const values = properties(record);
	const email = stringValue(values.email)?.toLowerCase() ?? null;
	const companyId = await associatedCompanyId(sourceId, record, email);
	const firstName =
		stringValue(values.firstname) ??
		stringValue(values.lastname) ??
		email?.split("@")[0] ??
		"Unnamed HubSpot contact";
	const lastName = stringValue(values.firstname)
		? stringValue(values.lastname)
		: null;
	const prior = await db.sourceRecord.findUnique({
		where: {
			sourceId_kind_externalId: {
				sourceId,
				kind: ExternalRecordKind.CONTACT,
				externalId: record.id,
			},
		},
		select: { contactId: true },
	});
	let contact = prior?.contactId
		? await db.contact.findUnique({ where: { id: prior.contactId } })
		: null;
	if (!contact && email) {
		contact = await db.contact.findUnique({ where: { email } });
	}
	const sourceData = {
		firstName,
		lastName,
		email,
		phone: stringValue(values.phone),
		title: stringValue(values.jobtitle),
		companyId,
	};
	if (contact) {
		const overwrite = contact.source === RecordSource.HUBSPOT;
		contact = await db.contact.update({
			where: { id: contact.id },
			data: Object.fromEntries(
				Object.entries(sourceData).flatMap(([key, value]) => {
					const current = contact?.[key as keyof typeof contact];
					return value && (overwrite || !current) ? [[key, value]] : [];
				}),
			),
		});
	} else {
		contact = await db.contact.create({
			data: { ...sourceData, firstName, source: RecordSource.HUBSPOT },
		});
	}
	const payload = {
		id: record.id,
		properties: Object.fromEntries(
			CONTACT_PROPERTIES.map((key) => [key, values[key] ?? null]),
		),
		companyIds: (record.associations?.companies?.results ?? []).flatMap(
			(association) => {
				const id = stringValue(association.id);
				return id ? [id] : [];
			},
		),
	};
	const persisted = await persistSourceRecord({
		sourceId,
		kind: ExternalRecordKind.CONTACT,
		externalId: record.id,
		contactId: contact.id,
		payload,
		sourceCreatedAt: dateValue(record.createdAt),
		sourceUpdatedAt: dateValue(record.updatedAt),
	});
	if (email) await linkContact(contact.id, companyId, email);
	return persisted.snapshotCreated;
}

function associationIds(
	record: HubspotRecord,
	kind: "companies" | "contacts",
): string[] {
	return (record.associations?.[kind]?.results ?? []).flatMap((association) => {
		const id = stringValue(association.id);
		return id ? [id] : [];
	});
}

async function persistDeal(sourceId: string, record: HubspotRecord) {
	const values = properties(record);
	const companyIds = associationIds(record, "companies");
	const companySource =
		companyIds.length === 1
			? await db.sourceRecord.findUnique({
					where: {
						sourceId_kind_externalId: {
							sourceId,
							kind: ExternalRecordKind.COMPANY,
							externalId: companyIds[0] as string,
						},
					},
					select: { companyId: true },
				})
			: null;
	const payload = {
		id: record.id,
		properties: Object.fromEntries(
			DEAL_PROPERTIES.map((key) => [key, values[key] ?? null]),
		),
		propertyHistory: record.propertiesWithHistory ?? {},
		companyIds,
		contactIds: associationIds(record, "contacts"),
	};
	const persisted = await persistSourceRecord({
		sourceId,
		kind: ExternalRecordKind.DEAL,
		externalId: record.id,
		companyId: companySource?.companyId ?? null,
		payload,
		sourceCreatedAt: dateValue(record.createdAt),
		sourceUpdatedAt: dateValue(record.updatedAt),
	});
	return persisted.snapshotCreated;
}

async function persistAssociatedCompanies(
	sourceId: string,
	client: HubspotClient,
	deals: HubspotRecord[],
) {
	const ids = [
		...new Set(deals.flatMap((deal) => associationIds(deal, "companies"))),
	];
	if (ids.length === 0) return;
	const existing = await db.sourceRecord.findMany({
		where: {
			sourceId,
			kind: ExternalRecordKind.COMPANY,
			externalId: { in: ids },
		},
		select: { externalId: true, companyId: true },
	});
	const linked = new Set(
		existing.flatMap((record) => (record.companyId ? [record.externalId] : [])),
	);
	const missing = ids.filter((id) => !linked.has(id));
	for (let offset = 0; offset < missing.length; offset += 100) {
		const response = await client.companies(
			missing.slice(offset, offset + 100),
		);
		for (const company of response.results ?? []) {
			if (!company.archived) await persistCompany(sourceId, company);
		}
	}
}

async function syncPipelines(sourceId: string, client: HubspotClient) {
	const scope = "hubspot:pipelines";
	const run = await beginRun({ sourceId, scope });
	let records = 0;
	let snapshots = 0;
	try {
		const response = await client.pipelines();
		for (const pipeline of response.results ?? []) {
			const persisted = await persistSourceRecord({
				sourceId,
				kind: ExternalRecordKind.PIPELINE,
				externalId: pipeline.id,
				payload: pipeline,
			});
			records += 1;
			snapshots += persisted.snapshotCreated;
		}
		await completeRun({
			runId: run.id,
			sourceId,
			records,
			snapshots,
			checkpoint: { completed: true },
			freshnessMs: FRESHNESS_MS,
		});
		return { records, snapshots, completed: true };
	} catch (error) {
		await failRun(run.id, sourceId, error);
		throw error;
	}
}

async function syncOwners(sourceId: string, client: HubspotClient) {
	const scope = "hubspot:owners";
	const cursor = await db.syncCursor.upsert({
		where: {
			sourceId_mode_scope: {
				sourceId,
				mode: SyncMode.INCREMENTAL,
				scope,
			},
		},
		create: {
			sourceId,
			mode: SyncMode.INCREMENTAL,
			scope,
			period: new Date().toISOString().slice(0, 7),
		},
		update: {},
	});
	const run = await beginRun({ sourceId, scope });
	let after = cursor.cursor;
	let records = 0;
	let snapshots = 0;
	let offset = cursor.offset;
	try {
		for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
			const page = await client.owners(after);
			for (const owner of page.results ?? []) {
				if (owner.archived) continue;
				const persisted = await persistSourceRecord({
					sourceId,
					kind: ExternalRecordKind.OWNER,
					externalId: owner.id,
					payload: owner,
					sourceCreatedAt: dateValue(owner.createdAt),
					sourceUpdatedAt: dateValue(owner.updatedAt),
				});
				records += 1;
				snapshots += persisted.snapshotCreated;
			}
			offset += (page.results ?? []).length;
			after = stringValue(page.paging?.next?.after);
			await db.syncCursor.update({
				where: { id: cursor.id },
				data: { cursor: after, offset },
			});
			if (!after) break;
		}
		const completed = !after;
		if (completed) {
			await db.syncCursor.update({
				where: { id: cursor.id },
				data: { cursor: null, offset: 0, completedPeriods: { increment: 1 } },
			});
		}
		await completeRun({
			runId: run.id,
			sourceId,
			records,
			snapshots,
			checkpoint: { after, completed },
			freshnessMs: FRESHNESS_MS,
		});
		return { records, snapshots, completed, after };
	} catch (error) {
		await failRun(run.id, sourceId, error);
		throw error;
	}
}

async function syncScope(input: {
	sourceId: string;
	client: HubspotClient;
	object: "companies" | "contacts" | "deals";
	properties: string[];
	maxPages: number;
}) {
	const scope = `hubspot:${input.object}`;
	const cursor = await db.syncCursor.upsert({
		where: {
			sourceId_mode_scope: {
				sourceId: input.sourceId,
				mode: SyncMode.INCREMENTAL,
				scope,
			},
		},
		create: {
			sourceId: input.sourceId,
			mode: SyncMode.INCREMENTAL,
			scope,
			period: new Date().toISOString().slice(0, 7),
		},
		update: {},
	});
	const run = await beginRun({ sourceId: input.sourceId, scope });
	let after = cursor.cursor;
	let records = 0;
	let snapshots = 0;
	let completed = false;
	let offset = cursor.offset;
	try {
		for (let pageNumber = 0; pageNumber < input.maxPages; pageNumber += 1) {
			const page = await input.client.page({
				object: input.object,
				properties: input.properties,
				after,
				associations:
					input.object === "contacts"
						? ["companies"]
						: input.object === "deals"
							? ["companies", "contacts"]
							: undefined,
			});
			if (input.object === "deals") {
				await persistAssociatedCompanies(
					input.sourceId,
					input.client,
					page.results ?? [],
				);
			}
			for (const record of page.results ?? []) {
				if (record.archived) continue;
				if (input.object === "companies") {
					snapshots += await persistCompany(input.sourceId, record);
				} else if (input.object === "contacts") {
					snapshots += await persistContact(input.sourceId, record);
				} else {
					snapshots += await persistDeal(input.sourceId, record);
				}
				records += 1;
			}
			offset += (page.results ?? []).length;
			after = stringValue(page.paging?.next?.after);
			await db.syncCursor.update({
				where: { id: cursor.id },
				data: {
					cursor: after,
					offset,
					period: new Date().toISOString().slice(0, 7),
				},
			});
			if (!after) {
				completed = true;
				break;
			}
		}
		if (completed) {
			await db.syncCursor.update({
				where: { id: cursor.id },
				data: { cursor: null, offset: 0, completedPeriods: { increment: 1 } },
			});
		}
		await completeRun({
			runId: run.id,
			sourceId: input.sourceId,
			records,
			snapshots,
			checkpoint: { after, completed },
			freshnessMs: FRESHNESS_MS,
		});
		return { records, snapshots, completed, after };
	} catch (error) {
		await failRun(run.id, input.sourceId, error);
		throw error;
	}
}

function between(
	propertyName: string,
	start: Date,
	end: Date,
): HubspotSearchFilter {
	return {
		propertyName,
		operator: "BETWEEN",
		value: String(start.getTime()),
		highValue: String(end.getTime()),
	};
}

function halfOpen(
	propertyName: string,
	start: Date,
	end: Date,
): HubspotSearchFilter[] {
	return [
		{ propertyName, operator: "GTE", value: String(start.getTime()) },
		{ propertyName, operator: "LT", value: String(end.getTime()) },
	];
}

function equals(propertyName: string, value: string): HubspotSearchFilter {
	return { propertyName, operator: "EQ", value };
}

function shiftUtcYear(value: Date, years: number): Date {
	const result = new Date(value);
	result.setUTCFullYear(result.getUTCFullYear() + years);
	return result;
}

const Q3_START = new Date("2026-07-01T00:00:00.000Z");
const Q3_END = new Date("2026-10-01T00:00:00.000Z");
const Q3_LIFECYCLE_PROPERTIES = {
	mql: "hs_v2_date_entered_marketingqualifiedlead",
	pql: "hs_v2_date_entered_1512748791",
	sql: "hs_v2_date_entered_salesqualifiedlead",
};

function q3Periods(dataThrough: Date): Array<{ start: Date; end: Date }> {
	const end = new Date(
		Math.min(
			Math.max(dataThrough.getTime(), Q3_START.getTime()),
			Q3_END.getTime(),
		),
	);
	const starts = [new Date(Q3_START)];
	const firstMonday = new Date(Q3_START);
	firstMonday.setUTCDate(
		firstMonday.getUTCDate() + ((8 - firstMonday.getUTCDay()) % 7 || 7),
	);
	for (
		let current = firstMonday;
		current < end;
		current = new Date(current.getTime() + 7 * 24 * 60 * 60 * 1000)
	) {
		starts.push(new Date(current));
	}
	return starts.map((start, index) => ({
		start,
		end: starts[index + 1] ?? end,
	}));
}

async function q3LifecycleStageMetrics(
	client: HubspotClient,
	capturedAt: Date,
) {
	const dataThrough = new Date(
		Date.UTC(
			capturedAt.getUTCFullYear(),
			capturedAt.getUTCMonth(),
			capturedAt.getUTCDate(),
		),
	);
	const rows = [];
	const errors = new Set<string>();
	for (const period of q3Periods(dataThrough)) {
		const [mql, pql, sql] = await Promise.all([
			totalOrUnavailable(
				client,
				"contacts",
				halfOpen(Q3_LIFECYCLE_PROPERTIES.mql, period.start, period.end),
			),
			totalOrUnavailable(
				client,
				"contacts",
				halfOpen(Q3_LIFECYCLE_PROPERTIES.pql, period.start, period.end),
			),
			totalOrUnavailable(
				client,
				"contacts",
				halfOpen(Q3_LIFECYCLE_PROPERTIES.sql, period.start, period.end),
			),
		]);
		for (const result of [mql, pql, sql]) {
			if (result.error) errors.add(result.error);
		}
		rows.push({
			week_start: period.start.toISOString(),
			period_end: period.end.toISOString(),
			mql: mql.value,
			pql: pql.value,
			sql: sql.value,
		});
	}
	return {
		status: errors.size === 0 ? "live" : "unavailable",
		errors: [...errors],
		capturedAt: capturedAt.toISOString(),
		dataThrough: dataThrough.toISOString(),
		rows,
	};
}

function changePercent(current: number | null, previous: number | null) {
	if (current === null || previous === null || previous === 0) return null;
	return ((current - previous) / previous) * 100;
}

async function totalOrUnavailable(
	client: HubspotClient,
	object: string,
	filters: HubspotSearchFilter[],
) {
	try {
		return { value: await client.searchTotal(object, filters), error: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			value: null,
			error: message.includes("(403)")
				? `HubSpot read scope for ${object} is missing.`
				: message,
		};
	}
}

async function engagementOffsetAt(client: HubspotClient, target: number) {
	let low = 0;
	let high = 500_000_000_000;
	for (let iteration = 0; iteration < 40 && high - low > 1; iteration += 1) {
		const midpoint = Math.floor((low + high) / 2);
		const page = await client.engagementPage(midpoint, 1);
		const item = page.results?.[0]?.engagement;
		if (!item?.id) {
			high = midpoint;
			continue;
		}
		const timestamp = item.createdAt ?? item.timestamp ?? 0;
		if (timestamp < target) {
			low = Math.max(midpoint + 1, item.id + 1);
		} else {
			high = midpoint;
		}
	}
	return low;
}

async function emailCounts(
	client: HubspotClient,
	previousStart: Date,
	currentStart: Date,
	end: Date,
) {
	let offset = await engagementOffsetAt(client, previousStart.getTime());
	let current = 0;
	let previous = 0;
	const seen = new Set<number>();
	for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
		const page = await client.engagementPage(offset);
		for (const item of page.results ?? []) {
			const engagement = item.engagement;
			if (!engagement?.id || seen.has(engagement.id)) continue;
			seen.add(engagement.id);
			if (engagement.type !== "EMAIL") continue;
			const timestamp = engagement.timestamp ?? engagement.createdAt ?? 0;
			if (timestamp >= currentStart.getTime() && timestamp < end.getTime()) {
				current += 1;
			} else if (
				timestamp >= previousStart.getTime() &&
				timestamp < currentStart.getTime()
			) {
				previous += 1;
			}
		}
		if (!page.hasMore || !page.offset) break;
		offset = page.offset;
	}
	return { current, previous };
}

async function leadStageMetrics(client: HubspotClient) {
	try {
		const pipelineResponse = await client.pipelineKind("0-136");
		const stageLabels = new Map<string, string>();
		for (const pipeline of pipelineResponse.results ?? []) {
			for (const stage of pipeline.stages ?? []) {
				if (stage.id) stageLabels.set(stage.id, stage.label ?? stage.id);
			}
		}
		const counts = new Map<string, number>();
		let after: string | null = null;
		for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
			const page = await client.objectPage({
				object: "0-136",
				properties: ["hs_pipeline_stage"],
				after,
			});
			for (const lead of page.results ?? []) {
				const stage = stringValue(lead.properties?.hs_pipeline_stage);
				if (!stage) continue;
				counts.set(stage, (counts.get(stage) ?? 0) + 1);
			}
			after = stringValue(page.paging?.next?.after);
			if (!after) break;
		}
		return {
			status: "live",
			error: null,
			stages: [...counts.entries()].map(([key, count]) => ({
				key,
				label: stageLabels.get(key) ?? key.replaceAll("_", " "),
				count,
			})),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			status: "unavailable",
			error: message.includes("(403)")
				? "HubSpot read-only Leads scope is required."
				: message,
			stages: [],
		};
	}
}

async function syncReportMetrics(sourceId: string, client: HubspotClient) {
	const scope = "hubspot:sales-report-metrics";
	const run = await beginRun({ sourceId, scope });
	let records = 0;
	let snapshots = 0;
	try {
		const end = new Date();
		const q3Lifecycle = await q3LifecycleStageMetrics(client, end);
		const q3Record = await persistSourceRecord({
			sourceId,
			kind: ExternalRecordKind.ACTIVITY,
			externalId: "report:q3-lifecycle-stage-transitions",
			payload: q3Lifecycle,
			sourceCreatedAt: end,
			sourceUpdatedAt: end,
		});
		records += 1;
		snapshots += q3Record.snapshotCreated;
		const currentStart = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
		const previousStart = new Date(
			currentStart.getTime() - 30 * 24 * 60 * 60 * 1000,
		);
		const yearStart = shiftUtcYear(currentStart, -1);
		const yearEnd = shiftUtcYear(end, -1);
		const contactDealDefinitions = [
			{
				key: "contacts_created",
				label: "Contacts created",
				object: "contacts",
				property: "createdate",
				filters: [] as HubspotSearchFilter[],
			},
			{
				key: "contacts_assigned",
				label: "Contacts assigned",
				object: "contacts",
				property: "hubspot_owner_assigneddate",
				filters: [] as HubspotSearchFilter[],
			},
			{
				key: "contacts_worked",
				label: "Contacts worked",
				object: "contacts",
				property: "notes_last_contacted",
				filters: [] as HubspotSearchFilter[],
			},
			{
				key: "new_deals_created",
				label: "New deals created",
				object: "deals",
				property: "createdate",
				filters: [] as HubspotSearchFilter[],
			},
			{
				key: "deals_closed_won",
				label: "Deals closed won",
				object: "deals",
				property: "closedate",
				filters: [equals("hs_is_closed_won", "true")],
			},
		];
		const contactDealMetrics = [];
		for (const definition of contactDealDefinitions) {
			const current = await totalOrUnavailable(client, definition.object, [
				between(definition.property, currentStart, end),
				...definition.filters,
			]);
			const previous = await totalOrUnavailable(client, definition.object, [
				between(definition.property, yearStart, yearEnd),
				...definition.filters,
			]);
			contactDealMetrics.push({
				key: definition.key,
				label: definition.label,
				current: current.value,
				previous: previous.value,
				changePct: changePercent(current.value, previous.value),
				status: current.error ? "unavailable" : "live",
				error: current.error ?? previous.error,
			});
		}
		const contactDeal = await persistSourceRecord({
			sourceId,
			kind: ExternalRecordKind.ACTIVITY,
			externalId: "report:contact-deal-totals",
			payload: {
				report: "contact-deal-totals",
				window: {
					start: currentStart.toISOString(),
					end: end.toISOString(),
				},
				comparison: {
					kind: "year-over-year",
					start: yearStart.toISOString(),
					end: yearEnd.toISOString(),
				},
				metrics: contactDealMetrics,
			},
			sourceCreatedAt: end,
			sourceUpdatedAt: end,
		});
		records += 1;
		snapshots += contactDeal.snapshotCreated;

		const activityDefinitions = [
			{ key: "meetings", label: "Meeting", object: "meetings" },
			{ key: "notes", label: "Note", object: "notes" },
			{ key: "tasks", label: "Task", object: "tasks" },
		];
		const teamMetrics = [];
		let emails: { current: number; previous: number } | null = null;
		let emailError: string | null = null;
		try {
			emails = await emailCounts(client, previousStart, currentStart, end);
		} catch (error) {
			emailError = error instanceof Error ? error.message : String(error);
		}
		teamMetrics.push({
			key: "emails_sent_to_contact",
			label: "Email sent to contact",
			current: emails?.current ?? null,
			previous: emails?.previous ?? null,
			changePct: changePercent(
				emails?.current ?? null,
				emails?.previous ?? null,
			),
			status: emails ? "live" : "unavailable",
			error: emailError,
		});
		for (const definition of activityDefinitions) {
			const current = await totalOrUnavailable(client, definition.object, [
				between("hs_timestamp", currentStart, end),
			]);
			const previous = await totalOrUnavailable(client, definition.object, [
				between("hs_timestamp", previousStart, currentStart),
			]);
			teamMetrics.push({
				key: definition.key,
				label: definition.label,
				current: current.value,
				previous: previous.value,
				changePct: changePercent(current.value, previous.value),
				status: current.error ? "unavailable" : "live",
				error: current.error ?? previous.error,
			});
		}
		const team = await persistSourceRecord({
			sourceId,
			kind: ExternalRecordKind.ACTIVITY,
			externalId: "report:team-activity-totals",
			payload: {
				report: "team-activity-totals",
				window: {
					start: currentStart.toISOString(),
					end: end.toISOString(),
				},
				comparison: {
					kind: "previous-period",
					start: previousStart.toISOString(),
					end: currentStart.toISOString(),
				},
				metrics: teamMetrics,
			},
			sourceCreatedAt: end,
			sourceUpdatedAt: end,
		});
		records += 1;
		snapshots += team.snapshotCreated;

		const leads = await leadStageMetrics(client);
		const leadRecord = await persistSourceRecord({
			sourceId,
			kind: ExternalRecordKind.ACTIVITY,
			externalId: "report:lead-stage-view",
			payload: {
				report: "lead-stage-view",
				capturedAt: end.toISOString(),
				...leads,
			},
			sourceCreatedAt: end,
			sourceUpdatedAt: end,
		});
		records += 1;
		snapshots += leadRecord.snapshotCreated;

		await completeRun({
			runId: run.id,
			sourceId,
			records,
			snapshots,
			checkpoint: {
				completed: true,
				windowStart: currentStart.toISOString(),
				windowEnd: end.toISOString(),
				leads: leads.status,
				q3Lifecycle: q3Lifecycle.status,
			},
			freshnessMs: FRESHNESS_MS,
		});
		return { records, snapshots, completed: true, leads: leads.status };
	} catch (error) {
		await failRun(run.id, sourceId, error);
		throw error;
	}
}

export async function syncHubspot(maxPages = 10) {
	const value = config();
	const source = await ensureSource({
		key: SOURCE_KEY,
		kind: DataSourceKind.HUBSPOT,
		label: "HubSpot CRM",
		configured: value !== null,
	});
	if (!value) {
		return {
			configured: false,
			companies: null,
			contacts: null,
			deals: null,
			pipelines: null,
			owners: null,
			reports: null,
		};
	}
	const client = new HubspotClient(value);
	const companies = await syncScope({
		sourceId: source.id,
		client,
		object: "companies",
		properties: COMPANY_PROPERTIES,
		maxPages,
	});
	const contacts = await syncScope({
		sourceId: source.id,
		client,
		object: "contacts",
		properties: CONTACT_PROPERTIES,
		maxPages,
	});
	const deals = await syncScope({
		sourceId: source.id,
		client,
		object: "deals",
		properties: DEAL_PROPERTIES,
		maxPages,
	});
	const pipelines = await syncPipelines(source.id, client);
	const owners = await syncOwners(source.id, client);
	const reports = await syncReportMetrics(source.id, client);
	return {
		configured: true,
		companies,
		contacts,
		deals,
		pipelines,
		owners,
		reports,
	};
}

export async function syncHubspotSales(maxPages = 10) {
	const value = config();
	const source = await ensureSource({
		key: SOURCE_KEY,
		kind: DataSourceKind.HUBSPOT,
		label: "HubSpot CRM",
		configured: value !== null,
	});
	if (!value) {
		return {
			configured: false,
			deals: null,
			pipelines: null,
			owners: null,
		};
	}
	const client = new HubspotClient(value);
	const deals = await syncScope({
		sourceId: source.id,
		client,
		object: "deals",
		properties: DEAL_PROPERTIES,
		maxPages,
	});
	const pipelines = await syncPipelines(source.id, client);
	const owners = await syncOwners(source.id, client);
	const reports = await syncReportMetrics(source.id, client);
	return { configured: true, deals, pipelines, owners, reports };
}
