import { z } from "zod";
import { listInput } from "../trpc/list-input";

export const questionListInput = listInput;

export const questionNumberInput = z.object({
	number: z.number().int().positive(),
});

export const questionProposalInput = z.object({
	id: z.string().min(1),
});

export const questionReportingPeriod = z.object({
	range: z.enum(["mtd", "previous-month", "3m", "6m", "12m", "all"]),
	from: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.nullable(),
	to: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.nullable(),
});

export const questionPreviewInput = questionNumberInput.extend({
	queryLanguage: z.enum(["SQL", "MBQL", "API"]),
	queryText: z.string().min(1).max(250_000),
	reportingPeriod: questionReportingPeriod.optional(),
});

export const questionSaveVersionInput = questionPreviewInput.extend({
	name: z.string().trim().min(1).max(240),
	description: z.string().trim().max(4_000).nullable(),
	display: z.string().trim().min(1).max(80),
	visualization: z.record(z.string(), z.unknown()).default({}),
	proposalId: z.string().optional(),
});

export type QuestionListInput = z.infer<typeof questionListInput>;
export type QuestionPreviewInput = z.infer<typeof questionPreviewInput>;
export type QuestionSaveVersionInput = z.infer<typeof questionSaveVersionInput>;
