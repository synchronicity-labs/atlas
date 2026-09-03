import { createHash, randomUUID } from "node:crypto";
import {
	ContractCustomerKind,
	ContractFindingKind,
	ContractFindingStatus,
	ContractMappingStatus,
	type Db,
	type Prisma,
	RevenueDoor,
	RevenueDoorMatchKind,
	SourceStatus,
	SyncMode,
	SyncRunStatus,
	VerificationStatus,
} from "@crm/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	ProductMetricPublisher,
	type PublishVerificationCheck,
} from "../metabase/product-metric.publisher";
import {
	type ContractsReportingQuery,
	contractsReportingQuery,
} from "./contracts-reporting.contracts";

const SOURCE_KEY = "atlas:contracts";
const FRESHNESS_MS = 7 * 60 * 60 * 1000;
const OPEN_STATUSES = [
	ContractFindingStatus.OPEN,
	ContractFindingStatus.ACKNOWLEDGED,
] as const;
const ACCOUNT_GAP_KINDS = [
	ContractFindingKind.NO_PRODUCT_ACCOUNT,
	ContractFindingKind.NO_STRIPE_ACCOUNT,
	ContractFindingKind.AMBIGUOUS_ACCOUNT,
] as const;

type ResultColumn = {
	name: string;
	displayName: string;
	baseType: string;
};

