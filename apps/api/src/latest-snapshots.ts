import { type Db, Prisma } from "@crm/db";

export async function latestMetricSnapshotIds(
	db: Db,
	metricVersionIds: string[],
) {
	const keys = [...new Set(metricVersionIds)];
	if (!keys.length) return [];
	const snapshots = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
		SELECT latest."id"
		FROM unnest(ARRAY[${Prisma.join(keys)}]::text[]) AS requested("metricVersionId")
		CROSS JOIN LATERAL (
			SELECT "id" FROM "metrics"."metricSnapshot"
			WHERE "metricVersionId" = requested."metricVersionId"
			ORDER BY "computedAt" DESC, "id" DESC
			LIMIT 1
		) AS latest
	`);
	return snapshots.map((snapshot) => snapshot.id);
}

export async function latestResultSnapshotIds(
	db: Db,
	questionExternalIds: string[],
) {
	const keys = [...new Set(questionExternalIds)];
	if (!keys.length) return [];
	const snapshots = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
		SELECT latest."id"
		FROM unnest(ARRAY[${Prisma.join(keys)}]::text[]) AS requested("questionExternalId")
		CROSS JOIN LATERAL (
			SELECT "id" FROM "public"."resultSnapshot"
			WHERE "questionExternalId" = requested."questionExternalId"
			ORDER BY "capturedAt" DESC, "id" DESC
			LIMIT 1
		) AS latest
	`);
	return snapshots.map((snapshot) => snapshot.id);
}
