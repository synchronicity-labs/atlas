import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@crm/db";
import { readAtlasQuestion, serializeAtlasSnapshot } from "../agent/lib/atlas";

describe("Atlas agent snapshots", () => {
	test("resolves the public question number returned by dashboard reads", async () => {
		const lookup = mock(async (_input: unknown) => null);
		await readAtlasQuestion(141, {
			question: { findUnique: lookup },
		} as unknown as Db);
		expect(lookup).toHaveBeenCalledWith(
			expect.objectContaining({ where: { publicNumber: 141 } }),
		);
	});

	test("sanitizes question 141 before limiting read_atlas rows", () => {
		const snapshot = serializeAtlasSnapshot(141, {
			rowCount: 1,
			columns: [
				{ name: "created_at" },
				{ name: "user_id" },
				{ name: "model_name" },
				{ name: "text_feedback" },
				{ name: "output_media_url" },
			],
			rows: [
				[
					"2026-09-03T11:00:00.000Z",
					"user-customer",
					"sync-3",
					"bad result",
					"https://signed.example/customer.mp4",
				],
			],
		});

		expect(snapshot).toEqual({
			rowCount: 1,
			columns: [
				{ name: "created_at" },
				{ name: "model_name" },
				{ name: "text_feedback" },
			],
			rows: [["2026-09-03T11:00:00.000Z", "sync-3", "bad result"]],
		});
	});
});