type Result = {
	columns: ResultColumn[];
	rows: unknown[][];
};

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function column(
	name: string,
	displayName: string,
	baseType = "type/Text",
): ResultColumn {
	return { name, displayName, baseType };
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function numberValue(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.flatMap((item) => {
				const text = stringValue(item);
				return text ? [text] : [];
			})
		: [];
}

function round(value: number, digits: number): number {
	const scale = 10 ** digits;
	return Math.round(value * scale) / scale;
}

function errorMessage(error: unknown): string {
	return error instanceof Error
		? error.message
		: "Unknown contract reporting error.";
}

function paymentStatus(value: unknown): string | null {
	const payload = record(value);
	for (const key of ["status", "subscriptionStatus", "paymentStatus"]) {
		const result = stringValue(payload[key]);
		if (result) return result;
	}
	return null;
}

type StoredCommercialBaseline = {
	documentName: string;
	documentDate: string | null;
	documentType: string | null;
	currency: string;
	monthlyAmountMinor: number;
	annualizedAmountMinor: number;
	basis: string;
	serviceEndDate: string | null;
	autoRenews: boolean | null;
	isCurrent: boolean;
};

function storedCommercialBaseline(
	value: unknown,
): StoredCommercialBaseline | null {
	const payload = record(value);
	const documentName = stringValue(payload.documentName);
	const currency = stringValue(payload.currency)?.toUpperCase();
	const monthlyAmountMinor = numberValue(payload.monthlyAmountMinor);
	const annualizedAmountMinor = numberValue(payload.annualizedAmountMinor);
	const basis = stringValue(payload.basis);
	if (
		!documentName ||
		!currency ||
		monthlyAmountMinor == null ||
		annualizedAmountMinor == null ||
		!basis ||
		typeof payload.isCurrent !== "boolean"
	) {
		return null;
	}
	return {
		documentName,
		documentDate: stringValue(payload.documentDate),
		documentType: stringValue(payload.documentType),
		currency,
		monthlyAmountMinor,
		annualizedAmountMinor,
		basis,
		serviceEndDate: stringValue(payload.serviceEndDate),
		autoRenews:
			typeof payload.autoRenews === "boolean" ? payload.autoRenews : null,
		isCurrent: payload.isCurrent,
	};
}

export function enterpriseContractValueVerificationChecks(
	result: Result,
): PublishVerificationCheck[] {
	const row = result.rows[0] ?? [];
	const value = numberValue(row[1]);
	const enterpriseCustomers = numberValue(row[6]);
	const coveragePresent = value != null && enterpriseCustomers != null;
	return [
		{
			name: "stored_commercial_baselines",
			status: coveragePresent
				? VerificationStatus.PASSED
				: VerificationStatus.FAILED,
			reason: coveragePresent
				? "The report contains a numeric USD total and explicit enterprise customer coverage."
				: "The report is missing the USD total or enterprise customer coverage.",
		},
		{
			name: "currency_separation",
			status: VerificationStatus.PASSED,
			reason:
				"Only active USD baselines enter the USD total. Active non-USD baselines are counted separately.",
		},
	];
}

@Injectable()
export class ContractsReportingService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly metricPublisher: ProductMetricPublisher,
	) {}

	async preview(queryText: string): Promise<Result> {
		return this.execute(contractsReportingQuery.parse(JSON.parse(queryText)));
	}

	async syncDashboard(number = 13) {
		const dashboard = await this.db.dashboard.findUnique({
			where: { number },
			select: {
				cards: {
					orderBy: { position: "asc" },
					select: {
						question: {
							select: {
								id: true,
								number: true,
								name: true,
								description: true,
								connector: true,
								sourceId: true,
								sourceExternalId: true,
								databaseExternalId: true,
								metricVersionId: true,
								versions: {
									orderBy: { version: "desc" },
									take: 1,
									select: {
										id: true,
										version: true,
										queryLanguage: true,
										queryText: true,
									},
								},
							},
						},
					},
				},
			},
		});
		if (!dashboard) {
			throw new NotFoundException(`No Atlas dashboard ${number}.`);
		}
		const source = await this.db.dataSource.findUnique({
			where: { key: SOURCE_KEY },
		});
		const questions = [
			...new Map(
				dashboard.cards.map((card) => [card.question.id, card.question]),
			).values(),
		].filter((question) => {
			const version = question.versions[0];
			if (version?.queryLanguage !== "API") return false;
			try {
				contractsReportingQuery.parse(JSON.parse(version.queryText));
				return true;
			} catch {
				return false;
			}
		});
		if (
			!source ||
			questions.length === 0 ||
			questions.some((question) => question.sourceId !== source.id)
		) {
			throw new Error("The contract reporting source is not configured.");
		}
		const reportingPeriod = new Date().toISOString().slice(0, 7);
		const run = await this.db.syncRun.create({
			data: {
				runKey: `${SOURCE_KEY}:${reportingPeriod}:${randomUUID()}`,
				sourceId: source.id,
				mode: SyncMode.INCREMENTAL,
				status: SyncRunStatus.RUNNING,
				scope: `dashboard:${number}`,
				period: reportingPeriod,
			},
		});
		await this.db.dataSource.update({
			where: { id: source.id },
			data: { state: SourceStatus.SYNCING, lastError: null },
		});
		let cardsProcessed = 0;
		let snapshotsCreated = 0;
		try {
			for (const question of questions) {
				const version = question.versions[0];
				if (!version) continue;
				const result = await this.execute(
					contractsReportingQuery.parse(JSON.parse(version.queryText)),
				);
				const payload = { columns: result.columns, rows: result.rows };
				const contentHash = hash(payload);
				const externalId =
					question.sourceExternalId ?? `contracts:question:${question.number}`;
				const capturedAt = new Date();
				const created = await this.db.resultSnapshot.createMany({
					data: [
						{
							idempotencyKey: `${SOURCE_KEY}:${externalId}:v${version.version}:${reportingPeriod}:${contentHash}`,
							sourceId: source.id,
							dashboardExternalId: `atlas:${number}`,
							questionExternalId: externalId,
							reportingPeriod,
							capturedAt,
							contentHash,
							columns: json(result.columns),
							rows: json(result.rows),
							rowCount: result.rows.length,
						},
					],
					skipDuplicates: true,
				});
				await this.db.question.update({
					where: { id: question.id },
					data: { lastCheckedAt: capturedAt },
				});
				if (externalId === "atlas:contracts:enterprise-contract-value") {
					await this.metricPublisher.publish({
						question,
						version,
						result,
						syncRunId: run.id,
						capturedAt,
						verificationChecks:
							enterpriseContractValueVerificationChecks(result),
					});
				}
				cardsProcessed += 1;
				snapshotsCreated += created.count;
			}
			const finishedAt = new Date();
			await this.db.$transaction([
				this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: SyncRunStatus.COMPLETED,
						finishedAt,
						dataThrough: finishedAt,
						cardsProcessed,
						snapshotsCreated,
					},
				}),
				this.db.dataSource.update({
					where: { id: source.id },
					data: {
						state: SourceStatus.HEALTHY,
						lastSyncAt: finishedAt,
						lastError: null,
						freshnessDeadlineAt: new Date(finishedAt.getTime() + FRESHNESS_MS),
					},
				}),
			]);
			return { cardsProcessed, snapshotsCreated, errors: [] };
		} catch (error) {
			const message = errorMessage(error);
			await this.db.$transaction([
				this.db.syncRun.update({
					where: { id: run.id },
					data: {
						status: SyncRunStatus.FAILED,
						finishedAt: new Date(),
						error: message,
						cardsProcessed,
						snapshotsCreated,
					},
				}),
				this.db.dataSource.update({
					where: { id: source.id },
					data: { state: SourceStatus.ERROR, lastError: message },
				}),
			]);
			throw error;
		}
	}

	private async execute(query: ContractsReportingQuery): Promise<Result> {
		switch (query.report) {
			case "action-summary":
				return this.actionSummary();
			case "price-mismatches":
				return this.priceMismatches();
			case "contract-account-gaps":
				return this.contractAccountGaps();
			case "product-account-gaps":
				return this.productAccountGaps();
			case "open-findings":
				return this.openFindings();
			case "ingestion-health":
				return this.ingestionHealth();
			case "customer-coverage":
				return this.customerCoverage();
			case "enterprise-contract-value":
				return this.enterpriseContractValue();
			case "enterprise-contract-commitments":
				return this.enterpriseContractCommitments();
		}
	}

	private async enterpriseContractValue(): Promise<Result> {
		const customers = await this.db.contractCustomer.findMany({
			where: {
				kind: ContractCustomerKind.ENTERPRISE,
				sourceDeletedAt: null,
			},
			select: {
				commercialBaseline: true,
				commercialBaselineUpdatedAt: true,
			},
		});
		const baselines = customers.map((customer) => ({
			baseline: storedCommercialBaseline(customer.commercialBaseline),
			updatedAt: customer.commercialBaselineUpdatedAt,
		}));
		const active = baselines.filter((entry) => entry.baseline?.isCurrent);
		const activeUsd = active.filter(
			(entry) => entry.baseline?.currency === "USD",
		);
		const dataThrough = baselines.reduce<Date | null>(
			(latest, entry) =>
				entry.updatedAt && (!latest || entry.updatedAt > latest)
					? entry.updatedAt
					: latest,
			null,
		);
		const periodStart = new Date();
		periodStart.setUTCDate(1);
		periodStart.setUTCHours(0, 0, 0, 0);
		return {
			columns: [
				column("period_start", "Period start", "type/Date"),
				column(
					"annual_contract_value_usd",
					"Known active annual contract value USD",
					"type/Decimal",
				),
				column(
					"included_usd_customers",
					"Included USD customers",
					"type/Integer",
				),
				column(
					"active_non_usd_customers",
					"Active non-USD customers",
					"type/Integer",
				),
				column(
					"missing_baseline_customers",
					"Missing commitment customers",
					"type/Integer",
				),
				column(
					"expired_baseline_customers",
					"Expired commitment customers",
					"type/Integer",
				),
				column("enterprise_customers", "Enterprise customers", "type/Integer"),
				column("data_through", "Data through", "type/DateTime"),
			],
			rows: [
				[
					periodStart.toISOString(),
					round(
						activeUsd.reduce(
							(total, entry) =>
								total + (entry.baseline?.annualizedAmountMinor ?? 0),
							0,
						) / 100,
						2,
					),
					activeUsd.length,
					active.filter((entry) => entry.baseline?.currency !== "USD").length,
					baselines.filter((entry) => entry.baseline == null).length,
					baselines.filter(
						(entry) => entry.baseline && !entry.baseline.isCurrent,
					).length,
					customers.length,
					dataThrough?.toISOString() ?? null,
				],
			],
		};
	}

	private async enterpriseContractCommitments(): Promise<Result> {
		const customers = await this.db.contractCustomer.findMany({
			where: {
				kind: ContractCustomerKind.ENTERPRISE,
				sourceDeletedAt: null,
			},
			orderBy: { folderName: "asc" },
			select: {
				folderName: true,
				commercialBaseline: true,
				commercialBaselineUpdatedAt: true,
			},
		});
		return {
			columns: [
				column("customer", "Customer"),
				column(
					"annual_contract_value",
					"Annual contract value",
					"type/Decimal",
				),
				column("currency", "Currency"),
				column("monthly_baseline", "Monthly baseline", "type/Decimal"),
				column("basis", "Basis"),
				column("source_document", "Source document"),
				column("document_date", "Document date", "type/Date"),
				column("service_end_date", "Service end date", "type/Date"),
				column("current", "Current", "type/Boolean"),
				column("data_through", "Data through", "type/DateTime"),
			],
			rows: customers.map((customer) => {
				const baseline = storedCommercialBaseline(customer.commercialBaseline);
				return [
					customer.folderName,
					baseline ? round(baseline.annualizedAmountMinor / 100, 2) : null,
					baseline?.currency ?? null,
					baseline ? round(baseline.monthlyAmountMinor / 100, 2) : null,
					baseline?.basis ?? null,
					baseline?.documentName ?? null,
					baseline?.documentDate ?? null,
					baseline?.serviceEndDate ?? null,
					baseline?.isCurrent ?? null,
					customer.commercialBaselineUpdatedAt?.toISOString() ?? null,
				];
			}),
		};
	}

	private async actionSummary(): Promise<Result> {
		const [findings, pendingDocuments, ocrDocuments, productAccountGaps] =
			await Promise.all([
				this.db.contractFinding.findMany({
					where: { status: { in: [...OPEN_STATUSES] } },
					select: { kind: true, severity: true, dataThrough: true },
				}),
				this.db.contractDocument.count({
					where: {
						OR: [
							{ textStatus: "PENDING" },
							{ textStatus: "EXTRACTED", parseStatus: "PENDING" },
						],
					},
				}),
				this.db.contractDocument.count({ where: { textStatus: "NEEDS_OCR" } }),
				this.productAccountGaps(),
			]);
		const count = (kinds: readonly ContractFindingKind[]) =>
			findings.filter((finding) => kinds.includes(finding.kind)).length;
		const dataThrough = findings.reduce<Date | null>(
			(latest, finding) =>
				!latest || finding.dataThrough > latest ? finding.dataThrough : latest,
			null,
		);
		return {
			columns: [
				column("data_through", "Data through", "type/DateTime"),
				column("open_findings", "Open findings", "type/Integer"),
				column("critical_findings", "Critical findings", "type/Integer"),
				column("price_mismatches", "Price mismatches", "type/Integer"),
				column(
					"missing_addendums",
					"Possible missing addendums",
					"type/Integer",
				),
				column(
					"contract_account_gaps",
					"Contract folder account gaps",
					"type/Integer",
				),
				column(
					"product_account_gaps",
					"Product account contract gaps",
					"type/Integer",
				),
				column(
					"documents_needing_ocr",
					"Documents needing OCR",
					"type/Integer",
				),
				column("pending_documents", "Pending documents", "type/Integer"),
			],
			rows: [
				[
					dataThrough?.toISOString() ?? null,
					findings.length,
					findings.filter((finding) => finding.severity === "CRITICAL").length,
					count([ContractFindingKind.PRICE_MISMATCH]),
					count([ContractFindingKind.POSSIBLE_MISSING_ADDENDUM]),
					count(ACCOUNT_GAP_KINDS),
					productAccountGaps.rows.length,
					ocrDocuments,
					pendingDocuments,
				],
			],
		};
	}

	private async priceMismatches(): Promise<Result> {
		const findings = await this.db.contractFinding.findMany({
			where: {
				kind: ContractFindingKind.PRICE_MISMATCH,
				status: { in: [...OPEN_STATUSES] },
				contractCustomer: { kind: ContractCustomerKind.ENTERPRISE },
			},
			orderBy: [
				{ severity: "desc" },
				{ contractCustomer: { folderName: "asc" } },
			],
			select: {
				summary: true,
				evidence: true,
				dataThrough: true,
				contractCustomer: { select: { folderName: true } },
				productOrganization: {
					select: { name: true, externalId: true, stripeCustomerId: true },
				},
			},
		});
		return {
			columns: [
				column("customer", "Customer"),
				column("product_organization", "Product organization"),
				column("stripe_customer_id", "Stripe customer ID"),
				column(
					"contract_usd_per_frame",
					"Contract USD per frame",
					"type/Decimal",
				),
				column(
					"product_usd_per_frame",
					"Product USD per frame",
					"type/Decimal",
				),
				column("difference_usd", "Difference USD", "type/Decimal"),
				column("difference_percent", "Difference percent", "type/Decimal"),
				column("last_usage_at", "Last usage", "type/DateTime"),
				column("data_through", "Data through", "type/DateTime"),
				column("summary", "Finding"),
			],
			rows: findings.map((finding) => {
				const evidence = record(finding.evidence);
				const prices = Array.isArray(evidence.contractFramePrices)
					? evidence.contractFramePrices.map(record)
					: [];
				const contractMinor = numberValue(prices[0]?.amountMinor);
				const contractUsd = contractMinor == null ? null : contractMinor / 100;
				const productUsd = numberValue(evidence.observedCostPerFrameUsd);
				const difference =
					contractUsd == null || productUsd == null
						? null
						: productUsd - contractUsd;
				const differencePercent =
					contractUsd && productUsd != null
						? ((productUsd - contractUsd) / contractUsd) * 100
						: null;
				return [
					finding.contractCustomer.folderName,
					finding.productOrganization?.name ??
						finding.productOrganization?.externalId ??
						null,
					finding.productOrganization?.stripeCustomerId ??
						stringValue(evidence.stripeCustomerId),
					contractUsd == null ? null : round(contractUsd, 6),
					productUsd == null ? null : round(productUsd, 6),
					difference == null ? null : round(difference, 6),
					differencePercent == null ? null : round(differencePercent, 1),
					stringValue(evidence.lastUsageAt),
					finding.dataThrough.toISOString(),
					finding.summary,
				];
			}),
		};
	}

	private async contractAccountGaps(): Promise<Result> {
		const findings = await this.db.contractFinding.findMany({
			where: {
				kind: { in: [...ACCOUNT_GAP_KINDS] },
				status: { in: [...OPEN_STATUSES] },
				contractCustomer: { kind: ContractCustomerKind.ENTERPRISE },
			},
			orderBy: [{ contractCustomer: { folderName: "asc" } }, { kind: "asc" }],
			select: {
				kind: true,
				title: true,
				summary: true,
				evidence: true,
				dataThrough: true,
				contractCustomer: { select: { folderName: true } },
				productOrganization: {
					select: { name: true, externalId: true, stripeCustomerId: true },
				},
			},
		});
		return {
			columns: [
				column("customer", "Customer"),
				column("issue", "Issue"),
				column("product_organization", "Product organization"),
				column("stripe_customer_id", "Stripe customer ID"),
				column("suggested_product_ids", "Suggested Product IDs"),
				column("summary", "Summary"),
				column("data_through", "Data through", "type/DateTime"),
			],
			rows: findings.map((finding) => {
				const evidence = record(finding.evidence);
				return [
					finding.contractCustomer.folderName,
					finding.kind,
					finding.productOrganization?.name ??
						finding.productOrganization?.externalId ??
						null,
					finding.productOrganization?.stripeCustomerId ??
						stringValue(evidence.stripeCustomerId),
					stringList(evidence.suggestedProductOrganizationIds).join(", ") ||
						null,
					finding.summary,
					finding.dataThrough.toISOString(),
				];
			}),
		};
	}

	private async productAccountGaps(): Promise<Result> {
		const [organizations, partnerRules] = await Promise.all([
			this.db.productOrganization.findMany({
				where: { plan: { equals: "enterprise", mode: "insensitive" } },
				orderBy: [{ name: "asc" }, { externalId: "asc" }],
				select: {
					externalId: true,
					name: true,
					plan: true,
					paymentStatus: true,
					stripeCustomerId: true,
					stripeSubscriptionId: true,
					contractCustomerLinks: {
						where: { status: ContractMappingStatus.VERIFIED },
						select: {
							contractCustomer: {
								select: {
									folderName: true,
									kind: true,
									sourceDeletedAt: true,
								},
							},
						},
					},
					memberships: {
						select: { productUser: { select: { email: true } } },
					},
				},
			}),
			this.db.revenueDoorRule.findMany({
				where: {
					active: true,
					door: RevenueDoor.PARTNERS,
					matchKind: {
						in: [
							RevenueDoorMatchKind.ORGANIZATION_ID,
							RevenueDoorMatchKind.STRIPE_CUSTOMER_ID,
						],
					},
				},
				select: { matchKind: true, matchValue: true },
			}),
		]);
		const partnerOrganizationIds = new Set(
			partnerRules.flatMap((rule) =>
				rule.matchKind === RevenueDoorMatchKind.ORGANIZATION_ID
					? [rule.matchValue]
					: [],
			),
		);
		const partnerStripeCustomerIds = new Set(
			partnerRules.flatMap((rule) =>
				rule.matchKind === RevenueDoorMatchKind.STRIPE_CUSTOMER_ID
					? [rule.matchValue]
					: [],
			),
		);
		const gaps = organizations.filter((organization) => {
			if (
				partnerOrganizationIds.has(organization.externalId) ||
				(organization.stripeCustomerId != null &&
					partnerStripeCustomerIds.has(organization.stripeCustomerId))
			)
				return false;
			const activeLinks = organization.contractCustomerLinks.filter(
				(link) => link.contractCustomer.sourceDeletedAt == null,
			);
			if (
				activeLinks.some(
					(link) =>
						link.contractCustomer.kind === ContractCustomerKind.ENTERPRISE ||
						link.contractCustomer.kind === ContractCustomerKind.CHANNEL_PARTNER,
				)
			)
				return false;
			const emails = organization.memberships.flatMap((membership) =>
				membership.productUser.email
					? [membership.productUser.email.toLowerCase()]
					: [],
			);
			return !(
				emails.length > 0 && emails.every((email) => email.endsWith("@sync.so"))
			);
		});
		return {
			columns: [
				column("product_organization", "Product organization"),
				column("product_organization_id", "Product organization ID"),
				column("plan", "Product plan"),
				column("stripe_customer_id", "Stripe customer ID"),
				column("stripe_subscription_id", "Stripe subscription ID"),
				column("payment_status", "Payment status"),
				column("member_domains", "Member domains"),
				column("review_reason", "Review reason"),
			],
			rows: gaps.map((organization) => [
				organization.name ?? organization.externalId,
				organization.externalId,
				organization.plan,
				organization.stripeCustomerId,
				organization.stripeSubscriptionId,
				paymentStatus(organization.paymentStatus),
				[
					...new Set(
						organization.memberships.flatMap((membership) => {
							const email = membership.productUser.email?.toLowerCase();
							return email?.includes("@") ? [email.split("@")[1]] : [];
						}),
					),
				].join(", ") || null,
				"No verified active Enterprise or Channel Partner contract link.",
			]),
		};
	}

	private async openFindings(): Promise<Result> {
		const findings = await this.db.contractFinding.findMany({
			where: { status: { in: [...OPEN_STATUSES] } },
			orderBy: [
				{ severity: "desc" },
				{ kind: "asc" },
				{ contractCustomer: { folderName: "asc" } },
			],
			select: {
				kind: true,
				status: true,
				severity: true,
				title: true,
				summary: true,
				dataThrough: true,
				firstSeenAt: true,
				contractCustomer: { select: { folderName: true, kind: true } },
				productOrganization: { select: { name: true, externalId: true } },
			},
		});
		return {
			columns: [
				column("customer", "Customer"),
				column("customer_class", "Customer class"),
				column("severity", "Severity"),
				column("finding_type", "Finding type"),
				column("status", "Status"),
				column("product_organization", "Product organization"),
				column("title", "Title"),
				column("summary", "Summary"),
				column("first_seen_at", "First seen", "type/DateTime"),
				column("data_through", "Data through", "type/DateTime"),
			],
			rows: findings.map((finding) => [
				finding.contractCustomer.folderName,
				finding.contractCustomer.kind,
				finding.severity,
				finding.kind,
				finding.status,
				finding.productOrganization?.name ??
					finding.productOrganization?.externalId ??
					null,
				finding.title,
				finding.summary,
				finding.firstSeenAt.toISOString(),
				finding.dataThrough.toISOString(),
			]),
		};
	}

	private async ingestionHealth(): Promise<Result> {
		const [customers, documents] = await Promise.all([
			this.db.contractCustomer.findMany({
				where: { sourceDeletedAt: null },
				select: { id: true, kind: true },
			}),
			this.db.contractDocument.findMany({
				select: {
					textStatus: true,
					parseStatus: true,
					contractCustomer: { select: { kind: true, sourceDeletedAt: true } },
				},
			}),
		]);
		const kinds = [
			ContractCustomerKind.ENTERPRISE,
			ContractCustomerKind.PRODUCTION,
			ContractCustomerKind.CHANNEL_PARTNER,
		] as const;
		return {
			columns: [
				column("customer_class", "Customer class"),
				column("customers", "Customers", "type/Integer"),
				column("documents", "Documents", "type/Integer"),
				column("extracted", "Text extracted", "type/Integer"),
				column("parsed", "Parsed", "type/Integer"),
				column("needs_ocr", "Needs OCR", "type/Integer"),
				column("text_failed", "Text failed", "type/Integer"),
				column("parse_failed", "Parse failed", "type/Integer"),
				column("pending", "Pending", "type/Integer"),
			],
			rows: kinds.map((kind) => {
				const matching = documents.filter(
					(document) =>
						document.contractCustomer?.kind === kind &&
						document.contractCustomer.sourceDeletedAt == null,
				);
				return [
					kind,
					customers.filter((customer) => customer.kind === kind).length,
					matching.length,
					matching.filter((document) => document.textStatus === "EXTRACTED")
						.length,
					matching.filter((document) => document.parseStatus === "PARSED")
						.length,
					matching.filter((document) => document.textStatus === "NEEDS_OCR")
						.length,
					matching.filter((document) => document.textStatus === "FAILED")
						.length,
					matching.filter((document) => document.parseStatus === "FAILED")
						.length,
					matching.filter(
						(document) =>
							document.textStatus === "PENDING" ||
							(document.textStatus === "EXTRACTED" &&
								document.parseStatus === "PENDING"),
					).length,
				];
			}),
		};
	}

	private async customerCoverage(): Promise<Result> {
		const customers = await this.db.contractCustomer.findMany({
			where: { sourceDeletedAt: null },
			orderBy: [{ kind: "asc" }, { folderName: "asc" }],
			select: {
				folderName: true,
				kind: true,
				syncedAt: true,
				documents: {
					select: { textStatus: true, parseStatus: true },
				},
				productOrganizations: {
					where: { status: ContractMappingStatus.VERIFIED },
					select: {
						productOrganization: {
							select: { name: true, externalId: true, stripeCustomerId: true },
						},
					},
				},
				findings: {
					where: { status: { in: [...OPEN_STATUSES] } },
					select: { severity: true },
				},
			},
		});
		return {
			columns: [
				column("customer", "Customer"),
				column("customer_class", "Customer class"),
				column("documents", "Documents", "type/Integer"),
				column("parsed_documents", "Parsed documents", "type/Integer"),
				column("product_organizations", "Product organizations"),
				column("stripe_customer_ids", "Stripe customer IDs"),
				column("open_findings", "Open findings", "type/Integer"),
				column("critical_findings", "Critical findings", "type/Integer"),
				column("drive_synced_at", "Drive synced", "type/DateTime"),
			],
			rows: customers.map((customer) => [
				customer.folderName,
				customer.kind,
				customer.documents.length,
				customer.documents.filter(
					(document) => document.parseStatus === "PARSED",
				).length,
				customer.productOrganizations
					.map(
						(mapping) =>
							mapping.productOrganization.name ??
							mapping.productOrganization.externalId,
					)
					.join(", ") || null,
				customer.productOrganizations
					.flatMap((mapping) =>
						mapping.productOrganization.stripeCustomerId
							? [mapping.productOrganization.stripeCustomerId]
							: [],
					)
					.join(", ") || null,
				customer.findings.length,
				customer.findings.filter((finding) => finding.severity === "CRITICAL")
					.length,
				customer.syncedAt.toISOString(),
			]),
		};
	}
}
