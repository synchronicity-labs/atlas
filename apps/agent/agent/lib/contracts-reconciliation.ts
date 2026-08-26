import {
	ContractCustomerKind,
	ContractFindingKind,
	ContractFindingSeverity,
	ContractFindingStatus,
	ContractMappingStatus,
	db,
} from "@crm/db";
import { inputJson } from "./customer-source";

type CommercialTerm = {
	label?: unknown;
	amountMinor?: unknown;
	amountMillicents?: unknown;
	currency?: unknown;
	unit?: unknown;
	cadence?: unknown;
	isMinimumCommitment?: unknown;
	evidenceQuote?: unknown;
};

type ParsedContract = {
	documentType?: unknown;
	effectiveDate?: unknown;
	serviceStartDate?: unknown;
	serviceEndDate?: unknown;
	autoRenews?: unknown;
	currency?: unknown;
	contractValueAmountMinor?: unknown;
	annualCommitmentAmountMinor?: unknown;
	billingCadence?: unknown;
	commercialTerms?: unknown;
};

export type ReconciliationDocument = {
	sourceRecordId: string;
	name: string;
	sourceUpdatedAt: Date | null;
	parsed: ParsedContract;
};

export type ContractCommercialBaseline = {
	documentSourceRecordId: string;
	documentName: string;
	documentDate: string | null;
	documentType: string | null;
	currency: string;
	monthlyAmountMinor: number;
	basis: string;
	serviceEndDate: string | null;
	autoRenews: boolean | null;
};

export type ContractFramePrice = {
	documentSourceRecordId: string;
	documentName: string;
	documentDate: string | null;
	currency: string;
	amountMinor: number;
	amountMillicents: number;
	label: string;
};

type SubscriptionRow = {
	organization_id: string;
	customer_id: string | null;
	subscription_id: string;
	subscription_status: string;
	plan: string | null;
	monthly_licensed_usd: number;
	subscription_observed_at: string | null;
};

type InvoiceRow = {
	organization_id: string;
	last_invoice_at: string | null;
	latest_invoice_amount_due_usd: number;
	invoices_due_30d_usd: number;
	invoices_due_365d_usd: number;
	invoices_paid_365d_usd: number;
	open_invoice_count: number;
	open_invoice_amount_usd: number;
	oldest_open_invoice_at: string | null;
};

type UsageRow = {
	organization_id: string;
	last_usage_at: string | null;
	usage_30d_usd: number;
	usage_365d_usd: number;
	current_cost_per_frame_millicents: number | null;
	recent_costs_per_frame_millicents: number[];
};

export type ContractAccountActivity = {
	organizationId: string;
	stripeCustomerId: string | null;
	stripeSubscriptionId: string | null;
	subscription: SubscriptionRow | null;
	invoices: InvoiceRow | null;
	usage: UsageRow | null;
};

type FindingDraft = {
	findingKey: string;
	contractCustomerId: string;
	productOrganizationId: string | null;
	kind: ContractFindingKind;
	severity: ContractFindingSeverity;
	title: string;
	summary: string;
	evidence: Record<string, unknown>;
};

type DatasetResponse = {
	status?: string;
	error?: string;
	data?: {
		cols?: Array<{ name?: unknown; display_name?: unknown }>;
		rows?: unknown[][];
	};
};

const MANAGED_KINDS = [
	ContractFindingKind.NO_PRODUCT_ACCOUNT,
	ContractFindingKind.NO_STRIPE_ACCOUNT,
	ContractFindingKind.AMBIGUOUS_ACCOUNT,
	ContractFindingKind.PRICE_MISMATCH,
	ContractFindingKind.POSSIBLE_MISSING_ADDENDUM,
	ContractFindingKind.INACTIVE_COMMITMENT,
	ContractFindingKind.MISSING_OCR,
	ContractFindingKind.SOURCE_DOCUMENT_REMOVED,
	ContractFindingKind.PAYMENT_RISK,
] as const;

