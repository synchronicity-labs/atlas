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
		expect(result.customerFolders[0]?.kind).toBe("ENTERPRISE");
		expect(result.unsupportedFiles).toBe(1);
		expect(result.documents.map((document) => document.path)).toEqual([
			["Acme", "Drafts", "Draft.pdf"],
			["Acme", "MSA"],
			["Acme", "Order Form.docx"],
			["Root.pdf"],
		]);
		expect(result.documents[1]?.customerFolder).toBe("Acme");
		expect(result.documents[1]?.customerFolderId).toBe("customer");
		expect(result.documents[1]?.customerKind).toBe("ENTERPRISE");
		expect(result.documents[1]?.version).toBe("7");
		expect(result.documents[3]?.md5Checksum).toBe("root-hash");
		expect(requests).toHaveLength(5);
	});

	it("classifies category folders and ignores unrelated top-level folders", async () => {
		const requestedFolders: string[] = [];
		const client = new ContractsDriveClient(
			async () => "token",
			async (input) => {
				const url = new URL(String(input));
				if (url.pathname.endsWith("/files/root")) {
					return json({ id: "root", name: "Contracts", mimeType: folderMime });
				}
				const query = url.searchParams.get("q") ?? "";
				const folderId = query.match(/^'([^']+)'/)?.[1] ?? "";
				requestedFolders.push(folderId);
				const filesByFolder: Record<string, unknown[]> = {
					root: [
						{
							id: "enterprise",
							name: "Enterprise_customers",
							mimeType: folderMime,
						},
						{
							id: "production",
							name: "Productions_customers",
							mimeType: folderMime,
						},
						{
							id: "partners",
							name: "Channel Partners",
							mimeType: folderMime,
						},
						{ id: "prospects", name: "Prospects", mimeType: folderMime },
					],
					enterprise: [
						{ id: "acme", name: "Acme", mimeType: folderMime },
						{
							id: "enterprise-readme",
							name: "README",
							mimeType: "application/vnd.google-apps.document",
						},
					],
					production: [
						{ id: "lemon", name: "Lemon Films", mimeType: folderMime },
					],
					partners: [{ id: "runware", name: "Runware", mimeType: folderMime }],
					acme: [
						{ id: "acme-doc", name: "Order.pdf", mimeType: "application/pdf" },
					],
					lemon: [
						{ id: "lemon-doc", name: "SOW.pdf", mimeType: "application/pdf" },
					],
					runware: [
						{
							id: "runware-doc",
							name: "Agreement.pdf",
							mimeType: "application/pdf",
						},
					],
				};
				if (!(folderId in filesByFolder)) {
					throw new Error(`Unexpected request ${url}`);
				}
				return json({ files: filesByFolder[folderId] });
			},
		);

		const result = await client.crawl("root");

		expect(
			result.customerFolders.map(({ name, kind }) => ({ name, kind })),
		).toEqual([
			{ name: "Acme", kind: "ENTERPRISE" },
			{ name: "Lemon Films", kind: "PRODUCTION" },
			{ name: "Runware", kind: "CHANNEL_PARTNER" },
		]);
		expect(
			result.documents.map(({ path, customerKind }) => ({
				path,
				customerKind,
			})),
		).toEqual([
			{ path: ["Acme", "Order.pdf"], customerKind: "ENTERPRISE" },
			{ path: ["Lemon Films", "SOW.pdf"], customerKind: "PRODUCTION" },
			{ path: ["Runware", "Agreement.pdf"], customerKind: "CHANNEL_PARTNER" },
		]);
		expect(requestedFolders).not.toContain("prospects");
		expect(result.folders).toBe(7);
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
			customerKind: "ENTERPRISE",
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
