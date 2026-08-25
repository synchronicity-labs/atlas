import {
	ContractParseStatus,
	ContractTextStatus,
	DataSourceKind,
	db,
	ExternalRecordKind,
	Prisma,
	SourceStatus,
} from "@crm/db";
import {
	GoogleServiceAccountClient,
	googleServiceAccount,
} from "@crm/db/google-service-account";
import { contractRevisionKey, extractContractText } from "./contracts-content";
import { ContractsDriveClient } from "./contracts-drive-client";
import { suggestContractCustomerMappings } from "./contracts-mapping";
import {
	beginRun,
	completeRun,
	ensureSource,
	failRun,
	inputJson,
	persistSourceRecord,
} from "./customer-source";
import { runLimited } from "./pool";
import { scheduleTask } from "./tasks";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const SOURCE_KEY = "google-drive:customer-contracts";
const FRESHNESS_MS = 12 * 60 * 60 * 1000;
const EXTRACTION_CONCURRENCY = 3;
const MAPPING_CONCURRENCY = 4;

function config() {
	const rootFolderId = process.env.CONTRACTS_DRIVE_FOLDER_ID?.trim();
	const credential = googleServiceAccount();
	return rootFolderId && credential ? { rootFolderId, credential } : null;
}

export async function syncContractsDrive() {
	const value = config();
	const source = await ensureSource({
		key: SOURCE_KEY,
		kind: DataSourceKind.GOOGLE_DRIVE,
		label: "Customer contract Drive",
		configured: value !== null,
	});
	if (!value) {
		return {
			configured: false,
			processed: 0,
			snapshots: 0,
			missing: 0,
		};
	}

	const run = await beginRun({ sourceId: source.id, scope: SOURCE_KEY });
	try {
		const google = new GoogleServiceAccountClient(value.credential);
		const client = new ContractsDriveClient(() =>
			google.accessToken([DRIVE_SCOPE]),
		);
		const crawl = await client.crawl(value.rootFolderId);
		const now = new Date();
		const customers = new Map<
			string,
			{ id: string; legalName: string | null }
		>();

		for (const folder of crawl.customerFolders) {
			const customer = await db.contractCustomer.upsert({
				where: {
					sourceId_externalId: {
						sourceId: source.id,
						externalId: folder.id,
					},
				},
				create: {
					sourceId: source.id,
					externalId: folder.id,
					folderName: folder.name,
					syncedAt: now,
				},
				update: {
					folderName: folder.name,
					sourceDeletedAt: null,
					syncedAt: now,
				},
				select: { id: true, legalName: true },
			});
			customers.set(folder.id, customer);
		}

		const missingCustomers = await db.contractCustomer.updateMany({
			where: {
				sourceId: source.id,
				sourceDeletedAt: null,
				externalId: {
					notIn: crawl.customerFolders.map((folder) => folder.id),
				},
			},
			data: { sourceDeletedAt: now },
		});

		const existingDocuments = await db.contractDocument.findMany({
			where: { sourceRecord: { sourceId: source.id } },
			select: {
				sourceRecordId: true,
				revisionKey: true,
				textStatus: true,
				parseStatus: true,
				sourceRecord: { select: { externalId: true } },
			},
		});
		const existingByExternalId = new Map(
			existingDocuments.map((document) => [
				document.sourceRecord.externalId,
				document,
			]),
		);
		const pendingExtraction: Array<{
			document: (typeof crawl.documents)[number];
			sourceRecordId: string;
			contractCustomerId: string | null;
			revisionKey: string;
		}> = [];
		let snapshots = 0;
		let scheduledParses = 0;
		let needsOcr = 0;

		for (const document of crawl.documents) {
			const persisted = await persistSourceRecord({
				sourceId: source.id,
				kind: ExternalRecordKind.DOCUMENT,
				externalId: document.id,
				payload: {
					source: "google-drive",
					rootFolderId: crawl.root.id,
					rootFolderName: crawl.root.name,
					...document,
				},
				sourceCreatedAt: document.createdTime
					? new Date(document.createdTime)
					: null,
				sourceUpdatedAt: document.modifiedTime
					? new Date(document.modifiedTime)
					: null,
			});
			snapshots += persisted.snapshotCreated;

			const revisionKey = contractRevisionKey(document);
			const existing = existingByExternalId.get(document.id);
			const contractCustomerId = document.customerFolderId
				? (customers.get(document.customerFolderId)?.id ?? null)
				: null;

			if (
				existing?.revisionKey === revisionKey &&
				existing.textStatus !== ContractTextStatus.FAILED &&
				existing.textStatus !== ContractTextStatus.PENDING
			) {
				await db.contractDocument.update({
					where: { sourceRecordId: existing.sourceRecordId },
					data: { contractCustomerId },
				});
				if (existing.textStatus === ContractTextStatus.NEEDS_OCR) {
					needsOcr += 1;
				} else if (existing.parseStatus !== ContractParseStatus.PARSED) {
					await scheduleContractParse(existing.sourceRecordId, document.name);
					scheduledParses += 1;
				}
				continue;
			}

			pendingExtraction.push({
				document,
				sourceRecordId: persisted.record.id,
				contractCustomerId,
				revisionKey,
			});
		}

		const extractionErrors: string[] = [];
		await runLimited(
			EXTRACTION_CONCURRENCY,
			pendingExtraction,
			async ({ document, sourceRecordId, contractCustomerId, revisionKey }) => {
				try {
					const bytes = await client.download(document);
					const extraction = await extractContractText(document, bytes);
					const textStatus = extraction.needsOcr
						? ContractTextStatus.NEEDS_OCR
						: ContractTextStatus.EXTRACTED;
					await db.contractDocument.upsert({
						where: { sourceRecordId },
						create: {
							sourceRecordId,
							contractCustomerId,
							revisionKey,
							textStatus,
							text: extraction.text,
							textHash: extraction.textHash,
							byteCount: extraction.byteCount,
							characterCount: extraction.characterCount,
							pageCount: extraction.pageCount,
							truncated: extraction.truncated,
							extractionWarnings: inputJson(extraction.warnings),
							extractedAt: now,
						},
						update: {
							contractCustomerId,
							revisionKey,
							textStatus,
							text: extraction.text,
							textHash: extraction.textHash,
							byteCount: extraction.byteCount,
							characterCount: extraction.characterCount,
							pageCount: extraction.pageCount,
							truncated: extraction.truncated,
							extractionError: null,
							extractionWarnings: inputJson(extraction.warnings),
							extractedAt: now,
							parseStatus: ContractParseStatus.PENDING,
							parserVersion: null,
							parsed: Prisma.DbNull,
							parseError: null,
							parsedAt: null,
						},
					});

					if (extraction.needsOcr) {
						needsOcr += 1;
					} else {
						await scheduleContractParse(sourceRecordId, document.name);
						scheduledParses += 1;
					}
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					extractionErrors.push(`${document.id}: ${reason}`);
					await db.contractDocument.upsert({
						where: { sourceRecordId },
						create: {
							sourceRecordId,
							contractCustomerId,
							revisionKey,
							textStatus: ContractTextStatus.FAILED,
							extractionError: reason.slice(0, 1000),
							parseStatus: ContractParseStatus.FAILED,
							parseError: "Text extraction failed.",
						},
						update: {
							contractCustomerId,
							revisionKey,
							textStatus: ContractTextStatus.FAILED,
							text: null,
							textHash: null,
							extractionError: reason.slice(0, 1000),
							extractionWarnings: Prisma.DbNull,
							extractedAt: now,
							parseStatus: ContractParseStatus.FAILED,
							parsed: Prisma.DbNull,
							parseError: "Text extraction failed.",
							parsedAt: null,
						},
					});
				}
			},
		);

		let mappingSuggestions = 0;
		await runLimited(
			MAPPING_CONCURRENCY,
			crawl.customerFolders,
			async (folder) => {
				const customer = customers.get(folder.id);
				if (!customer) return;
				const candidates = await suggestContractCustomerMappings(db, {
					contractCustomerId: customer.id,
					folderName: folder.name,
					legalName: customer.legalName,
				});
				mappingSuggestions += candidates.length;
			},
		);

		const missing = await db.sourceRecord.updateMany({
			where: {
				sourceId: source.id,
				kind: ExternalRecordKind.DOCUMENT,
				sourceDeletedAt: null,
				externalId: { notIn: crawl.documents.map((document) => document.id) },
			},
			data: { sourceDeletedAt: now },
		});
		const incomplete = extractionErrors.length + needsOcr;
		const lastError =
			incomplete > 0
				? `${extractionErrors.length} contract document(s) failed text extraction; ${needsOcr} require OCR.`
				: null;

		await completeRun({
			runId: run.id,
			sourceId: source.id,
			records: crawl.documents.length,
			snapshots,
			checkpoint: {
				rootFolderId: crawl.root.id,
				folders: crawl.folders,
				customers: crawl.customerFolders.length,
				documents: crawl.documents.length,
				unsupportedFiles: crawl.unsupportedFiles,
				extracted: pendingExtraction.length - extractionErrors.length,
				extractionErrors: extractionErrors.length,
				needsOcr,
				scheduledParses,
				mappingSuggestions,
				missing: missing.count,
				missingCustomers: missingCustomers.count,
			},
			freshnessMs: FRESHNESS_MS,
			state: incomplete > 0 ? SourceStatus.STALE : SourceStatus.HEALTHY,
			lastError,
		});

		return {
			configured: true,
			processed: crawl.documents.length,
			snapshots,
			missing: missing.count,
			folders: crawl.folders,
			customers: crawl.customerFolders.length,
			unsupportedFiles: crawl.unsupportedFiles,
			extracted: pendingExtraction.length - extractionErrors.length,
			extractionErrors: extractionErrors.length,
			needsOcr,
			scheduledParses,
			mappingSuggestions,
		};
	} catch (error) {
		await failRun(run.id, source.id, error);
		throw error;
	}
}

async function scheduleContractParse(
	sourceRecordId: string,
	documentName: string,
): Promise<void> {
	await scheduleTask({
		sourceRecordId,
		kind: "contract-parse",
		reason: `A customer contract was added or changed: ${documentName}`,
		dueAt: new Date(),
		priority: 250,
		budget: 0,
	});
}
