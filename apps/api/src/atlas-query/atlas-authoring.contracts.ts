import { z } from "zod";

export const atlasQuestionDraft = z
	.object({
		requestKey: z
			.string()
			.trim()
			.min(8)
			.max(128)
			.regex(/^[a-z0-9][a-z0-9._:-]+$/),
		name: z.string().trim().min(3).max(240),
		businessDefinition: z.string().trim().min(20).max(4_000),
		decisionUse: z.string().trim().min(10).max(2_000),
		ownerTeam: z.string().trim().min(2).max(120),
		cadence: z.enum([
			"hourly",
			"daily",
			"weekly",
			"monthly",
			"quarterly",
			"ad-hoc",
		]),
		dimensions: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
		sourceHints: z.array(z.string().trim().min(1).max(240)).max(12).default([]),
		acceptanceChecks: z.array(z.string().trim().min(3).max(500)).min(1).max(12),
	})
	.strict();

export type AtlasQuestionDraft = z.infer<typeof atlasQuestionDraft>;
