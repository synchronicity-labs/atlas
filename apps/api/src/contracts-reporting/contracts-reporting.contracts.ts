import { z } from "zod";

export const contractsReportingQuery = z.object({
	source: z.literal("atlas_contracts"),
	report: z.enum([
		"action-summary",
		"price-mismatches",
		"contract-account-gaps",
		"product-account-gaps",
		"open-findings",
		"ingestion-health",
		"customer-coverage",
		"enterprise-contract-value",
		"enterprise-contract-commitments",
	]),
	definitionVersion: z.literal("contract-reconciliation-v1"),
});

export type ContractsReportingQuery = z.infer<typeof contractsReportingQuery>;
