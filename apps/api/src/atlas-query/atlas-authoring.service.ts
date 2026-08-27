import {
	DataSourceKind,
	type Db,
	MetricLifecycleStatus,
	MetricTrustStatus,
	type Prisma,
	QueryLanguage,
	QuestionPurpose,
	QuestionStatus,
	SourceStatus,
	VisualizationType,
} from "@crm/db";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { MarketingService } from "../marketing/marketing.service";
import type {
	AtlasQuestionDraft,
	AtlasQuestionPublish,
} from "./atlas-authoring.contracts";
import {
	ATLAS_AUTOMATED_REPORT_DASHBOARD,
	ATLAS_AUTOMATED_REPORT_DASHBOARD_ID,
	ATLAS_AUTOMATED_REPORT_SOURCE,
	atlasAuthoringRecipe,
} from "./atlas-authoring.recipes";

const SOURCE_KEY = "atlas:rudy-cron-authoring";
const LOCK_ID = 2_026_082_601;
const AUTOMATED_LOCK_ID = 2_026_082_602;
type QuestionDatabase = Pick<Db, "question">;

const PUBLICATION_SELECT = {
	id: true,
	number: true,
	publicNumber: true,
	name: true,
	status: true,
	purpose: true,
	sourceExternalId: true,
	source: {
		select: {
			state: true,
			freshnessDeadlineAt: true,
			lastError: true,
		},
	},
	versions: {
		orderBy: { version: "desc" },
		take: 1,
		select: {
			version: true,
			queryLanguage: true,
			queryText: true,
			createdBy: true,
		},
	},
	metricVersion: {
		select: {
			approvedAt: true,
			metric: { select: { status: true } },
			snapshots: {
				orderBy: { computedAt: "desc" },
				take: 1,
				select: {
					trustStatus: true,
					dataThrough: true,
					reportingPeriod: true,
					computedAt: true,
				},
			},
		},
	},
} satisfies Prisma.QuestionSelect;

type PublicationQuestion = Prisma.QuestionGetPayload<{
	select: typeof PUBLICATION_SELECT;
}>;

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
		"Status: Draft. Atlas can publish it only when a reviewed automated recipe matches this request.",
	].join("\n\n");
}