export function contractCommercialBaseline(
	documents: readonly ReconciliationDocument[],
): ContractCommercialBaseline | null {
	const candidates: Array<ContractCommercialBaseline & { rank: number }> = [];
	for (const document of documents) {
		const parsed = document.parsed;
		const currency = stringValue(parsed.currency)?.toUpperCase();
		if (!currency) continue;
		const common = {
			documentSourceRecordId: document.sourceRecordId,
			documentName: document.name,
			documentDate: contractDocumentDate(document),
			documentType: stringValue(parsed.documentType),
			currency,
			serviceEndDate: dateValue(parsed.serviceEndDate),
			autoRenews:
				typeof parsed.autoRenews === "boolean" ? parsed.autoRenews : null,
		};
		const annual = positiveNumber(parsed.annualCommitmentAmountMinor);
		if (annual) {
			candidates.push({
				...common,
				monthlyAmountMinor: annual / 12,
				basis: "annual commitment",
				rank: baselineRank(document, 4),
			});
		}
		const contractValue = positiveNumber(parsed.contractValueAmountMinor);
		const cadence = stringValue(parsed.billingCadence);
		const monthlyValue = monthlyAmount(contractValue, cadence);
		if (monthlyValue) {
			candidates.push({
				...common,
				monthlyAmountMinor: monthlyValue,
				basis: `contract value billed ${cadence?.toLowerCase()}`,
				rank: baselineRank(document, 2),
			});
		}
		for (const term of commercialTerms(parsed.commercialTerms)) {
			if (term.isMinimumCommitment !== true) continue;
			const amount = positiveNumber(term.amountMinor);
			const termCurrency = stringValue(term.currency)?.toUpperCase();
			const termCadence = stringValue(term.cadence);
			const normalized = monthlyAmount(amount, termCadence);
			if (!normalized || !termCurrency) continue;
			candidates.push({
				...common,
				currency: termCurrency,
				monthlyAmountMinor: normalized,
				basis: stringValue(term.label) ?? "minimum commitment",
				rank: baselineRank(document, 5),
			});
		}
	}

	const selected = candidates.sort(
		(left, right) =>
			right.rank - left.rank ||
			right.monthlyAmountMinor - left.monthlyAmountMinor,
	)[0];
	if (!selected) return null;
	const { rank: _rank, ...baseline } = selected;
	return baseline;
}

export function contractFramePrices(
	documents: readonly ReconciliationDocument[],
): ContractFramePrice[] {
	const prices: ContractFramePrice[] = [];
	for (const document of documents) {
		for (const term of commercialTerms(document.parsed.commercialTerms)) {
			const label = stringValue(term.label) ?? "";
			const quote = stringValue(term.evidenceQuote) ?? "";
			if (!/per\s+frame|\/\s*frame/i.test(`${label} ${quote}`)) continue;
			const quotedPrice = quotedFramePrice(quote);
			const structuredMillicents = positiveNumber(term.amountMillicents);
			const structuredMinor = positiveNumber(term.amountMinor);
			const amountMillicents =
				stringValue(term.unit) === "FRAME"
					? (structuredMillicents ??
						quotedPrice?.amountMillicents ??
						(structuredMinor ? structuredMinor * 1_000 : null))
					: (quotedPrice?.amountMillicents ??
						structuredMillicents ??
						(structuredMinor ? structuredMinor * 1_000 : null));
			const currency =
				stringValue(term.currency)?.toUpperCase() ?? quotedPrice?.currency;
			if (!amountMillicents || !currency) continue;
			const amountMinor = amountMillicents / 1_000;
			prices.push({
				documentSourceRecordId: document.sourceRecordId,
				documentName: document.name,
				documentDate: contractDocumentDate(document),
				currency,
				amountMinor,
				amountMillicents,
				label,
			});
		}
	}
	return prices.sort(
		(left, right) =>
			Date.parse(right.documentDate ?? "1970-01-01") -
			Date.parse(left.documentDate ?? "1970-01-01"),
	);
}

function quotedFramePrice(
	quote: string,
): { amountMillicents: number; currency: string } | null {
	const candidates: Array<{ index: number; value: string }> = [];
	for (const match of quote.matchAll(
		/(?:USD|US\$|\$)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*frame|per\s+frame)/gi,
	)) {
		candidates.push({ index: match.index, value: match[1] ?? "" });
	}
	for (const match of quote.matchAll(
		/(?:per\s+frame|\/\s*frame)\s*(?:\||:|-)\s*(?:USD|US\$|\$)\s*([0-9]+(?:\.[0-9]+)?)/gi,
	)) {
		candidates.push({ index: match.index, value: match[1] ?? "" });
	}
	const selected = candidates.sort(
		(left, right) => right.index - left.index,
	)[0];
	const value = Number(selected?.value);
	if (!Number.isFinite(value) || value <= 0) return null;
	return { amountMillicents: value * 100_000, currency: "USD" };
}

