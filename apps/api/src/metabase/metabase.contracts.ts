import { z } from "zod";

export const metabaseUserSyncInput = z
	.object({ maxBatches: z.number().int().min(1).max(20).default(4) })
	.default({ maxBatches: 4 });

export const metabaseDashboardSyncInput = z
	.object({
		mode: z.enum(["incremental", "backfill"]).default("incremental"),
		period: z
			.string()
			.regex(/^\d{4}-\d{2}$/)
			.optional(),
		maxBatches: z.number().int().min(1).max(20).default(4),
	})
	.default({ mode: "incremental", maxBatches: 4 });
