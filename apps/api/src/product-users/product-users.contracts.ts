import { z } from "zod";
import { listInput } from "../trpc/list-input";

export const productUserListInput = listInput;

export const productUserIdInput = z.object({ id: z.string() });

export const productUserDomainInput = listInput.extend({
	domain: z.string().trim().min(3).max(253),
});

export type ProductUserListInput = z.infer<typeof productUserListInput>;
export type ProductUserDomainInput = z.infer<typeof productUserDomainInput>;