export async function reconcileContracts(): Promise<{
	configured: boolean;
	deferred: boolean;
	pendingDocuments: number;
	findings: number;
	resolved: number;
}> {
	const pendingDocuments = await db.contractDocument.count({
		where: { textStatus: "EXTRACTED", parseStatus: "PENDING" },
	});
	if (pendingDocuments > 0) {
		return {
			configured: metabaseConfigured(),
			deferred: true,
			pendingDocuments,
			findings: 0,
			resolved: 0,
		};
	}

	const customers = await db.contractCustomer.findMany({
		where: { sourceDeletedAt: null },
		select: {
			id: true,
			folderName: true,
			kind: true,
			documents: {
				select: {
					sourceRecordId: true,
					textStatus: true,
					parseStatus: true,
					extractionError: true,
					parsed: true,
					sourceRecord: {
						select: { payload: true, sourceUpdatedAt: true },
					},
				},
			},
			productOrganizations: {
				select: {
					id: true,
					status: true,
					confidence: true,
					productOrganizationId: true,
					productOrganization: {
						select: {
							externalId: true,
							name: true,
							plan: true,
							stripeCustomerId: true,
							stripeSubscriptionId: true,
						},
					},
				},
			},
		},
	});
	const verified = customers.flatMap((customer) =>
		customer.kind === ContractCustomerKind.ENTERPRISE
			? customer.productOrganizations.filter(
					(mapping) => mapping.status === ContractMappingStatus.VERIFIED,
				)
			: [],
	);
	const activityResult = await contractAccountActivities(
		verified.map((mapping) => ({
			organizationId: mapping.productOrganization.externalId,
			stripeCustomerId: mapping.productOrganization.stripeCustomerId,
			stripeSubscriptionId: mapping.productOrganization.stripeSubscriptionId,
		})),
	);
	if (!activityResult.configured) {
		return {
			configured: false,
			deferred: false,
			pendingDocuments,
			findings: 0,
			resolved: 0,
		};
	}

	const dataThrough = new Date();
	const drafts: FindingDraft[] = [];
	for (const customer of customers) {
		const documents = customer.documents.flatMap((document) => {
			if (
				document.parseStatus !== "PARSED" ||
				!document.parsed ||
				typeof document.parsed !== "object" ||
				Array.isArray(document.parsed)
			) {
				return [];
			}
			const payload = document.sourceRecord.payload as { name?: unknown };
			return [
				{
					sourceRecordId: document.sourceRecordId,
					name: stringValue(payload.name) ?? document.sourceRecordId,
					sourceUpdatedAt: document.sourceRecord.sourceUpdatedAt,
					parsed: document.parsed as ParsedContract,
				},
			];
		});
		const verifiedMappings = customer.productOrganizations.filter(
			(mapping) => mapping.status === ContractMappingStatus.VERIFIED,
		);
		const suggestions = customer.productOrganizations.filter(
			(mapping) => mapping.status === ContractMappingStatus.SUGGESTED,
		);
		const ocrDocuments = customer.documents.filter(
			(document) => document.textStatus === "NEEDS_OCR",
		);
		const removedDocuments = customer.documents.filter(
			(document) =>
				document.textStatus === "FAILED" &&
				document.extractionError === "Drive PDF says the document was removed.",
		);
		if (removedDocuments.length > 0) {
			drafts.push({
				findingKey: `${customer.id}:source-document-removed`,
				contractCustomerId: customer.id,
				productOrganizationId: null,
				kind: ContractFindingKind.SOURCE_DOCUMENT_REMOVED,
				severity: ContractFindingSeverity.CRITICAL,
				title: `${customer.folderName} has a removed source document`,
				summary: `${removedDocuments.length} Drive PDF is only a removal notice. Restore or replace the agreement before reconciliation.`,
				evidence: {
					documentSourceRecordIds: removedDocuments.map(
						(document) => document.sourceRecordId,
					),
				},
			});
		}
		if (ocrDocuments.length > 0) {
			drafts.push({
				findingKey: `${customer.id}:missing-ocr`,
				contractCustomerId: customer.id,
				productOrganizationId: null,
				kind: ContractFindingKind.MISSING_OCR,
				severity: ContractFindingSeverity.WARNING,
				title: `${customer.folderName} has a contract that needs OCR`,
				summary: `${ocrDocuments.length} document cannot be parsed until image text is extracted.`,
				evidence: {
					documentSourceRecordIds: ocrDocuments.map(
						(document) => document.sourceRecordId,
					),
				},
			});
		}
		if (customer.kind !== ContractCustomerKind.ENTERPRISE) continue;
		if (verifiedMappings.length === 0) {
			const ambiguous = suggestions.length > 1;
			drafts.push({
				findingKey: `${customer.id}:${ambiguous ? "ambiguous-account" : "no-product-account"}`,
				contractCustomerId: customer.id,
				productOrganizationId: null,
				kind: ambiguous
					? ContractFindingKind.AMBIGUOUS_ACCOUNT
					: ContractFindingKind.NO_PRODUCT_ACCOUNT,
				severity: ContractFindingSeverity.WARNING,
				title: ambiguous
					? `${customer.folderName} has no verified Product account`
					: `${customer.folderName} has no Product account match`,
				summary: ambiguous
					? `${suggestions.length} candidate organizations need a human decision.`
					: "Atlas found no Product organization with enough identity evidence.",
				evidence: {
					suggestedProductOrganizationIds: suggestions.map(
						(mapping) => mapping.productOrganization.externalId,
					),
				},
			});
		}
		const baseline = contractCommercialBaseline(documents);
		const framePrices = contractFramePrices(documents);
		for (const mapping of verifiedMappings) {
			const activity = activityResult.activities.get(
				mapping.productOrganization.externalId,
			);
			if (!activity) continue;
			drafts.push(
				...commercialFindingDrafts({
					customerId: customer.id,
					customerName: customer.folderName,
					productOrganizationId: mapping.productOrganizationId,
					productOrganizationExternalId: mapping.productOrganization.externalId,
					productOrganizationName: mapping.productOrganization.name,
					baseline,
					framePrices,
					activity,
				}),
			);
		}
	}

	const seenKeys: string[] = [];
	for (const draft of drafts) {
		seenKeys.push(draft.findingKey);
		const existing = await db.contractFinding.findUnique({
			where: { findingKey: draft.findingKey },
			select: { status: true },
		});
		const status =
			existing?.status === ContractFindingStatus.RESOLVED
				? ContractFindingStatus.OPEN
				: existing?.status;
		await db.contractFinding.upsert({
			where: { findingKey: draft.findingKey },
			create: {
				...draft,
				evidence: inputJson(draft.evidence),
				dataThrough,
			},
			update: {
				productOrganizationId: draft.productOrganizationId,
				kind: draft.kind,
				severity: draft.severity,
				title: draft.title,
				summary: draft.summary,
				evidence: inputJson(draft.evidence),
				dataThrough,
				lastSeenAt: dataThrough,
				resolvedAt: null,
				...(status ? { status } : {}),
			},
		});
	}
	const resolved = await db.contractFinding.updateMany({
		where: {
			kind: { in: [...MANAGED_KINDS] },
			status: {
				in: [ContractFindingStatus.OPEN, ContractFindingStatus.ACKNOWLEDGED],
			},
			...(seenKeys.length > 0 ? { findingKey: { notIn: seenKeys } } : {}),
		},
		data: { status: ContractFindingStatus.RESOLVED, resolvedAt: dataThrough },
	});

	return {
		configured: true,
		deferred: false,
		pendingDocuments,
		findings: drafts.length,
		resolved: resolved.count,
	};
}

