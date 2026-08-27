import { describe, expect, test } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import {
	parseAtlasQuestionDraft,
	parseAtlasQuestionPublish,
} from "./atlas-authoring.validation";

describe("parseAtlasQuestionDraft", () => {
	test("returns a bad request for invalid input", () => {
		expect(() => parseAtlasQuestionDraft({})).toThrow(BadRequestException);
	});
});

describe("parseAtlasQuestionPublish", () => {
	test("returns a bad request for arbitrary publication input", () => {
		expect(() =>
			parseAtlasQuestionPublish({
				requestKey: "weekly-report",
				expectedDraftVersion: 1,
				recipe: { key: "arbitrary", version: 1 },
				queryText: "select * from users",
			}),
		).toThrow(BadRequestException);
	});
});
