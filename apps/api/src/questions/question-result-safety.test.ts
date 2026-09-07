import { describe, expect, it } from "bun:test";
import { sanitizeQuestionResult } from "./question-result-safety";

describe("question result safety", () => {
	it("removes direct secret and media URL columns from every question", () => {
		const result = sanitizeQuestionResult(
			67,
			[
				{ name: "created_at" },
				{ name: "output_media_url" },
				{ name: "access_token" },
				{ name: "status" },
			],
			[["2026-09-03", "https://signed.example/video", "secret", "FAILED"]],
		);
		expect(result).toEqual({
			columns: [{ name: "created_at" }, { name: "status" }],
			rows: [["2026-09-03", "FAILED"]],
		});
	});

	it("allowlists only deidentified fields for negative feedback", () => {
		const result = sanitizeQuestionResult(
			141,
			[
				{ name: "created_at" },
				{ name: "generation_id" },
				{ name: "user_id" },
				{ name: "organization_id" },
				{ name: "model_name" },
				{ name: "text_feedback" },
				{ name: "output_media_url" },
			],
			[["2026-09-03", "g1", "u1", "o1", "sync-3", "bad result", "signed"]],
		);
		expect(result).toEqual({
			columns: [
				{ name: "created_at" },
				{ name: "model_name" },
				{ name: "text_feedback" },
			],
			rows: [["2026-09-03", "sync-3", "bad result"]],
		});
	});

	it("fails closed for malformed negative-feedback snapshots", () => {
		expect(
			sanitizeQuestionResult(141, { unexpected: "columns" }, [
				["customer identifier"],
			]),
		).toEqual({ columns: [], rows: [] });
	});

	it("rejects misaligned rows and nested payloads in allowed feedback columns", () => {
		const columns = [{ name: "created_at" }, { name: "text_feedback" }];
		for (const rows of [
			[["2026-09-03", "g1", "private feedback"]],
			[["2026-09-03", { user_id: "u1", access_token: "secret" }]],
		]) {
			expect(sanitizeQuestionResult(141, columns, rows)).toEqual({
				columns: [],
				rows: [],
			});
		}
	});
});