export function commercialFindingDrafts(input: {
	customerId: string;
	customerName: string;
	productOrganizationId: string;
	productOrganizationExternalId: string;
	productOrganizationName: string | null;
	baseline: ContractCommercialBaseline | null;
	framePrices: readonly ContractFramePrice[];
	activity: ContractAccountActivity;
}): FindingDraft[] {
	const drafts: FindingDraft[] = [];
	const commonEvidence = {
		productOrganizationExternalId: input.productOrganizationExternalId,
		productOrganizationName: input.productOrganizationName,
		stripeCustomerId: input.activity.stripeCustomerId,
		stripeSubscriptionId: input.activity.stripeSubscriptionId,
	};
	if (!input.activity.stripeCustomerId) {
		drafts.push({
			findingKey: `${input.customerId}:${input.productOrganizationExternalId}:no-stripe-account`,
			contractCustomerId: input.customerId,
			productOrganizationId: input.productOrganizationId,
			kind: ContractFindingKind.NO_STRIPE_ACCOUNT,
			severity: ContractFindingSeverity.WARNING,
			title: `${input.customerName} has no Stripe customer ID`,
			summary:
				"The verified Product organization does not have a Stripe customer ID.",
			evidence: commonEvidence,
		});
	}
	if (
		input.baseline &&
		input.baseline.currency === "USD" &&
		contractIsCurrent(input.baseline)
	) {
		const monthlyUsd = input.baseline.monthlyAmountMinor / 100;
		const usage30 = input.activity.usage?.usage_30d_usd ?? 0;
		if (usage30 + 0.01 < monthlyUsd) {
			drafts.push({
				findingKey: `${input.customerId}:${input.productOrganizationExternalId}:inactive-commitment`,
				contractCustomerId: input.customerId,
				productOrganizationId: input.productOrganizationId,
				kind: ContractFindingKind.INACTIVE_COMMITMENT,
				severity: ContractFindingSeverity.WARNING,
				title: `${input.customerName} is below its monthly contract baseline`,
				summary: `Trailing 30-day usage is $${usage30.toFixed(2)} against a $${monthlyUsd.toFixed(2)} monthlyized commitment.`,
				evidence: {
					...commonEvidence,
					baseline: input.baseline,
					usage30Usd: usage30,
					lastUsageAt: input.activity.usage?.last_usage_at ?? null,
					activityRule: "trailing 30-day usage at least monthlyized commitment",
				},
			});
		}
	}

	const invoices = input.activity.invoices;
	const oldestOpenInvoiceAt = invoices?.oldest_open_invoice_at ?? null;
	const openInvoiceAgeDays = oldestOpenInvoiceAt
		? Math.floor((Date.now() - Date.parse(oldestOpenInvoiceAt)) / 86_400_000)
		: 0;
	if (
		invoices &&
		invoices.open_invoice_count > 0 &&
		invoices.open_invoice_amount_usd > 0 &&
		openInvoiceAgeDays >= 30
	) {
		const usage30 = input.activity.usage?.usage_30d_usd ?? 0;
		drafts.push({
			findingKey: `${input.customerId}:${input.productOrganizationExternalId}:payment-risk`,
			contractCustomerId: input.customerId,
			productOrganizationId: input.productOrganizationId,
			kind: ContractFindingKind.PAYMENT_RISK,
			severity:
				usage30 <= 0
					? ContractFindingSeverity.CRITICAL
					: ContractFindingSeverity.WARNING,
			title:
				usage30 <= 0
					? `${input.customerName} has old open invoices and no recent usage`
					: `${input.customerName} has old open Stripe invoices`,
			summary: `${invoices.open_invoice_count} open invoices have $${invoices.open_invoice_amount_usd.toFixed(2)} unpaid. The oldest was created ${openInvoiceAgeDays} days ago.`,
			evidence: {
				...commonEvidence,
				openInvoiceCount: invoices.open_invoice_count,
				openInvoiceAmountUsd: invoices.open_invoice_amount_usd,
				oldestOpenInvoiceAt,
				openInvoiceAgeDays,
				usage30Usd: usage30,
				lastUsageAt: input.activity.usage?.last_usage_at ?? null,
			},
		});
	}

	const currentFrame =
		input.activity.usage?.current_cost_per_frame_millicents ?? null;
	const usdFramePrices = input.framePrices.filter(
		(price) => price.currency === "USD",
	);
	if (
		currentFrame &&
		usdFramePrices.length > 0 &&
		!usdFramePrices.some(
			(price) => !materiallyDifferent(price.amountMillicents, currentFrame),
		)
	) {
		const latest = usdFramePrices[0];
		const observedUsd = currentFrame / 100_000;
		const contractedUsd = (latest?.amountMinor ?? 0) / 100;
		const evidence = {
			...commonEvidence,
			contractFramePrices: usdFramePrices,
			observedCostPerFrameMillicents: currentFrame,
			observedCostPerFrameUsd: observedUsd,
			recentCostsPerFrameMillicents:
				input.activity.usage?.recent_costs_per_frame_millicents ?? [],
			lastUsageAt: input.activity.usage?.last_usage_at ?? null,
		};
		drafts.push({
			findingKey: `${input.customerId}:${input.productOrganizationExternalId}:frame-price-mismatch`,
			contractCustomerId: input.customerId,
			productOrganizationId: input.productOrganizationId,
			kind: ContractFindingKind.PRICE_MISMATCH,
			severity: ContractFindingSeverity.CRITICAL,
			title: `${input.customerName} per-frame prices differ`,
			summary: `The latest contract frame price is $${contractedUsd.toFixed(4)}. Current Product usage is priced at $${observedUsd.toFixed(4)} per frame.`,
			evidence,
		});
		if (
			observedAfterDocument(
				input.activity.usage?.last_usage_at ?? null,
				latest?.documentDate ?? null,
			)
		) {
			drafts.push({
				findingKey: `${input.customerId}:${input.productOrganizationExternalId}:possible-missing-frame-addendum`,
				contractCustomerId: input.customerId,
				productOrganizationId: input.productOrganizationId,
				kind: ContractFindingKind.POSSIBLE_MISSING_ADDENDUM,
				severity: ContractFindingSeverity.CRITICAL,
				title: `${input.customerName} may be missing a frame-price addendum`,
				summary:
					"Current Product usage has a frame price that is not present in the parsed contract set.",
				evidence,
			});
		}
	}

	return drafts;
}

