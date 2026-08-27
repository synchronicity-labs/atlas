import { BadRequestException } from "@nestjs/common";
import {
	type AtlasQuestionDraft,
	type AtlasQuestionPublish,
	atlasQuestionDraft,
	atlasQuestionPublish,
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

export function parseAtlasQuestionPublish(body: unknown): AtlasQuestionPublish {
	const parsed = atlasQuestionPublish.safeParse(body);
	if (!parsed.success) {
		throw new BadRequestException({
			message: "Invalid Atlas question publication.",
			issues: parsed.error.issues.map((issue) => ({
				path: issue.path.join("."),
				message: issue.message,
			})),
		});
	}
	return parsed.data;
}
