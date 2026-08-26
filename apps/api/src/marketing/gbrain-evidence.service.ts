import { createHash } from "node:crypto";
import { type Db, type Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	type GbrainEvidenceImport,
	gbrainEvidenceImport,
} from "./gbrain-evidence.contracts";

@Injectable()
export class GbrainEvidenceService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async ingest(input: GbrainEvidenceImport) {
		const value = normalized(input);
		const contentHash = createHash("sha256")
			.update(JSON.stringify(value))
			.digest("hex");
		const created = await this.db.gbrainModelFeedbackSnapshot.createMany({
			data: [
				{
					weekStart: new Date(value.weekStart),
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
			weekStart: value.weekStart,
			dataThrough: value.dataThrough,
			sourceItemCount: value.sourceItemCount,
			rowCount: value.rows.length,
			contentHash,
		};
	}

	async latestForWeek(weekStart: Date): Promise<GbrainEvidenceImport | null> {
		const snapshot = await this.db.gbrainModelFeedbackSnapshot.findFirst({
			where: { weekStart },
			orderBy: { capturedAt: "desc" },
		});
		if (!snapshot) return null;
		return gbrainEvidenceImport.parse({
			weekStart: snapshot.weekStart.toISOString(),
			dataThrough: snapshot.dataThrough.toISOString(),
			sourceItemCount: snapshot.sourceItemCount,
			rows: snapshot.rows,
		});
	}
}

function normalized(input: GbrainEvidenceImport): GbrainEvidenceImport {
	const value = gbrainEvidenceImport.parse(input);
	return {
		...value,
		weekStart: new Date(value.weekStart).toISOString(),
		dataThrough: new Date(value.dataThrough).toISOString(),
		rows: [...value.rows].sort((a, b) =>
			`${a.model}:${a.supportTheme}`.localeCompare(
				`${b.model}:${b.supportTheme}`,
			),
		),
	};
}