async function contractAccountActivities(
	organizations: Array<{
		organizationId: string;
		stripeCustomerId: string | null;
		stripeSubscriptionId: string | null;
	}>,
): Promise<{
	configured: boolean;
	activities: Map<string, ContractAccountActivity>;
}> {
	if (!metabaseConfigured()) {
		return { configured: false, activities: new Map() };
	}
	const unique = [
		...new Map(
			organizations.map((organization) => [
				organization.organizationId,
				organization,
			]),
		).values(),
	].filter((organization) =>
		/^[0-9a-f-]{36}$/.test(organization.organizationId),
	);
	if (unique.length === 0) {
		return { configured: true, activities: new Map() };
	}
	const ids = unique
		.map((organization) => `'${organization.organizationId}'`)
		.join(",");
	const [subscriptions, invoices, usage] = await Promise.all([
		revenueRows(subscriptionQuery(ids)) as Promise<SubscriptionRow[]>,
		revenueRows(invoiceQuery(ids)) as Promise<InvoiceRow[]>,
		revenueRows(usageQuery(ids)) as Promise<UsageRow[]>,
	]);
	const subscriptionsByOrganization = new Map<string, SubscriptionRow[]>();
	for (const subscription of subscriptions) {
		const list =
			subscriptionsByOrganization.get(subscription.organization_id) ?? [];
		list.push(subscription);
		subscriptionsByOrganization.set(subscription.organization_id, list);
	}
	const invoiceByOrganization = new Map(
		invoices.map((row) => [row.organization_id, row]),
	);
	const usageByOrganization = new Map(
		usage.map((row) => [row.organization_id, row]),
	);
	const activities = new Map<string, ContractAccountActivity>();
	for (const organization of unique) {
		const currentSubscription = (
			subscriptionsByOrganization.get(organization.organizationId) ?? []
		).sort(
			(left, right) =>
				subscriptionRank(right) - subscriptionRank(left) ||
				Date.parse(right.subscription_observed_at ?? "1970-01-01") -
					Date.parse(left.subscription_observed_at ?? "1970-01-01"),
		)[0];
		activities.set(organization.organizationId, {
			organizationId: organization.organizationId,
			stripeCustomerId: organization.stripeCustomerId,
			stripeSubscriptionId: organization.stripeSubscriptionId,
			subscription: currentSubscription ?? null,
			invoices: invoiceByOrganization.get(organization.organizationId) ?? null,
			usage: usageByOrganization.get(organization.organizationId) ?? null,
		});
	}
	return { configured: true, activities };
}

