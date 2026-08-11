import { z } from "zod";

export const rudyContext = z
	.object({
		kind: z.enum(["workspace", "dashboard", "question"]),
		id: z.string().min(1).max(64),
	})
	.superRefine((value, context) => {
		if (value.kind === "workspace" && value.id !== "atlas") {
			context.addIssue({
				code: "custom",
				message: "The Atlas workspace id is atlas.",
			});
		}
		if (
			(value.kind === "dashboard" || value.kind === "question") &&
			!/^[1-9]\d*$/.test(value.id)
		) {
			context.addIssue({
				code: "custom",
				message: "Dashboard and question ids are positive Atlas numbers.",
			});
		}
	});

export const rudyListInput = rudyContext;

export const rudyMessagesInput = z.object({
	id: z.string().min(1),
});

export const rudySendInput = z.object({
	context: rudyContext,
	threadId: z.string().min(1).optional(),
	message: z.string().trim().min(1).max(20_000),
});

export const rudyRemoveInput = z.object({
	id: z.string().min(1),
});

export type RudyContext = z.infer<typeof rudyContext>;
export type RudySendInput = z.infer<typeof rudySendInput>;
