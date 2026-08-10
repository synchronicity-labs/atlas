import { defineTool } from "eve/tools";
import { z } from "zod";
import {
	readAtlasDashboard,
	readAtlasQuestion,
	readAtlasWorkspace,
} from "../lib/atlas";

export default defineTool({
	description:
		"Read Atlas, the deterministic company data layer. Use it before fetching source systems. Read a dashboard to inspect every question and current result, or a question to inspect its actual query, versions, reporting periods, and snapshots.",
	inputSchema: z.object({
		kind: z.enum(["workspace", "dashboard", "question"]),
		number: z.number().int().positive().optional(),
	}),
	async execute(input) {
		if (input.kind === "workspace") return readAtlasWorkspace();
		if (!input.number) {
			return {
				found: false as const,
				reason: "A dashboard or question number is required.",
			};
		}
		const result =
			input.kind === "dashboard"
				? await readAtlasDashboard(input.number)
				: await readAtlasQuestion(input.number);
		return (
			result ?? {
				found: false as const,
				reason: `Atlas ${input.kind} ${input.number} does not exist.`,
			}
		);
	},
});