async function revenueRows(
	query: string,
): Promise<Array<Record<string, unknown>>> {
	const baseUrl = process.env.METABASE_BASE_URL?.trim().replace(/\/$/, "");
	const apiKey = process.env.METABASE_API_KEY?.trim();
	if (!baseUrl || !apiKey) return [];
	const databaseExternalId = await db.question.findFirst({
		where: { number: 1122 },
		select: { databaseExternalId: true },
	});
	const database = Number(databaseExternalId?.databaseExternalId);
	if (!Number.isSafeInteger(database) || database <= 0) {
		throw new Error(
			"The enterprise revenue question has no database connection.",
		);
	}
	const response = await fetch(`${baseUrl}/api/dataset`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
		body: JSON.stringify({
			database,
			type: "native",
			native: { query },
			parameters: [],
		}),
		signal: AbortSignal.timeout(75_000),
	});
	if (!response.ok) {
		throw new Error(
			`Contract reconciliation query failed (${response.status}).`,
		);
	}
	const body = (await response.json()) as DatasetResponse;
	if (body.status === "failed" || body.error) {
		throw new Error("Contract reconciliation query failed.");
	}
	const columns = (body.data?.cols ?? []).map((column) =>
		String(column.name ?? column.display_name ?? "column"),
	);
	return (body.data?.rows ?? []).map((row) =>
		Object.fromEntries(
			columns.map((column, index) => [column, row[index] ?? null]),
		),
	);
}

