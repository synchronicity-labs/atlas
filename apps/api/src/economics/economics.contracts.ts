import { z } from "zod";

export const economicsQuery = z.object({
	source: z.literal("atlas_economics"),
	report: z.enum([
		"modal-spend",
		"prod-inference-cost",
		"usage-revenue",
		"margin-pct",
		"margin-history",
		"model-costs",
		"frames-by-tier",
	]),
	months: z.number().int().min(2).max(12).default(7),
	definitionVersion: z.literal("inference-economics-v1"),
	warehouseSql: z.string().trim().min(1).max(100_000).optional(),
});

export const modalImport = z.object({
	capturedAt: z.string().datetime(),
	collector: z.literal("rudy-modal-billing-v1"),
	rows: z
		.array(
			z.object({
				month: z.string().regex(/^\d{4}-\d{2}$/),
				model: z.string().trim().min(1).max(120),
				costUsd: z.number().finite().min(0),
			}),
		)
		.min(1)
		.max(1_000),
});

export type EconomicsQuery = z.infer<typeof economicsQuery>;
export type ModalImport = z.infer<typeof modalImport>;
