import { describe, expect, test } from "bun:test";
import { questionNumberWhere } from "./question-number";

describe("questionNumberWhere", () => {
	test("only resolves the current public question number", () => {
		expect(questionNumberWhere(42)).toEqual({ publicNumber: 42 });
	});
});
