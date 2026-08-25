import { ContractParseStatus, ContractTextStatus, db } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { suggestContractCustomerMappings } from "../lib/contracts-mapping";
import { inputJson } from "../lib/customer-source";

const PARSER_VERSION = "contract-v2";
const date = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.optional();
const money = z.number().int().nonnegative().optional();
const currency = z
	.string()
	.regex(/^[A-Z]{3}$/)
	.optional();

const extractionSchema = z.object({
	sourceRecordId: z.string(),
	textHash: z.string().length(64),
	documentType: z.enum([
		"MSA",
		"ORDER_FORM",
		"SOW",
		"AMENDMENT",
		"NDA",
		"DPA",
		"INVOICE",
		"OTHER",
	]),
	customerName: z.string().max(300).optional(),
	customerLegalName: z.string().max(300).optional(),
	syncEntityName: z.string().max(300).optional(),
	otherParties: z.array(z.string().max(300)).max(20).default([]),
	effectiveDate: date,
	serviceStartDate: date,
	serviceEndDate: date,
	autoRenews: z.boolean().optional(),
	renewalPeriodMonths: z.number().int().positive().optional(),
	terminationNoticeDays: z.number().int().nonnegative().optional(),
	currency,
	contractValueAmountMinor: money,
	annualCommitmentAmountMinor: money,
	billingCadence: z
		.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "MILESTONE", "OTHER"])
		.optional(),
	commercialTerms: z
		.array(
			z
				.object({
					label: z.string().max(200),
					amountMinor: money,
					amountMillicents: money,
					currency: z.string().regex(/^[A-Z]{3}$/),
					unit: z
						.enum([
							"FRAME",
							"MINUTE",
							"HOUR",
							"CREDIT",
							"CONCURRENCY",
							"SEAT",
							"OTHER",
						])
						.optional(),
					cadence: z
						.enum(["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL", "OTHER"])
						.optional(),
					isMinimumCommitment: z.boolean(),
					evidenceQuote: z.string().min(1).max(500),
				})
				.refine(
					(term) =>
						term.amountMinor !== undefined
							? true
							: term.amountMillicents !== undefined,
					{ message: "A commercial term needs an amount." },
				),
		)
		.max(30)
		.default([]),
	committedProducts: z.array(z.string().max(200)).max(30).default([]),
	summary: z.string().min(1).max(1_000),
	evidence: z
		.array(
			z.object({
				field: z.string().max(100),
				quote: z.string().min(1).max(500),
			}),
		)
		.min(1)
		.max(50),
	unresolvedFields: z.array(z.string().max(200)).max(30).default([]),
});

export default defineTool({
	description:
		"Store structured terms extracted from one customer contract. General amounts use integer minor currency units, so USD 40,000 is 4000000. Unit prices that need finer precision use amountMillicents, where USD 0.35 is 35000 and USD 0.005 is 500. Omit a field when the contract does not state it. Every stored claim needs a short quote from the contract.",
	inputSchema: extractionSchema,
	async execute(input) {
		const { sourceRecordId, textHash, ...extraction } = input;
		const document = await db.contractDocument.findUnique({
			where: { sourceRecordId },
			select: {
				contractCustomerId: true,
				contractCustomer: {
					select: { folderName: true, legalName: true },
				},
			},
		});
		if (!document) {
			return { stored: false as const, reason: "No such contract document." };
		}

		const updated = await db.contractDocument.updateMany({
			where: {
				sourceRecordId,
				textHash,
				textStatus: ContractTextStatus.EXTRACTED,
			},
			data: {
				parseStatus: ContractParseStatus.PARSED,
				parserVersion: PARSER_VERSION,
				parsed: inputJson(extraction),
				parseError: null,
				parsedAt: new Date(),
			},
		});
		if (updated.count === 0) {
			return {
				stored: false as const,
				reason:
					"The stored contract text changed during parsing. Read it again.",
			};
		}

		let mappings: Awaited<ReturnType<typeof suggestContractCustomerMappings>> =
			[];
		if (document.contractCustomerId) {
			const legalName = input.customerLegalName?.trim() || null;
			if (legalName) {
				await db.contractCustomer.updateMany({
					where: {
						id: document.contractCustomerId,
						OR: [{ legalName: null }, { legalName }],
					},
					data: { legalName },
				});
			}
			mappings = await suggestContractCustomerMappings(db, {
				contractCustomerId: document.contractCustomerId,
				folderName: document.contractCustomer?.folderName ?? "",
				legalName: legalName ?? document.contractCustomer?.legalName,
			});
		}

		return {
			stored: true as const,
			parserVersion: PARSER_VERSION,
			mappingSuggestions: mappings.map((mapping) => ({
				productOrganizationId: mapping.externalId,
				name: mapping.name,
				stripeCustomerId: mapping.stripeCustomerId,
				confidence: mapping.confidence,
			})),
		};
	},
});
