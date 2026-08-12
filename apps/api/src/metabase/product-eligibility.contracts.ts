import { z } from "zod";

export const productEligibilityQuery = z.object({
	source: z.literal("atlas-product-eligibility"),
	report: z.literal("qualified-then-deleted"),
	months: z.number().int().min(1).max(12).default(6),
	timeZone: z.literal("UTC").default("UTC"),
});

export type ProductEligibilityQuery = z.infer<typeof productEligibilityQuery>;
