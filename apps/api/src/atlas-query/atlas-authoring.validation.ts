import { BadRequestException } from "@nestjs/common";
import {
	type AtlasQuestionDraft,
	atlasQuestionDraft,
} from "./atlas-authoring.contracts";

export function parseAtlasQuestionDraft(body: unknown): AtlasQuestionDraft {
	const parsed = atlasQuestionDraft.safeParse(body);
	if (!parsed.success) {
		throw new BadRequestException({
			message: "Invalid Atlas question draft.",
			issues: parsed.error.issues.map((issue) => ({
				path: issue.path.join("."),
				message: issue.message,
			})),
		});
	}
	return parsed.data;
}
