import { db } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { jsonDate } from "../lib/json";

export default defineTool({
	description:
		"Read one chunk of text from an ingested customer contract. Use nextOffset until hasMore is false before recording an extraction. This is internal data and must not be copied into an outside query.",
	inputSchema: z.object({
		sourceRecordId: z.string(),
		offset: z.number().int().min(0).default(0),
		limit: z.number().int().min(4_000).max(40_000).default(30_000),
	}),
	async execute({ sourceRecordId, offset, limit }) {
		const document = await db.contractDocument.findUnique({
			where: { sourceRecordId },
			select: {
				textStatus: true,
				text: true,
				textHash: true,
				characterCount: true,
				pageCount: true,
				truncated: true,
				contractCustomer: {
					select: { folderName: true, kind: true, legalName: true },
				},
				sourceRecord: {
					select: { externalId: true, payload: true, sourceUpdatedAt: true },
				},
			},
		});
		if (!document?.text || !document.textHash) {
			return {
				found: false as const,
				reason: document
					? `Contract text is ${document.textStatus}.`
					: "No such contract source record.",
			};
		}

		const payload = document.sourceRecord.payload as {
			name?: unknown;
			url?: unknown;
		};
		const end = Math.min(document.text.length, offset + limit);

		return {
			found: true as const,
			sourceRecordId,
			textHash: document.textHash,
			fileId: document.sourceRecord.externalId,
			name: typeof payload.name === "string" ? payload.name : null,
			url: typeof payload.url === "string" ? payload.url : null,
			customerFolder: document.contractCustomer?.folderName ?? null,
			customerKind: document.contractCustomer?.kind ?? null,
			customerLegalName: document.contractCustomer?.legalName ?? null,
			sourceUpdatedAt: jsonDate(document.sourceRecord.sourceUpdatedAt),
			pageCount: document.pageCount,
			characterCount: document.characterCount,
			storedTextTruncated: document.truncated,
			offset,
			nextOffset: end,
			hasMore: end < document.text.length,
			text: document.text.slice(offset, end),
		};
	},
});
