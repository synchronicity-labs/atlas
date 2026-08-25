import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import type { ContractDriveDocument } from "./contracts-drive-client";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 250_000;
const OCR_TEXT_THRESHOLD = 200;

export type ContractTextExtraction = {
	text: string;
	textHash: string;
	byteCount: number;
	characterCount: number;
	pageCount: number | null;
	truncated: boolean;
	needsOcr: boolean;
	warnings: string[];
};

export function contractRevisionKey(document: ContractDriveDocument): string {
	if (document.sha256Checksum) return `sha256:${document.sha256Checksum}`;
	if (document.md5Checksum) return `md5:${document.md5Checksum}`;
	if (document.version) return `version:${document.version}`;
	return `modified:${document.modifiedTime ?? "unknown"}:size:${document.size ?? "unknown"}`;
}

export async function extractContractText(
	document: ContractDriveDocument,
	bytes: Uint8Array,
): Promise<ContractTextExtraction> {
	if (bytes.byteLength > MAX_FILE_BYTES) {
		throw new Error(
			`Contract document exceeds the ${MAX_FILE_BYTES} byte extraction limit.`,
		);
	}

	let rawText: string;
	let pageCount: number | null = null;
	let warnings: string[] = [];

	if (document.format === "google-doc") {
		rawText = new TextDecoder().decode(bytes);
	} else if (document.format === "docx") {
		const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
		rawText = result.value;
		warnings = result.messages.map((message) => message.message).slice(0, 20);
	} else {
		const result = await extractText(new Uint8Array(bytes), {
			mergePages: true,
		});
		rawText = result.text;
		pageCount = result.totalPages;
	}

	const normalized = normalizeContractText(rawText);
	if (!normalized && document.format !== "pdf") {
		throw new Error("Contract document contains no readable text.");
	}
	const truncated = normalized.length > MAX_TEXT_CHARACTERS;
	const text = truncated
		? normalized.slice(0, MAX_TEXT_CHARACTERS)
		: normalized;

	return {
		text,
		textHash: createHash("sha256").update(text).digest("hex"),
		byteCount: bytes.byteLength,
		characterCount: normalized.length,
		pageCount,
		truncated,
		needsOcr:
			document.format === "pdf" && normalized.length < OCR_TEXT_THRESHOLD,
		warnings,
	};
}

export function normalizeContractText(value: string): string {
	return value
		.normalize("NFKC")
		.replaceAll("\u0000", "")
		.replace(/\r\n?/g, "\n")
		.replace(/[\t ]+\n/g, "\n")
		.replace(/\n{4,}/g, "\n\n\n")
		.trim();
}