function subscriptionQuery(ids: string): string {
	return `WITH payloads AS (
  SELECT id,
    argMax(organizationId, tuple(currentPeriodEnd, currentPeriodStart, createdAt, eventType)) AS organization_id,
    argMax(customerId, tuple(currentPeriodEnd, currentPeriodStart, createdAt, eventType)) AS customer_id,
    argMax(currentPeriodStart, tuple(currentPeriodEnd, currentPeriodStart, createdAt, eventType)) AS subscription_observed_at,
    argMax(payload, tuple(currentPeriodEnd, currentPeriodStart, createdAt, eventType)) AS payload
  FROM sync_prod.sync_stripe_subscriptions
  WHERE organizationId IN (${ids})
  GROUP BY id
), states AS (
  SELECT id,
    argMax(status, tuple(currentPeriodEnd, currentPeriodStart, createdAt, eventType)) AS subscription_status,
    argMax(plan, tuple(currentPeriodEnd, currentPeriodStart, createdAt, eventType)) AS plan
  FROM sync_prod.sync_stripe_subscriptions_with_plan
  WHERE organizationId IN (${ids})
  GROUP BY id
), items AS (
  SELECT payloads.organization_id, payloads.customer_id, payloads.id AS subscription_id,
    payloads.subscription_observed_at, states.subscription_status, states.plan,
    arrayJoin(JSONExtractArrayRaw(payloads.payload, 'items', 'data')) AS item
  FROM payloads
  INNER JOIN states USING (id)
)
SELECT organization_id, customer_id, subscription_id, subscription_status, plan,
  round(sumIf(
    JSONExtractInt(item, 'price', 'unit_amount') * greatest(JSONExtractInt(item, 'quantity'), 1) / 100.0 /
    if(JSONExtractString(item, 'price', 'recurring', 'interval') = 'year',
      12 * greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1),
      greatest(JSONExtractInt(item, 'price', 'recurring', 'interval_count'), 1)),
    JSONExtractString(item, 'price', 'recurring', 'usage_type') = 'licensed'
  ), 2) AS monthly_licensed_usd,
  subscription_observed_at
FROM items
GROUP BY organization_id, customer_id, subscription_id, subscription_status, plan, subscription_observed_at`;
}

