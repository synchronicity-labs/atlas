import {
	DataSourceKind,
	type Db,
	type Prisma,
	QueryLanguage,
	QuestionPurpose,
	QuestionStatus,
	SourceStatus,
} from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type { AtlasQuestionDraft } from "./atlas-authoring.contracts";

const SOURCE_KEY = "atlas:rudy-cron-authoring";
const LOCK_ID = 2_026_082_601;
type QuestionDatabase = Pick<Db, "question">;

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function description(input: AtlasQuestionDraft): string {
	return [
		input.businessDefinition,
		`Decision use: ${input.decisionUse}`,
		`Owner: ${input.ownerTeam}`,
		`Cadence: ${input.cadence}`,
		`Dimensions: ${input.dimensions.length > 0 ? input.dimensions.join(", ") : "none"}`,
		`Source hints: ${input.sourceHints.length > 0 ? input.sourceHints.join(", ") : "none"}`,
		`Acceptance checks: ${input.acceptanceChecks.join(" | ")}`,
		"Status: Draft. A human must add a governed source query and certify the metric before a cron can use it.",
	].join("\n\n");
}

@Injectable()
export class AtlasAuthoringService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async createDraft(input: AtlasQuestionDraft) {
		const sourceExternalId = `rudy-cron:${input.requestKey}`;
		const existing = await this.find(sourceExternalId);
		if (existing) return this.result(existing, false);

		return this.db.$transaction(async (transaction) => {
			await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_ID})`;
			const repeated = await this.find(sourceExternalId, transaction);
			if (repeated) return this.result(repeated, false);
			const [source, maximum] = await Promise.all([
				transaction.dataSource.upsert({
					where: { key: SOURCE_KEY },
					create: {
						key: SOURCE_KEY,
						kind: DataSourceKind.ATLAS,
						label: "Rudy cron question drafts",
						state: SourceStatus.HEALTHY,
					},
					update: { state: SourceStatus.HEALTHY, lastError: null },
					select: { id: true },
				}),
				transaction.question.aggregate({ _max: { number: true } }),
			]);
			const question = await transaction.question.create({
				data: {
					number: (maximum._max.number ?? 0) + 1,
					name: input.name,
					description: description(input),
					connector: DataSourceKind.ATLAS,
					sourceId: source.id,
					sourceExternalId,
					status: QuestionStatus.DRAFT,
					purpose: QuestionPurpose.RECONCILIATION,
					versions: {
						create: {
							version: 1,
							queryLanguage: QueryLanguage.API,
							queryText: `rudy-cron:draft:${input.requestKey}`,
							display: "table",
							visualization: json({}),
							createdBy: "rudy",
						},
					},
				},
				select: {
					publicNumber: true,
					name: true,
					status: true,
					purpose: true,
					sourceExternalId: true,
					createdAt: true,
				},
			});
			return this.result(question, true);
		});
	}

	private find(sourceExternalId: string, database: QuestionDatabase = this.db) {
		return database.question.findUnique({
			where: {
				connector_sourceExternalId: {
					connector: DataSourceKind.ATLAS,
					sourceExternalId,
				},
			},
			select: {
				publicNumber: true,
				name: true,
				status: true,
				purpose: true,
				sourceExternalId: true,
				createdAt: true,
			},
		});
	}

	private result(
		question: {
			publicNumber: number;
			name: string;
			status: QuestionStatus;
			purpose: QuestionPurpose;
			sourceExternalId: string | null;
			createdAt: Date;
		},
		created: boolean,
	) {
		return {
			schemaVersion: "atlas.authoring-draft.v1",
			created,
			question: {
				number: question.publicNumber,
				name: question.name,
				status: question.status,
				purpose: question.purpose,
				sourceExternalId: question.sourceExternalId,
				createdAt: question.createdAt.toISOString(),
			},
			cronEligible: false,
			nextAction:
				"Add a governed source query, verify the result, and certify the question before enabling a report cron.",
		};
	}
}
