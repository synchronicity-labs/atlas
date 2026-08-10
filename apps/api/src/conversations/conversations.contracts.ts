import { z } from "zod";

export const atlasContextKind = z.enum(["workspace", "dashboard", "question"]);

const conversationContext = z
	.object({
		contactId: z.string().optional(),
		companyId: z.string().optional(),
		dealId: z.string().optional(),
		atlasContextKind: atlasContextKind.optional(),
		atlasContextId: z.string().optional(),
	})
	.superRefine((input, context) => {
		const records = [input.contactId, input.companyId, input.dealId].filter(
			Boolean,
		);
		const hasAtlasKind = Boolean(input.atlasContextKind);
		const hasAtlasId = Boolean(input.atlasContextId);
		if (records.length + Number(hasAtlasKind && hasAtlasId) !== 1) {
			context.addIssue({
				code: "custom",
				message: "Choose exactly one conversation context.",
			});
		}
		if (hasAtlasKind !== hasAtlasId) {
			context.addIssue({
				code: "custom",
				message: "Atlas context kind and id must be provided together.",
			});
		}
	});

export const conversationListInput = conversationContext;

export type ConversationListInput = z.infer<typeof conversationListInput>;

export const conversationSaveInput = conversationContext.and(
	z.object({
		sessionId: z.string(),
		continuationToken: z.string().nullish(),
		streamIndex: z.number().int().min(0).optional(),
		title: z.string().optional(),
		messageCount: z.number().int().min(0).optional(),
	}),
);

export type ConversationSaveInput = z.infer<typeof conversationSaveInput>;

export const conversationIdInput = z.object({ id: z.string() });

export const conversationEventsInput = z.object({
	id: z.string(),
	limit: z.number().int().min(1).max(5000).default(2000),
});

export type ConversationEventsInput = z.infer<typeof conversationEventsInput>;