function invoiceQuery(ids: string): string {
	return `WITH states AS (
  SELECT id,
    argMax(organizationId, tuple(createdAt, eventType, status, amountPaid)) AS organization_id,
    min(createdAt) AS created_at,
    max(amountDue) AS amount_due,
    max(amountPaid) AS amount_paid,
	argMax(status, tuple(createdAt, eventType, status, amountPaid)) AS latest_status,
    countIf(status = 'void') > 0 AS was_voided
  FROM sync_prod.sync_stripe_invoices
  WHERE organizationId IN (${ids})
  GROUP BY id
)
SELECT organization_id,
  max(created_at) AS last_invoice_at,
  argMaxIf(amount_due, created_at, not was_voided) / 100.0 AS latest_invoice_amount_due_usd,
  round(sumIf(amount_due, not was_voided AND created_at >= addDays(now(), -30)) / 100.0, 2) AS invoices_due_30d_usd,
  round(sumIf(amount_due, not was_voided AND created_at >= addDays(now(), -365)) / 100.0, 2) AS invoices_due_365d_usd,
  round(sumIf(amount_paid, not was_voided AND created_at >= addDays(now(), -365)) / 100.0, 2) AS invoices_paid_365d_usd,
  countIf(not was_voided AND latest_status = 'open' AND amount_paid < amount_due) AS open_invoice_count,
  round(sumIf(amount_due - amount_paid, not was_voided AND latest_status = 'open' AND amount_paid < amount_due) / 100.0, 2) AS open_invoice_amount_usd,
  minIf(created_at, not was_voided AND latest_status = 'open' AND amount_paid < amount_due) AS oldest_open_invoice_at
FROM states
GROUP BY organization_id`;
}

function usageQuery(ids: string): string {
	return `SELECT organizationId AS organization_id,
  max(generationEndedAt) AS last_usage_at,
  round(sumIf(generationCostMillicents, generationEndedAt >= addDays(now(), -30)) / 100000.0, 2) AS usage_30d_usd,
  round(sumIf(generationCostMillicents, generationEndedAt >= addDays(now(), -365)) / 100000.0, 2) AS usage_365d_usd,
  argMax(costPerFrameMillicents, generationEndedAt) AS current_cost_per_frame_millicents,
  groupUniqArrayIf(costPerFrameMillicents, generationEndedAt >= addDays(now(), -90)) AS recent_costs_per_frame_millicents
FROM sync_prod.sync_usage3
WHERE organizationId IN (${ids})
GROUP BY organizationId`;
}

function commercialTerms(value: unknown): CommercialTerm[] {
	return Array.isArray(value)
		? value.filter(
				(term): term is CommercialTerm =>
					Boolean(term) && typeof term === "object" && !Array.isArray(term),
			)
		: [];
}

function positiveNumber(value: unknown): number | null {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function stringValue(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function dateValue(value: unknown): string | null {
	const date = stringValue(value);
	return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function monthlyAmount(
	amount: number | null,
	cadence: string | null,
): number | null {
	if (!amount || !cadence) return null;
	switch (cadence.toUpperCase()) {
		case "MONTHLY":
			return amount;
		case "QUARTERLY":
			return amount / 3;
		case "ANNUAL":
			return amount / 12;
		default:
			return null;
	}
}

function contractDocumentDate(document: ReconciliationDocument): string | null {
	return (
		dateValue(document.parsed.effectiveDate) ??
		dateValue(document.parsed.serviceStartDate) ??
		document.sourceUpdatedAt?.toISOString() ??
		null
	);
}

function baselineRank(
	document: ReconciliationDocument,
	termPriority: number,
): number {
	const type = stringValue(document.parsed.documentType);
	const typePriority =
		type === "AMENDMENT"
			? 5
			: type === "ORDER_FORM"
				? 4
				: type === "SOW"
					? 3
					: type === "MSA"
						? 2
						: 1;
	const timestamp = Date.parse(contractDocumentDate(document) ?? "1970-01-01");
	return timestamp + typePriority * 10_000 + termPriority;
}

function contractIsCurrent(baseline: ContractCommercialBaseline): boolean {
	if (!baseline.serviceEndDate || baseline.autoRenews === true) return true;
	return Date.parse(`${baseline.serviceEndDate}T23:59:59Z`) >= Date.now();
}

function materiallyDifferent(left: number, right: number): boolean {
	const difference = Math.abs(left - right);
	return (
		difference > Math.max(1, Math.max(Math.abs(left), Math.abs(right)) * 0.05)
	);
}

function observedAfterDocument(
	observedAt: string | null,
	documentDate: string | null,
): boolean {
	if (!observedAt || !documentDate) return false;
	return Date.parse(observedAt) > Date.parse(documentDate);
}

function subscriptionRank(subscription: SubscriptionRow): number {
	switch (subscription.subscription_status) {
		case "active":
			return 3;
		case "past_due":
			return 2;
		default:
			return 1;
	}
}

function metabaseConfigured(): boolean {
	return Boolean(
		process.env.METABASE_BASE_URL?.trim() &&
			process.env.METABASE_API_KEY?.trim(),
	);
}
