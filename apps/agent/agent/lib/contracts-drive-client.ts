const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const PDF_MIME = "application/pdf";
const DOCX_MIME =
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_ITEMS = 2_000;

export type ContractDocumentFormat = "google-doc" | "pdf" | "docx";

const DOCUMENT_FORMATS: ReadonlyMap<string, ContractDocumentFormat> = new Map([
	[GOOGLE_DOC_MIME, "google-doc"],
	[PDF_MIME, "pdf"],
	[DOCX_MIME, "docx"],
]);

type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

type DriveFile = {
	id: string;
	name: string;
	mimeType: string;
	createdTime?: string | null;
	modifiedTime?: string | null;
	version?: string | null;
	md5Checksum?: string | null;
	sha256Checksum?: string | null;
	size?: string | null;
	webViewLink?: string | null;
	parents?: string[] | null;
	trashed?: boolean;
};

type DriveFileList = {
	files?: DriveFile[];
	nextPageToken?: string | null;
};

export type ContractDriveDocument = {
	id: string;
	name: string;
	format: ContractDocumentFormat;
	mimeType: string;
	path: string[];
	parentId: string;
	customerFolder: string | null;
	customerFolderId: string | null;
	createdTime: string | null;
	modifiedTime: string | null;
	version: string | null;
	md5Checksum: string | null;
	sha256Checksum: string | null;
	size: string | null;
	url: string | null;
};

export type ContractDriveCustomerFolder = {
	id: string;
	name: string;
	createdTime: string | null;
	modifiedTime: string | null;
	url: string | null;
};

export type ContractDriveCrawl = {
	root: { id: string; name: string };
	documents: ContractDriveDocument[];
	customerFolders: ContractDriveCustomerFolder[];
	folders: number;
	unsupportedFiles: number;
};

export class ContractsDriveClient {
	constructor(
		private readonly accessToken: () => Promise<string>,
		private readonly fetcher: Fetcher = fetch,
	) {}

	async crawl(rootFolderId: string): Promise<ContractDriveCrawl> {
		const token = await this.accessToken();
		const root = await this.file(rootFolderId, token);
		if (root.mimeType !== FOLDER_MIME) {
			throw new Error(
				"The configured customer contracts source is not a folder.",
			);
		}

		const queue = [
			{ id: root.id, path: [] as string[], folderIds: [] as string[] },
		];
		const visited = new Set<string>();
		const documents: ContractDriveDocument[] = [];
		const customerFolders: ContractDriveCustomerFolder[] = [];
		let unsupportedFiles = 0;
		let scannedItems = 1;

		while (queue.length > 0) {
			const folder = queue.shift();
			if (!folder || visited.has(folder.id)) continue;
			visited.add(folder.id);

			for (const file of await this.children(folder.id, token)) {
				scannedItems += 1;
				if (scannedItems > MAX_ITEMS) {
					throw new Error(
						`The customer contracts folder exceeds the ${MAX_ITEMS} item safety limit.`,
					);
				}
				if (file.mimeType === FOLDER_MIME) {
					if (folder.path.length === 0) {
						customerFolders.push({
							id: file.id,
							name: file.name,
							createdTime: file.createdTime ?? null,
							modifiedTime: file.modifiedTime ?? null,
							url: file.webViewLink ?? null,
						});
					}
					queue.push({
						id: file.id,
						path: [...folder.path, file.name],
						folderIds: [...folder.folderIds, file.id],
					});
					continue;
				}
				const format = DOCUMENT_FORMATS.get(file.mimeType);
				if (!format) {
					unsupportedFiles += 1;
					continue;
				}
				documents.push({
					id: file.id,
					name: file.name,
					format,
					mimeType: file.mimeType,
					path: [...folder.path, file.name],
					parentId: folder.id,
					customerFolder: folder.path[0] ?? null,
					customerFolderId: folder.folderIds[0] ?? null,
					createdTime: file.createdTime ?? null,
					modifiedTime: file.modifiedTime ?? null,
					version: file.version ?? null,
					md5Checksum: file.md5Checksum ?? null,
					sha256Checksum: file.sha256Checksum ?? null,
					size: file.size ?? null,
					url: file.webViewLink ?? null,
				});
			}
		}

		return {
			root: { id: root.id, name: root.name },
			documents: documents.sort((left, right) =>
				left.path.join("/").localeCompare(right.path.join("/")),
			),
			customerFolders: customerFolders.sort((left, right) =>
				left.name.localeCompare(right.name),
			),
			folders: visited.size,
			unsupportedFiles,
		};
	}

	async download(document: ContractDriveDocument): Promise<Uint8Array> {
		const token = await this.accessToken();
		const path =
			document.format === "google-doc"
				? `/files/${encodeURIComponent(document.id)}/export?${new URLSearchParams({ mimeType: "text/plain" })}`
				: `/files/${encodeURIComponent(document.id)}?${new URLSearchParams({ alt: "media", supportsAllDrives: "true" })}`;
		const response = await this.response(path, token);
		return new Uint8Array(await response.arrayBuffer());
	}

	private file(id: string, token: string): Promise<DriveFile> {
		const fields = [
			"id",
			"name",
			"mimeType",
			"createdTime",
			"modifiedTime",
			"version",
			"md5Checksum",
			"sha256Checksum",
			"size",
			"webViewLink",
			"parents",
			"trashed",
		].join(",");
		const params = new URLSearchParams({ fields, supportsAllDrives: "true" });
		return this.request<DriveFile>(
			`/files/${encodeURIComponent(id)}?${params}`,
			token,
		);
	}

	private async children(
		folderId: string,
		token: string,
	): Promise<DriveFile[]> {
		const files: DriveFile[] = [];
		let pageToken: string | null = null;

		do {
			const params = new URLSearchParams({
				q: `'${folderId}' in parents and trashed = false`,
				pageSize: "1000",
				supportsAllDrives: "true",
				includeItemsFromAllDrives: "true",
				fields:
					"nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,version,md5Checksum,sha256Checksum,size,webViewLink,parents,trashed)",
			});
			if (pageToken) params.set("pageToken", pageToken);
			const body = await this.request<DriveFileList>(`/files?${params}`, token);
			files.push(...(body.files ?? []));
			pageToken = body.nextPageToken ?? null;
		} while (pageToken);

		return files;
	}

	private async request<T>(path: string, token: string): Promise<T> {
		const response = await this.response(path, token);
		return (await response.json()) as T;
	}

	private async response(path: string, token: string): Promise<Response> {
		const response = await this.fetcher(`${DRIVE_BASE}${path}`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			const body = (await response
				.clone()
				.json()
				.catch(() => null)) as { error?: { message?: string } } | null;
			const reason = body?.error?.message?.trim();
			throw new Error(
				`Google Drive request failed (${response.status})${reason ? `: ${reason}` : "."}`,
			);
		}
		return response;
	}
}
