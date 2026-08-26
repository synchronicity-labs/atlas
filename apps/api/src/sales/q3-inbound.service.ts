import { createHash } from "node:crypto";
import { type Db, type Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { type Q3InboundImport, q3InboundImport } from "./q3-inbound.contracts";

@Injectable()
export class Q3InboundService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async ingest(input: Q3InboundImport) {
		const value = normalized(input);
		const contentHash = createHash("sha256")
			.update(JSON.stringify(value))
			.digest("hex");
		const created = await this.db.q3InboundSnapshot.createMany({
			data: [
				{
					quarterStart: new Date(value.quarterStart),
					dataThrough: new Date(value.dataThrough),
					sourceItemCount: value.sourceItemCount,
					rows: value.rows as Prisma.InputJsonValue,
					contentHash,
				},
			],
			skipDuplicates: true,
		});
		return {
			accepted: true,
			created: created.count,
			quarterStart: value.quarterStart,
			dataThrough: value.dataThrough,
			sourceItemCount: value.sourceItemCount,
			rowCount: value.rows.length,
			contentHash,
		};
	}

	async latest(): Promise<Q3InboundImport | null> {
		const snapshot = await this.db.q3InboundSnapshot.findFirst({
			where: { quarterStart: new Date("2026-07-01T00:00:00.000Z") },
			orderBy: { capturedAt: "desc" },
		});
		if (!snapshot) return null;
		return q3InboundImport.parse({
			quarterStart: snapshot.quarterStart.toISOString(),
			dataThrough: snapshot.dataThrough.toISOString(),
			sourceItemCount: snapshot.sourceItemCount,
			rows: snapshot.rows,
		});
	}
}

function normalized(input: Q3InboundImport): Q3InboundImport {
	const value = q3InboundImport.parse(input);
	return {
		...value,
		quarterStart: new Date(value.quarterStart).toISOString(),
		dataThrough: new Date(value.dataThrough).toISOString(),
		rows: [...value.rows]
			.map((row) => ({
				...row,
				weekStart: new Date(row.weekStart).toISOString(),
				periodEnd: new Date(row.periodEnd).toISOString(),
			}))
			.sort(
				(left, right) =>
					Date.parse(left.weekStart) - Date.parse(right.weekStart),
			),
	};
}
