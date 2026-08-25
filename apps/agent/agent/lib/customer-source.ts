import { createHash, randomUUID } from "node:crypto";
import {
	type DataSourceKind,
	db,
	type ExternalRecordKind,
	type Prisma,
	SourceStatus,
	SyncMode,
	SyncRunStatus,
} from "@crm/db";

export function inputJson(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export function contentHash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function dateValue(value: unknown): Date | null {
	if (typeof value !== "string" || !value.trim()) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function stringValue(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const parsed = String(value).trim();
	return parsed ? parsed : null;
}

export async function ensureSource(input: {
	key: string;
	kind: DataSourceKind;
	label: string;
	configured: boolean;
}) {
	return db.dataSource.upsert({
		where: { key: input.key },
		create: {
			key: input.key,
			kind: input.kind,
			label: input.label,
			state: input.configured ? SourceStatus.STALE : SourceStatus.UNCONFIGURED,
		},
		update: input.configured
			? {}
			: { state: SourceStatus.UNCONFIGURED, lastError: null },
	});
}

export async function beginRun(input: {
	sourceId: string;
	scope: string;
	period?: string;
}) {
	await db.syncRun.updateMany({
		where: {
			sourceId: input.sourceId,
			scope: input.scope,
			status: SyncRunStatus.RUNNING,
			startedAt: { lt: new Date(Date.now() - 30 * 60_000) },
		},
		data: {
			status: SyncRunStatus.FAILED,
			finishedAt: new Date(),
			error: "The previous sync stopped before its checkpoint completed.",
		},
	});

	return db.syncRun.create({
		data: {
			runKey: `${input.scope}:${new Date().toISOString()}:${randomUUID()}`,
			sourceId: input.sourceId,
			mode: SyncMode.INCREMENTAL,
			status: SyncRunStatus.RUNNING,
			scope: input.scope,
			period: input.period ?? new Date().toISOString().slice(0, 7),
		},
	});
}

export async function failRun(
	runId: string,
	sourceId: string,
	error: unknown,
): Promise<void> {
	const reason = error instanceof Error ? error.message : String(error);
	await db.$transaction([
		db.syncRun.update({
			where: { id: runId },
			data: {
				status: SyncRunStatus.FAILED,
				finishedAt: new Date(),
				error: reason.slice(0, 1000),
			},
		}),
		db.dataSource.update({
			where: { id: sourceId },
			data: {
				state: SourceStatus.ERROR,
				lastError: reason.slice(0, 1000),
			},
		}),
	]);
}

export async function completeRun(input: {
	runId: string;
	sourceId: string;
	records: number;
	snapshots: number;
	checkpoint?: unknown;
	freshnessMs: number;
	state?: SourceStatus;
	lastError?: string | null;
}) {
	const now = new Date();
	await db.$transaction([
		db.syncRun.update({
			where: { id: input.runId },
			data: {
				status: SyncRunStatus.COMPLETED,
				finishedAt: now,
				recordsProcessed: input.records,
				snapshotsCreated: input.snapshots,
				checkpoint: input.checkpoint ? inputJson(input.checkpoint) : undefined,
			},
		}),
		db.dataSource.update({
			where: { id: input.sourceId },
			data: {
				state: input.state ?? SourceStatus.HEALTHY,
				lastSyncAt: now,
				lastError: input.lastError ?? null,
				freshnessDeadlineAt: new Date(now.getTime() + input.freshnessMs),
			},
		}),
	]);
}

export async function persistSourceRecord(input: {
	sourceId: string;
	kind: ExternalRecordKind;
	externalId: string;
	payload: unknown;
	companyId?: string | null;
	contactId?: string | null;
	sourceCreatedAt?: Date | null;
	sourceUpdatedAt?: Date | null;
}) {
	const hash = contentHash(input.payload);
	const now = new Date();
	const record = await db.sourceRecord.upsert({
		where: {
			sourceId_kind_externalId: {
				sourceId: input.sourceId,
				kind: input.kind,
				externalId: input.externalId,
			},
		},
		create: {
			sourceId: input.sourceId,
			kind: input.kind,
			externalId: input.externalId,
			companyId: input.companyId ?? null,
			contactId: input.contactId ?? null,
			contentHash: hash,
			payload: inputJson(input.payload),
			sourceCreatedAt: input.sourceCreatedAt ?? null,
			sourceUpdatedAt: input.sourceUpdatedAt ?? null,
			syncedAt: now,
		},
		update: {
			companyId: input.companyId ?? null,
			contactId: input.contactId ?? null,
			contentHash: hash,
			payload: inputJson(input.payload),
			sourceCreatedAt: input.sourceCreatedAt ?? null,
			sourceUpdatedAt: input.sourceUpdatedAt ?? null,
			sourceDeletedAt: null,
			syncedAt: now,
		},
	});

	const snapshot = await db.sourceRecordSnapshot.createMany({
		data: [
			{
				idempotencyKey: `${input.sourceId}:${input.kind}:${input.externalId}:${hash}`,
				sourceId: input.sourceId,
				sourceRecordId: record.id,
				capturedAt: now,
				contentHash: hash,
				payload: inputJson(input.payload),
			},
		],
		skipDuplicates: true,
	});

	return { record, snapshotCreated: snapshot.count };
}