@Injectable()
export class AtlasAuthoringService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly marketing: MarketingService,
	) {}

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

	async publishDraft(publicNumber: number, input: AtlasQuestionPublish) {
		const recipe = atlasAuthoringRecipe(input.recipe);
		if (!recipe) {
			throw new BadRequestException("This Atlas recipe is not available.");
		}
		if (recipe.requestKey !== input.requestKey) {
			throw new BadRequestException(
				"This Atlas recipe does not match the draft request key.",
			);
		}
		const existing = await this.publicationQuestion(publicNumber);
		if (!existing) {
			throw new NotFoundException(`No Atlas question ${publicNumber}.`);
		}
		this.assertQuestionIdentity(existing, input.requestKey);
		const latest = existing.versions[0];
		if (!latest) {
			throw new ConflictException("The Atlas draft has no version.");
		}
		const alreadyMaterialized =
			latest.queryText === recipe.queryText &&
			latest.createdBy === `atlas-recipe:${recipe.key}:v${recipe.version}`;
		if (!alreadyMaterialized) {
			this.assertDraft(existing, latest, input.expectedDraftVersion);
			await this.materialize(publicNumber, input, recipe);
		}
		const sync = await this.marketing.syncDashboard(
			ATLAS_AUTOMATED_REPORT_DASHBOARD,
		);
		let state = await this.publicationQuestion(publicNumber);
		if (!state) {
			throw new NotFoundException(`No Atlas question ${publicNumber}.`);
		}
		const eligible = this.publicationEligibility(state);
		if (eligible && state.status !== QuestionStatus.ACTIVE) {
			await this.db.question.update({
				where: { id: state.id },
				data: { status: QuestionStatus.ACTIVE },
			});
			state = await this.publicationQuestion(publicNumber);
			if (!state) {
				throw new NotFoundException(`No Atlas question ${publicNumber}.`);
			}
		}
		return this.publicationResult(state, recipe, sync.errors);
	}

	private async materialize(
		publicNumber: number,
		input: AtlasQuestionPublish,
		recipe: NonNullable<ReturnType<typeof atlasAuthoringRecipe>>,
	) {
		await this.db.$transaction(async (transaction) => {
			await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${AUTOMATED_LOCK_ID})`;
			const question = await transaction.question.findUnique({
				where: { publicNumber },
				select: {
					id: true,
					sourceExternalId: true,
					status: true,
					purpose: true,
					versions: {
						orderBy: { version: "desc" },
						take: 1,
						select: {
							version: true,
							queryLanguage: true,
							queryText: true,
							createdBy: true,
						},
					},
				},
			});
			if (!question) {
				throw new NotFoundException(`No Atlas question ${publicNumber}.`);
			}
			const latest = question.versions[0];
			if (!latest) {
				throw new ConflictException("The Atlas draft has no version.");
			}
			this.assertQuestionIdentity(question, input.requestKey);
			const createdBy = `atlas-recipe:${recipe.key}:v${recipe.version}`;
			const alreadyMaterialized =
				latest.queryText === recipe.queryText && latest.createdBy === createdBy;
			if (!alreadyMaterialized) {
				this.assertDraft(question, latest, input.expectedDraftVersion);
			}
			const source = await transaction.dataSource.upsert({
				where: { key: ATLAS_AUTOMATED_REPORT_SOURCE },
				create: {
					key: ATLAS_AUTOMATED_REPORT_SOURCE,
					kind: DataSourceKind.ATLAS,
					label: "Atlas reviewed automated reports",
					state: SourceStatus.UNCONFIGURED,
				},
				update: {
					kind: DataSourceKind.ATLAS,
					label: "Atlas reviewed automated reports",
				},
				select: { id: true },
			});
			if (!alreadyMaterialized) {
				await transaction.questionVersion.create({
					data: {
						questionId: question.id,
						version: latest.version + 1,
						queryLanguage: recipe.queryLanguage,
						queryText: recipe.queryText,
						display: recipe.display,
						visualization: json(recipe.visualization),
						createdBy,
					},
				});
			}
			await transaction.question.update({
				where: { id: question.id },
				data: {
					description: recipe.description,
					connector: DataSourceKind.ATLAS,
					sourceId: source.id,
					sourceDashboardExternalId: "atlas:automated-reports",
					databaseExternalId: null,
					status: QuestionStatus.DRAFT,
					purpose: QuestionPurpose.RECONCILIATION,
				},
			});
			const dashboard = await transaction.dashboard.upsert({
				where: { id: ATLAS_AUTOMATED_REPORT_DASHBOARD_ID },
				create: {
					id: ATLAS_AUTOMATED_REPORT_DASHBOARD_ID,
					number: ATLAS_AUTOMATED_REPORT_DASHBOARD,
					name: "Automated governed reports",
					description: "Reviewed Atlas recipes created for recurring reports.",
					createdBy: "atlas-authoring",
				},
				update: {
					name: "Automated governed reports",
					description: "Reviewed Atlas recipes created for recurring reports.",
				},
				select: { id: true },
			});
			const tab = await transaction.dashboardTab.upsert({
				where: {
					dashboardId_number: { dashboardId: dashboard.id, number: 1 },
				},
				create: {
					dashboardId: dashboard.id,
					number: 1,
					name: "Recurring reports",
					position: 0,
					sourceExternalId: "atlas:automated-reports",
				},
				update: {
					name: "Recurring reports",
					position: 0,
					sourceExternalId: "atlas:automated-reports",
				},
				select: { id: true },
			});
			const existingCard = await transaction.dashboardCard.findFirst({
				where: { dashboardId: dashboard.id, questionId: question.id },
				select: { id: true },
			});
			if (!existingCard) {
				const maximum = await transaction.dashboardCard.aggregate({
					where: { dashboardId: dashboard.id },
					_max: { position: true },
				});
				const position = (maximum._max.position ?? -1) + 1;
				await transaction.dashboardCard.create({
					data: {
						dashboardId: dashboard.id,
						tabId: tab.id,
						questionId: question.id,
						position,
						x: 0,
						y: position * 8,
						width: 24,
						height: 8,
						visualization: VisualizationType.TABLE,
						displaySettings: json({ compact: true }),
					},
				});
			}
		});
	}

	private assertQuestionIdentity(
		question: {
			sourceExternalId: string | null;
		},
		requestKey: string,
	) {
		if (question.sourceExternalId !== `rudy-cron:${requestKey}`) {
			throw new ConflictException(
				"The Atlas question does not match this Rudy request.",
			);
		}
	}

	private assertDraft(
		question: {
			status: QuestionStatus;
			purpose: QuestionPurpose;
		},
		latest: {
			version: number;
			queryLanguage: QueryLanguage;
			queryText: string;
			createdBy: string;
		},
		expectedVersion: number,
	) {
		if (
			question.status !== QuestionStatus.DRAFT ||
			question.purpose !== QuestionPurpose.RECONCILIATION ||
			latest.version !== expectedVersion ||
			latest.queryLanguage !== QueryLanguage.API ||
			latest.createdBy !== "rudy" ||
			!latest.queryText.startsWith("rudy-cron:draft:")
		) {
			throw new ConflictException(
				"The Atlas draft changed after Rudy created it. Run the Atlas preflight again.",
			);
		}
	}

	private publicationQuestion(publicNumber: number) {
		return this.db.question.findUnique({
			where: { publicNumber },
			select: PUBLICATION_SELECT,
		});
	}

	private publicationEligibility(question: PublicationQuestion) {
		const snapshot = question.metricVersion?.snapshots[0];
		return (
			question.purpose === QuestionPurpose.CERTIFIED &&
			question.metricVersion?.metric.status ===
				MetricLifecycleStatus.CERTIFIED &&
			Boolean(question.metricVersion.approvedAt) &&
			snapshot?.trustStatus === MetricTrustStatus.VERIFIED &&
			question.source?.state === SourceStatus.HEALTHY &&
			Boolean(
				question.source.freshnessDeadlineAt &&
					question.source.freshnessDeadlineAt.getTime() > Date.now(),
			)
		);
	}

	private publicationResult(
		question: PublicationQuestion,
		recipe: NonNullable<ReturnType<typeof atlasAuthoringRecipe>>,
		errors: Array<{ number: number; message: string }>,
	) {
		const cronEligible =
			question.status === QuestionStatus.ACTIVE &&
			this.publicationEligibility(question);
		const snapshot = question.metricVersion?.snapshots[0];
		return {
			schemaVersion: "atlas.authoring-publication.v1",
			question: {
				number: question.publicNumber,
				name: question.name,
				status: question.status,
				purpose: question.purpose,
				sourceExternalId: question.sourceExternalId,
				version: question.versions[0]?.version ?? null,
			},
			recipe: { key: recipe.key, version: recipe.version },
			cronEligible,
			cronBlocked: !cronEligible,
			result: snapshot
				? {
						trustStatus: snapshot.trustStatus,
						dataThrough: snapshot.dataThrough.toISOString(),
						reportingPeriod: snapshot.reportingPeriod,
						computedAt: snapshot.computedAt.toISOString(),
					}
				: null,
			freshness: {
				state: question.source?.state ?? null,
				deadlineAt: question.source?.freshnessDeadlineAt?.toISOString() ?? null,
				lastError: question.source?.lastError ?? null,
			},
			errors,
			nextAction: cronEligible
				? `Create the recurring report with canonical Atlas Q${question.publicNumber}.`
				: "The reviewed recipe did not pass every verification check. Fix the reported source or method error, then retry publication.",
		};
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
