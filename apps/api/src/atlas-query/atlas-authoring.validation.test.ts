import { describe, expect, test } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { parseAtlasQuestionDraft } from "./atlas-authoring.validation";

describe("parseAtlasQuestionDraft", () => {
	test("returns a bad request for invalid input", () => {
		expect(() => parseAtlasQuestionDraft({})).toThrow(BadRequestException);
	});
});
