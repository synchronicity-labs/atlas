import { db, type Prisma } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { currentFocus } from "../lib/focus";

export default defineTool({
	description:
		"Propose an edit to an Atlas question. This never changes the live question. It creates a reviewable draft that a person must preview and save as a new immutable version.",
	inputSchema: z.object({
		number: z.number().int().positive(),
		summary: z.string().min(1).max(500),
		name: z.string().min(1).max(240).optional(),
		description: z.string().max(4000).nullable().optional(),
		queryLanguage: z.enum(["SQL", "MBQL", "API"]).optional(),
		queryText: z.string().min(1).max(250_000).optional(),
		display: z.string().min(1).max(80).optional(),
		visualization: z.record(z.string(), z.unknown()).optional(),
	}),
	async execute(input) {
		const question = await db.question.findUnique({
			where: { number: input.number },
			select: {
				id: true,
				name: true,
				description: true,
				versions: {
					orderBy: { version: "desc" },
					take: 1,
					select: {
						queryLanguage: true,
						queryText: true,
						display: true,
						visualization: true,
					},
				},
			},
		});
		const latest = question?.versions[0];
		if (!question || !latest) {
			return {
				written: false as const,
				reason: "That Atlas question has no saved version.",
			};
		}
		const proposal = await db.questionChangeProposal.create({
			data: {
				questionId: question.id,
				sessionId: currentFocus().sessionId ?? "unknown",
				summary: input.summary,
				name: input.name ?? question.name,
				description:
					input.description === undefined
						? question.description
						: input.description,
				queryLanguage: input.queryLanguage ?? latest.queryLanguage,
				queryText: input.queryText ?? latest.queryText,
				display: input.display ?? latest.display,
				visualization: JSON.parse(
					JSON.stringify(input.visualization ?? latest.visualization ?? {}),
				) as Prisma.InputJsonValue,
			},
			select: { id: true },
		});
		return {
			written: true as const,
			proposalId: proposal.id,
			questionNumber: input.number,
			summary: input.summary,
			reviewUrl: `/questions/${input.number}?proposal=${proposal.id}`,
		};
	},
});
