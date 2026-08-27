import { describe, expect, it } from "bun:test";
import {
	contractRevisionKey,
	extractContractText,
	isRemovedContractText,
	normalizeContractText,
} from "../agent/lib/contracts-content";
import type { ContractDriveDocument } from "../agent/lib/contracts-drive-client";

function document(
	overrides: Partial<ContractDriveDocument> = {},
): ContractDriveDocument {
	return {
		id: "doc",
		name: "Contract",
		format: "google-doc",
		mimeType: "application/vnd.google-apps.document",
		path: ["Acme", "Contract"],
		parentId: "customer",
		customerFolder: "Acme",
		customerFolderId: "customer",
		createdTime: null,
		modifiedTime: "2026-08-25T10:00:00.000Z",
		version: "8",
		md5Checksum: null,
		sha256Checksum: null,
		size: "100",
		url: null,
		...overrides,
	};
}

describe("contract text extraction", () => {
	it("normalizes and hashes exported Google Doc text", async () => {
		const result = await extractContractText(
			document(),
			new TextEncoder().encode(
				"  Annual commitment:\r\nUSD 40,000\u0000  \n\n\n\nTerm  ",
			),
		);

		expect(result.text).toBe("Annual commitment:\nUSD 40,000\n\n\nTerm");
		expect(result.textHash).toHaveLength(64);
		expect(result.characterCount).toBe(result.text.length);
		expect(result.needsOcr).toBe(false);
	});

	it("uses the strongest available Drive revision marker", () => {
		expect(
			contractRevisionKey(
				document({
					sha256Checksum: "sha",
					md5Checksum: "md5",
					version: "9",
				}),
			),
		).toBe("sha256:sha");
		expect(contractRevisionKey(document())).toBe("version:8");
	});

	it("keeps useful paragraph boundaries", () => {
		expect(normalizeContractText("one  \r\n\r\n\r\n\r\ntwo")).toBe(
			"one\n\n\ntwo",
		);
	});

	it("recognizes Drive removal notices instead of sending them to OCR", () => {
		expect(isRemovedContractText("The document has been removed.")).toBe(true);
		expect(isRemovedContractText("The contract has been removed.")).toBe(false);
	});
});
