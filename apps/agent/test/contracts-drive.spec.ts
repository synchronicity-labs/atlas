import { describe, expect, it } from "bun:test";
import { ContractsDriveClient } from "../agent/lib/contracts-drive-client";

const folderMime = "application/vnd.google-apps.folder";

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("contract Drive crawl", () => {
	it("recursively lists supported documents and preserves their paths", async () => {
		const requests: URL[] = [];
		const client = new ContractsDriveClient(
			async () => "token",
			async (input, init) => {
				const url = new URL(String(input));
				requests.push(url);
				expect(new Headers(init?.headers).get("authorization")).toBe(
					"Bearer token",
				);

				if (url.pathname.endsWith("/files/root")) {
					return json({ id: "root", name: "Customers", mimeType: folderMime });
				}

				const query = url.searchParams.get("q");
				const page = url.searchParams.get("pageToken");
				if (query === "'root' in parents and trashed = false" && !page) {
					return json({
						nextPageToken: "next",
						files: [
							{ id: "customer", name: "Acme", mimeType: folderMime },
							{
								id: "sheet",
								name: "Tracker",
								mimeType: "application/vnd.google-apps.spreadsheet",
							},
						],
					});
				}
				if (query === "'root' in parents and trashed = false" && page) {
					return json({
						files: [
							{
								id: "root-pdf",
								name: "Root.pdf",
								mimeType: "application/pdf",
								modifiedTime: "2026-08-25T10:00:00.000Z",
								md5Checksum: "root-hash",
								webViewLink: "https://drive.google.com/root-pdf",
							},
						],
					});
				}
				if (query === "'customer' in parents and trashed = false") {
					return json({
						files: [
							{
								id: "msa",
								name: "MSA",
								mimeType: "application/vnd.google-apps.document",
								version: "7",
							},
							{
								id: "order",
								name: "Order Form.docx",
								mimeType:
									"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
							},
							{ id: "drafts", name: "Drafts", mimeType: folderMime },
						],
					});
				}
				if (query === "'drafts' in parents and trashed = false") {
					return json({
						files: [
							{
								id: "draft",
								name: "Draft.pdf",
								mimeType: "application/pdf",
							},
						],
					});
				}
				throw new Error(`Unexpected request ${url}`);
			},
		);

		const result = await client.crawl("root");

		expect(result.root).toEqual({ id: "root", name: "Customers" });
		expect(result.folders).toBe(3);
		expect(result.customerFolders.map((folder) => folder.name)).toEqual([
			"Acme",
		]);
		expect(result.unsupportedFiles).toBe(1);
		expect(result.documents.map((document) => document.path)).toEqual([
			["Acme", "Drafts", "Draft.pdf"],
			["Acme", "MSA"],
			["Acme", "Order Form.docx"],
			["Root.pdf"],
		]);
		expect(result.documents[1]?.customerFolder).toBe("Acme");
		expect(result.documents[1]?.customerFolderId).toBe("customer");
		expect(result.documents[1]?.version).toBe("7");
		expect(result.documents[3]?.md5Checksum).toBe("root-hash");
		expect(requests).toHaveLength(5);
	});

	it("exports Google Docs and downloads stored files", async () => {
		const requests: URL[] = [];
		const client = new ContractsDriveClient(
			async () => "token",
			async (input) => {
				const url = new URL(String(input));
				requests.push(url);
				return new Response(url.pathname.endsWith("/export") ? "doc" : "pdf");
			},
		);
		const base = {
			id: "file",
			name: "Contract",
			mimeType: "application/pdf",
			path: ["Acme", "Contract"],
			parentId: "customer",
			customerFolder: "Acme",
			customerFolderId: "customer",
			createdTime: null,
			modifiedTime: null,
			version: null,
			md5Checksum: null,
			sha256Checksum: null,
			size: null,
			url: null,
		} as const;

		expect(
			new TextDecoder().decode(
				await client.download({ ...base, format: "google-doc" }),
			),
		).toBe("doc");
		expect(
			new TextDecoder().decode(
				await client.download({ ...base, format: "pdf" }),
			),
		).toBe("pdf");
		expect(requests[0]?.pathname).toEndWith("/files/file/export");
		expect(requests[0]?.searchParams.get("mimeType")).toBe("text/plain");
		expect(requests[1]?.searchParams.get("alt")).toBe("media");
		expect(requests[1]?.searchParams.get("supportsAllDrives")).toBe("true");
	});

	it("surfaces folder permission failures", async () => {
		const client = new ContractsDriveClient(
			async () => "token",
			async () => json({ error: { message: "File not found" } }, 404),
		);

		await expect(client.crawl("missing")).rejects.toThrow(
			"Google Drive request failed (404): File not found",
		);
	});
});
