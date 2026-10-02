import { createHash, randomUUID } from "node:crypto";
import {
	DataSourceKind,
	type Db,
	type Prisma,
	QueryLanguage,
	QuestionPurpose,
	QuestionStatus,
	SourceStatus,
} from "@crm/db";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { InjectDatabase } from "../../database/database.constants";
import registry from "./registry.json";

const SOURCE_KEY = "atlas:qbr";
const QUESTION_LOCK_ID = 2_026_082_601;
const REGISTRY_QUARTER = "2026-Q3";
const REPORTING_PERIOD = "2026-Q3";
const QUESTION_BASE_URL = "https://atlas.pr.sync.so/questions";
const COHORT_METRICS = new Set([
	"product_m3_requalification",
	"product_m3_ndr",
	"product_reactivation",
]);
const OBSERVATION_COLUMNS = [
	"period",
	"value",
	"numerator",
	"denominator",
	"status",
	"evidenceSource",
	"asOf",
	"dataThrough",
	"cohortMonth",
	"reportedBy",
	"definitionHash",
	"source_label",
	"source_url",
	"snapshotId",
	"verification",
	"sourceQueryHash",
];
const validPeriod = (period: string) =>
	period === REPORTING_PERIOD || /^2026-0[6-9]$/.test(period);

type RegistryMetric = (typeof registry.metrics)[number];

const preparationText = z.string().trim().min(1).max(4_000);
const preparationSource = z
	.object({
		label: z.string().trim().min(1).max(240),
		url: z
			.string()
			.trim()
			.max(2_048)
			.url()
			.refine((value) => {
				try {
					const url = new URL(value);
					return url.protocol === "https:" && !url.username && !url.password;
				} catch {
					return false;
				}
			}),
	})
	.strict();
const preparationSchema = z
	.object({
		owner: z.string().trim().min(1).max(240),
		ownerStatus: preparationText,
		ownerSource: preparationSource,
		gap: preparationText,
		dataLocation: preparationText,
		manualAsk: preparationText,
		q4Build: preparationText,
		workstream: z.string().trim().min(1).max(240),
		sources: z
			.array(
				preparationSource.extend({
					limit: z.string().trim().max(4_000).default(""),
				}),
			)
			.max(20),
		supportingResults: z
			.array(
				z
					.object({
						label: z.string().trim().min(1).max(240),
						asOf: z
							.string()
							.datetime({ offset: true })
							.refine((value) => Date.parse(value) <= Date.now()),
						source: preparationSource,
						queryText: z.string().trim().min(1).max(50_000),
						columns: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
						rows: z
							.array(
								z
									.array(
										z.union([
											z.string().max(1_000),
											z.number().finite(),
											z.boolean(),
											z.null(),
										]),
									)
									.max(20),
							)
							.max(200),
						limitations: preparationText,
					})
					.strict()
					.refine(
						(result) =>
							new Set(result.columns).size === result.columns.length &&
							result.rows.every((row) => row.length === result.columns.length),
					),
			)
			.max(5)
			.optional(),
	})
	.strict();
const preparationBatchSchema = z
	.object({
		quarter: z.literal(REGISTRY_QUARTER),
		preparations: z
			.array(
				z
					.object({
						metricId: z
							.string()
							.max(120)
							.refine((id) =>
								registry.metrics.some((metric) => metric.id === id),
							),
						preparation: preparationSchema,
					})
					.strict(),
			)
			.min(1)
			.max(registry.metrics.length),
	})
	.strict();

const verificationSchema = z
	.object({
		verifiedBy: z.string().trim().min(1).max(240),
		verifiedAt: z.string().datetime(),
		definition: preparationSource,
		population: preparationSource,
		coverage: preparationSource,
		reconciliation: preparationSource,
	})
	.strict();
const verificationBatchSchema = z
	.object({
		metricId: z.string().min(1),
		snapshotId: z.string().min(1),
		definitionHash: z.string().min(1),
		observations: z
			.array(
				z
					.object({
						period: z.string(),
						dataThrough: z.string().datetime(),
						verification: verificationSchema,
					})
					.strict(),
			)
			.min(1)
			.max(5),
	})
	.strict();
type QbrVerification = z.infer<typeof verificationSchema> & {
	reviewedSnapshotId: string;
	reviewedQueryHash: string;
};

type QbrReportObservation = {
	value: number;
	numerator: number | null;
	denominator: number | null;
	status: "provisional" | "reported" | "verified";
	source: { label: string; url: string };
	asOf: string;
	dataThrough: string | null;
	cohortMonth?: string;
	reportedBy?: string;
	evidenceSource: { label: string; url: string };
	snapshotId: string;
	definitionHash: string;
	verification?: QbrVerification;
	sourceQueryHash?: string;
};
export type AtlasQbrReport = {
	schemaVersion: "atlas.qbr.v1";
	quarter: string;
	definitionVersion: string;
	generatedAt: string;
	metrics: Record<
		string,
		{
			question: { number: number; url: string } | null;
			label: string;
			definition: string;
			unit: string;
			notApplicable: boolean;
			automated: boolean;
			preparation: z.infer<typeof preparationSchema>;
			observations: Record<string, QbrReportObservation>;
		}
	>;
};
type Observation = {
	period: string;
	value: number;
	numerator: number | null;
	denominator: number | null;
	status: "provisional" | "reported" | "verified";
	evidenceSource: { label: string; url: string };
	asOf: string;
	dataThrough: string | null;
	cohortMonth?: string;
	reportedBy?: string;
	verification?: QbrVerification;
};
type StoredObservation = Omit<Observation, "cohortMonth" | "reportedBy"> & {
	cohortMonth?: string | null;
	reportedBy?: string | null;
	definitionHash: string;
	source: { label: string; url: string };
	snapshotId: string;
	sourceQueryHash?: string;
};
type QueryDefinition = { queryText: string; databaseExternalId: string };

function hash(value: unknown): string {
	const canonical = (item: unknown): unknown => {
		if (Array.isArray(item)) return item.map(canonical);
		if (item && typeof item === "object")
			return Object.fromEntries(
				Object.entries(item)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([key, entry]) => [key, canonical(entry)]),
			);
		return item;
	};
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function metricDefinitionHash(metric: RegistryMetric): string {
	return hash({ definition: metric.definition, unit: metric.unit });
}

function description(metric: RegistryMetric): string {
	return [
		metric.definition,
		`Owner: ${metric.preparation.owner}`,
		`Owner status: ${metric.preparation.ownerStatus}`,
		`Owner source: ${metric.preparation.ownerSource.label} (${metric.preparation.ownerSource.url})`,
		`Gap: ${metric.preparation.gap}`,
		`Data location: ${metric.preparation.dataLocation}`,
		`Manual ask: ${metric.preparation.manualAsk}`,
		`Q4 build: ${metric.preparation.q4Build}`,
		`Workstream: ${metric.preparation.workstream}`,
		`Sources: ${metric.preparation.sources.map((source) => `${source.label} (${source.url})${source.limit ? ` — ${source.limit}` : ""}`).join("; ") || "none"}`,
	].join("\n\n");
}

const PREVIOUS_DESCRIPTION_HASHES: Partial<Record<string, string>> = {
	plg_teams: "940a1ac2544877f854baf30b183f436d3f1e0b4ec075e80c901fe39a3bd04d3b",
	product_m3_requalification:
		"31d6a21a8b9b4cea95c039c883347703cdadfe50b405b75afcfc7a8a3d9899ef",
	product_m3_ndr:
		"5e83150805c8e6ddd9da94f7b975fba9c487bd82e48a636bbbdbc3cb07d70148",
	product_reactivation:
		"e3d11938c87b2daa53a2e631829047722f704df1cd93e11b0ad09575aa0ade65",
	platform_completion:
		"a0017c78eead656155655addbe87919f106431d691c6f6e868c67f1509c86cce",
	plg_teams_adds:
		"6e4758023316bfc49adcc2d98652c1476b395d3a96cd80b7121eca98ffd13855",
	plg_teams_losses:
		"06c476fff3883697ed7a96712c52677808675287ddbac34c0ad729e2bccbd086",
	plg_teams_net:
		"b1f54be2d0fc58d0489ca52e18dd4f287f152ebc66b4f90b5fc4477ef5399901",
	plg_teams_period_end:
		"8b6bbac2b691e8deebc785f2a6765d67280b3fa115228a2eb456e7d8e531f88e",
};

function validDate(value: string, field: string): Date {
	const date = new Date(value);
	if (
		!value ||
		Number.isNaN(date.getTime()) ||
		!/^\d{4}-\d{2}-\d{2}T/.test(value)
	) {
		throw new BadRequestException(`${field} must be an ISO date.`);
	}
	return date;
}

function validateObservation(
	metric: RegistryMetric,
	observation: Observation | StoredObservation,
): void {
	if (!["provisional", "reported", "verified"].includes(observation.status)) {
		throw new BadRequestException("Unsupported QBR observation status.");
	}
	const monthMatch = /^(2026)-(0[6-9])$/.exec(observation.period);
	if (observation.period !== REPORTING_PERIOD && !monthMatch) {
		throw new BadRequestException(
			`Unsupported QBR period: ${observation.period}`,
		);
	}
	if (
		typeof observation.value !== "number" ||
		!Number.isFinite(observation.value) ||
		(observation.numerator !== null &&
			(typeof observation.numerator !== "number" ||
				!Number.isFinite(observation.numerator))) ||
		(observation.denominator !== null &&
			(typeof observation.denominator !== "number" ||
				!Number.isFinite(observation.denominator)))
	) {
		throw new BadRequestException(
			"QBR observations must contain finite numeric values.",
		);
	}
	if (observation.denominator !== null && observation.denominator <= 0)
		throw new BadRequestException(
			"QBR observation denominator must be greater than zero.",
		);
	if (
		!observation.evidenceSource?.label?.trim() ||
		!observation.evidenceSource.url?.trim()
	) {
		throw new BadRequestException(
			"QBR observations require a labeled evidence URL.",
		);
	}
	let evidenceUrl: URL;
	try {
		evidenceUrl = new URL(observation.evidenceSource.url);
	} catch {
		throw new BadRequestException("QBR evidence URL is invalid.");
	}
	if (
		evidenceUrl.protocol !== "https:" ||
		evidenceUrl.username ||
		evidenceUrl.password
	)
		throw new BadRequestException(
			"Evidence URLs must use HTTPS without embedded credentials.",
		);
	const asOf = validDate(observation.asOf, "asOf");
	if (asOf > new Date())
		throw new BadRequestException("asOf cannot be in the future.");
	const monthPeriod = monthMatch
		? `${monthMatch[1]}-${monthMatch[2]}`
		: "2026-09";
	const year = Number(monthPeriod.slice(0, 4));
	const month = Number(monthPeriod.slice(5, 7));
	const monthClose = new Date(Date.UTC(year, month, 1));
	if (asOf < monthClose)
		throw new BadRequestException(
			`${observation.period} is not closed as of ${observation.asOf}.`,
		);
	if (observation.dataThrough !== null) {
		const dataThrough = validDate(observation.dataThrough, "dataThrough");
		if (dataThrough > asOf)
			throw new BadRequestException("dataThrough cannot be after asOf.");
		if (dataThrough < monthClose)
			throw new BadRequestException(
				"dataThrough must reach the selected period close.",
			);
	}
	if (observation.status === "verified") {
		if (
			metric.unit === "percent" &&
			(observation.numerator === null ||
				observation.denominator === null ||
				Math.abs(
					observation.value -
						(100 * observation.numerator) / observation.denominator,
				) > 0.011)
		)
			throw new BadRequestException(
				"Verified percentages require a numerator and denominator that reconcile to the value.",
			);
		const verification = observation.verification;
		if (
			!verification?.reviewedSnapshotId ||
			!verification.reviewedQueryHash ||
			observation.dataThrough === null
		)
			throw new BadRequestException(
				"Verified QBR observations require a reviewed snapshot and complete source coverage.",
			);
		const {
			reviewedSnapshotId: _,
			reviewedQueryHash: __,
			...proof
		} = verification;
		if (!verificationSchema.safeParse(proof).success)
			throw new BadRequestException("QBR verification evidence is incomplete.");
		const verifiedAt = validDate(verification.verifiedAt, "verifiedAt");
		if (verifiedAt < asOf || verifiedAt > new Date())
			throw new BadRequestException(
				"Verification must follow the observation and cannot be in the future.",
			);
	} else if (observation.verification) {
		throw new BadRequestException(
			"Only verified observations may carry verification evidence.",
		);
	}
	if (COHORT_METRICS.has(metric.id)) {
		if (
			!observation.cohortMonth ||
			!/^\d{4}-(0[1-9]|1[0-2])$/.test(observation.cohortMonth)
		)
			throw new BadRequestException(
				"Cohort observations require a valid cohortMonth.",
			);
		const [cohortYear, cohortMonth] = [
			Number(observation.cohortMonth.slice(0, 4)),
			Number(observation.cohortMonth.slice(5, 7)),
		];
		const observationMonth = new Date(Date.UTC(cohortYear, cohortMonth + 1, 1))
			.toISOString()
			.slice(0, 7);
		if (observation.period !== observationMonth)
			throw new BadRequestException(
				"cohortMonth must be two months before the observation period.",
			);
	}
	if (
		observation.cohortMonth != null &&
		!/^\d{4}-(0[1-9]|1[0-2])$/.test(observation.cohortMonth)
	) {
		throw new BadRequestException("cohortMonth must use YYYY-MM format.");
	}
	if (observation.status === "provisional" && !metric.automated) {
		throw new BadRequestException(
			"Only automated QBR metrics may have provisional observations.",
		);
	}
	if (observation.status === "reported" && !observation.reportedBy?.trim()) {
		throw new BadRequestException(
			"Reported QBR observations require reportedBy.",
		);
	}
	if (
		metric.id === "finance_runway" &&
		(!Number.isInteger(observation.value) ||
			observation.value < 0 ||
			observation.numerator !== null ||
			observation.denominator !== null)
	) {
		throw new BadRequestException(
			"Runway must be a directly reported whole number of months with no operands.",
		);
	}
}

function rowsFrom(
	snapshotRows: Prisma.JsonValue,
	snapshotColumns: Prisma.JsonValue,
): StoredObservation[] {
	if (!Array.isArray(snapshotRows) || !Array.isArray(snapshotColumns))
		throw new ConflictException("Stored QBR snapshot rows are malformed.");
	const columns = snapshotColumns.map((column) => {
		if (typeof column === "string") return column;
		if (
			column &&
			typeof column === "object" &&
			!Array.isArray(column) &&
			typeof (column as Record<string, unknown>).name === "string"
		)
			return (column as Record<string, string>).name;
		throw new ConflictException("Stored QBR snapshot columns are malformed.");
	});
	const rows: StoredObservation[] = [];
	for (const row of snapshotRows) {
		if (!Array.isArray(row) || row.length !== columns.length)
			throw new ConflictException("Stored QBR observation is malformed.");
		const item = Object.fromEntries(
			columns.map((column, index) => [column, row[index]]),
		);
		const evidenceValue = item.evidenceSource;
		const evidenceSource =
			evidenceValue &&
			typeof evidenceValue === "object" &&
			!Array.isArray(evidenceValue)
				? (evidenceValue as Record<string, unknown>)
				: null;
		const sourceLabel = item.source_label;
		const sourceUrl = item.source_url;
		if (
			typeof item.period !== "string" ||
			!validPeriod(item.period) ||
			typeof item.value !== "number" ||
			!Number.isFinite(item.value) ||
			(item.numerator !== null &&
				(typeof item.numerator !== "number" ||
					!Number.isFinite(item.numerator))) ||
			(item.denominator !== null &&
				(typeof item.denominator !== "number" ||
					!Number.isFinite(item.denominator))) ||
			typeof item.definitionHash !== "string" ||
			typeof item.asOf !== "string" ||
			!["reported", "provisional", "verified"].includes(String(item.status)) ||
			(typeof item.dataThrough !== "string" && item.dataThrough !== null) ||
			!item.evidenceSource ||
			typeof item.snapshotId !== "string"
		) {
			throw new ConflictException("Stored QBR observation is malformed.");
		}
		if (
			!evidenceSource ||
			typeof evidenceSource.label !== "string" ||
			typeof evidenceSource.url !== "string" ||
			typeof sourceLabel !== "string" ||
			typeof sourceUrl !== "string"
		)
			throw new ConflictException(
				"Stored QBR observation source is malformed.",
			);
		validDate(item.asOf, "stored asOf");
		if (item.dataThrough !== null)
			validDate(item.dataThrough, "stored dataThrough");
		const normalized = Object.fromEntries(
			Object.entries(item).filter(
				([key, value]) =>
					key !== "source_label" &&
					key !== "source_url" &&
					!(
						["verification", "sourceQueryHash"].includes(key) && value === null
					),
			),
		);
		rows.push({
			...normalized,
			evidenceSource: evidenceSource as Observation["evidenceSource"],
			source: { label: sourceLabel, url: sourceUrl },
		} as unknown as StoredObservation);
	}
	return rows;
}

function qbrMetadata(visualization: Prisma.JsonValue | null | undefined) {
	if (
		!visualization ||
		typeof visualization !== "object" ||
		Array.isArray(visualization)
	)
		return null;
	const qbr = visualization.qbr;
	return qbr && typeof qbr === "object" && !Array.isArray(qbr) ? qbr : null;
}

function registeredDefinitionHash(
	visualization: Prisma.JsonValue | null | undefined,
	metricId: string,
): string | null {
	const metadata = qbrMetadata(visualization);
	return metadata?.metricId === metricId &&
		typeof metadata.definitionHash === "string"
		? metadata.definitionHash
		: null;
}

function assertRegisteredQuestion(
	metric: RegistryMetric,
	question: Prisma.QuestionGetPayload<{ include: { versions: true } }>,
	sourceId: string,
) {
	const latest = question.versions[0];
	const metadata = qbrMetadata(latest?.visualization);
	const managedPromotion =
		metric.automated &&
		metadata?.automated === false &&
		question.status === QuestionStatus.DRAFT &&
		latest?.queryLanguage === QueryLanguage.API &&
		latest.queryText === `qbr:manual:${metric.id}` &&
		question.databaseExternalId === null;
	if (
		question.name !== metric.label ||
		question.sourceId !== sourceId ||
		(!managedPromotion &&
			question.status !==
				(metric.automated ? QuestionStatus.ACTIVE : QuestionStatus.DRAFT)) ||
		question.purpose !== QuestionPurpose.RECONCILIATION ||
		!latest ||
		latest.createdBy !== "atlas-qbr" ||
		(!managedPromotion &&
			latest.queryLanguage !==
				(metric.automated ? QueryLanguage.SQL : QueryLanguage.API)) ||
		(question.description !== description(metric) &&
			PREVIOUS_DESCRIPTION_HASHES[metric.id] !== hash(question.description)) ||
		!metadata ||
		metadata.metricId !== metric.id ||
		metadata.definitionHash !== metricDefinitionHash(metric) ||
		(!managedPromotion && metadata.automated !== metric.automated) ||
		metadata.queryHash !==
			hash({
				queryText: latest.queryText,
				databaseExternalId: question.databaseExternalId,
			})
	)
		throw new ConflictException(
			`Existing QBR question ${metric.id} has unexpected or user-edited state.`,
		);
	return { latest, metadata };
}

function storedPreparation(preparation: Prisma.JsonValue | undefined) {
	if (preparation === undefined) return undefined;
	const parsed = preparationSchema.safeParse(preparation);
	if (!parsed.success)
		throw new ConflictException(
			"Stored QBR preparation is malformed or has unsupported fields.",
		);
	return parsed.data;
}

@Injectable()
export class AtlasQbrService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async register(
		queries: Record<string, QueryDefinition>,
	): Promise<Record<string, number>> {
		this.assertQuarter(REGISTRY_QUARTER);
		const automated = registry.metrics.filter((metric) => metric.automated);
		for (const metric of automated) {
			const query = queries[metric.id];
			if (!query?.queryText?.trim() || !query.databaseExternalId?.trim()) {
				throw new BadRequestException(
					`Missing runnable query for ${metric.id}.`,
				);
			}
		}
		for (const id of Object.keys(queries)) {
			if (!automated.some((metric) => metric.id === id))
				throw new BadRequestException(`Unexpected automated query: ${id}`);
		}

		return this.db.$transaction(
			async (tx) => {
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(${QUESTION_LOCK_ID})`;
				const source = await tx.dataSource.upsert({
					where: { key: SOURCE_KEY },
					create: {
						key: SOURCE_KEY,
						kind: DataSourceKind.ATLAS,
						label: "Atlas QBR",
						state: SourceStatus.UNCONFIGURED,
					},
					update: { label: "Atlas QBR" },
					select: { id: true },
				});
				const result: Record<string, number> = {};
				const existingQuestions = await tx.question.findMany({
					where: {
						connector: DataSourceKind.ATLAS,
						sourceExternalId: {
							in: registry.metrics.map((metric) => `qbr:${metric.id}`),
						},
					},
					include: { versions: { orderBy: { version: "desc" }, take: 1 } },
				});
				const existingByExternalId = new Map(
					existingQuestions.map((question) => [
						question.sourceExternalId,
						question,
					]),
				);
				const maximum = await tx.question.aggregate({ _max: { number: true } });
				let nextNumber = maximum._max.number ?? 0;
				const newQuestions: Array<
					Prisma.QuestionCreateManyInput & { id: string }
				> = [];
				const newVersions: Prisma.QuestionVersionCreateManyInput[] = [];
				for (const metric of registry.metrics) {
					const externalId = `qbr:${metric.id}`;
					const query = metric.automated ? queries[metric.id] : null;
					const sql = query?.queryText ?? `qbr:manual:${metric.id}`;
					const queryHash = hash({
						queryText: sql,
						databaseExternalId: query?.databaseExternalId ?? null,
					});
					const qbrMetadata = {
						metricId: metric.id,
						definitionHash: metricDefinitionHash(metric),
						queryHash,
						automated: metric.automated,
					};
					const existing = existingByExternalId.get(externalId);
					if (existing) {
						const { latest, metadata } = assertRegisteredQuestion(
							metric,
							existing,
							source.id,
						);
						if (existing.description !== description(metric)) {
							await tx.question.update({
								where: { id: existing.id },
								data: { description: description(metric) },
							});
						}
						if (
							latest.queryText !== sql ||
							existing.databaseExternalId !==
								(query?.databaseExternalId ?? null)
						) {
							const nextVersion = latest.version + 1;
							await tx.question.update({
								where: { id: existing.id },
								data: {
									databaseExternalId: query?.databaseExternalId ?? null,
									status: metric.automated
										? QuestionStatus.ACTIVE
										: QuestionStatus.DRAFT,
								},
							});
							await tx.questionVersion.create({
								data: {
									questionId: existing.id,
									version: nextVersion,
									queryLanguage: query ? QueryLanguage.SQL : QueryLanguage.API,
									queryText: sql,
									display: latest.display,
									sourceCardExternalId: latest.sourceCardExternalId,
									visualization: json({
										...(latest.visualization as Prisma.JsonObject),
										qbr: { ...metadata, ...qbrMetadata },
									}),
									createdBy: "atlas-qbr",
								},
							});
						}
						result[metric.id] = existing.publicNumber;
						continue;
					}
					const questionId = randomUUID();
					newQuestions.push({
						id: questionId,
						number: ++nextNumber,
						name: metric.label,
						description: description(metric),
						connector: DataSourceKind.ATLAS,
						sourceId: source.id,
						sourceExternalId: externalId,
						databaseExternalId: query?.databaseExternalId ?? null,
						status: metric.automated
							? QuestionStatus.ACTIVE
							: QuestionStatus.DRAFT,
						purpose: QuestionPurpose.RECONCILIATION,
					});
					newVersions.push({
						questionId,
						version: 1,
						queryLanguage: query ? QueryLanguage.SQL : QueryLanguage.API,
						queryText: sql,
						display: "table",
						visualization: json({ qbr: qbrMetadata }),
						createdBy: "atlas-qbr",
					});
				}
				if (newQuestions.length) {
					await tx.question.createMany({ data: newQuestions });
					await tx.questionVersion.createMany({ data: newVersions });
					const created = await tx.question.findMany({
						where: { id: { in: newQuestions.map(({ id }) => id) } },
						select: { publicNumber: true, sourceExternalId: true },
					});
					for (const question of created) {
						if (!question.sourceExternalId)
							throw new ConflictException(
								"Registered QBR question lost its identity.",
							);
						result[question.sourceExternalId.slice(4)] = question.publicNumber;
					}
				}
				return result;
			},
			{ maxWait: 10_000, timeout: 60_000 },
		);
	}

	async importPreparations(input: unknown) {
		const parsed = preparationBatchSchema.safeParse(input);
		if (!parsed.success)
			throw new BadRequestException("Invalid QBR preparation batch.");
		const { quarter, preparations } = parsed.data;
		if (Buffer.byteLength(JSON.stringify(parsed.data)) > 1_000_000)
			throw new BadRequestException("QBR preparation batch exceeds 1 MB.");
		if (
			new Set(preparations.map(({ metricId }) => metricId)).size !==
			preparations.length
		)
			throw new BadRequestException("Duplicate QBR preparation metric IDs.");
		for (const { metricId, preparation } of preparations) {
			const canonical = registry.metrics.find(
				(metric) => metric.id === metricId,
			)?.preparation;
			for (const key of [
				"owner",
				"ownerStatus",
				"ownerSource",
				"workstream",
			] as const) {
				if (!canonical || hash(preparation[key]) !== hash(canonical[key]))
					throw new BadRequestException(
						`QBR preparation ${key} must match the registry.`,
					);
			}
		}
		return this.db.$transaction(
			async (tx) => {
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(${QUESTION_LOCK_ID})`;
				const source = await tx.dataSource.findUnique({
					where: { key: SOURCE_KEY },
					select: { id: true },
				});
				if (!source)
					throw new ConflictException(
						"Register QBR questions before importing preparations.",
					);
				const questions = await tx.question.findMany({
					where: {
						connector: DataSourceKind.ATLAS,
						sourceExternalId: {
							in: preparations.map(({ metricId }) => `qbr:${metricId}`),
						},
					},
					include: {
						versions: { orderBy: { version: "desc" }, take: 1 },
						qbrPreparations: {
							where: { quarter },
							orderBy: { version: "desc" },
							take: 1,
							select: { version: true, preparation: true },
						},
					},
				});
				const byId = new Map(
					questions.map((question) => [question.sourceExternalId, question]),
				);
				const newPreparations: Prisma.QbrPreparationCreateManyInput[] = [];
				for (const { metricId, preparation } of preparations) {
					const metric = registry.metrics.find((item) => item.id === metricId);
					const question = byId.get(`qbr:${metricId}`);
					if (!metric || !question)
						throw new ConflictException(
							"Register all QBR questions before importing preparations.",
						);
					assertRegisteredQuestion(metric, question, source.id);
					const previous = question.qbrPreparations[0];
					const parsedPrevious = storedPreparation(previous?.preparation);
					if (parsedPrevious && hash(parsedPrevious) === hash(preparation))
						continue;
					newPreparations.push({
						questionId: question.id,
						quarter,
						version: (previous?.version ?? 0) + 1,
						preparation: json(preparation),
					});
				}
				if (newPreparations.length)
					await tx.qbrPreparation.createMany({ data: newPreparations });
				return {
					quarter,
					imported: newPreparations.length,
					unchanged: preparations.length - newPreparations.length,
				};
			},
			{ maxWait: 10_000, timeout: 60_000 },
		);
	}

	async verifyObservations(input: unknown) {
		const parsed = verificationBatchSchema.safeParse(input);
		if (!parsed.success)
			throw new BadRequestException("Invalid QBR verification evidence.");
		const review = parsed.data;
		const report = await this.exportReport(REGISTRY_QUARTER);
		const metric = report.metrics[review.metricId];
		if (!metric)
			throw new NotFoundException(`Unknown QBR metric: ${review.metricId}`);
		if (
			new Set(review.observations.map((item) => item.period)).size !==
			review.observations.length
		)
			throw new BadRequestException("Verification periods must be unique.");
		const observations = review.observations.map((item): Observation => {
			const saved = metric.observations[item.period];
			if (
				!saved ||
				!saved.sourceQueryHash ||
				saved.snapshotId !== review.snapshotId ||
				saved.definitionHash !== review.definitionHash
			)
				throw new ConflictException(
					"The QBR answer changed or is missing; review the current snapshot.",
				);
			return {
				period: item.period,
				value: saved.value,
				numerator: saved.numerator,
				denominator: saved.denominator,
				status: "verified",
				asOf: saved.asOf,
				dataThrough: item.dataThrough,
				evidenceSource: {
					...saved.evidenceSource,
					label: saved.evidenceSource.label.replace(
						"; source-close verification pending",
						"",
					),
				},
				...(saved.cohortMonth ? { cohortMonth: saved.cohortMonth } : {}),
				...(saved.reportedBy ? { reportedBy: saved.reportedBy } : {}),
				verification: {
					...item.verification,
					reviewedSnapshotId: review.snapshotId,
					reviewedQueryHash: saved.sourceQueryHash,
				},
			};
		});
		return this.saveObservations(
			review.metricId,
			observations,
			review.snapshotId,
		);
	}

	async recordObservations(metricId: string, observations: Observation[]) {
		if (
			Array.isArray(observations) &&
			observations.some(
				(item) => item.status === "verified" || item.verification,
			)
		)
			throw new BadRequestException(
				"QBR inputs must be reported or provisional, never verified. Use snapshot-bound verification.",
			);
		return this.saveObservations(metricId, observations);
	}

	private async saveObservations(
		metricId: string,
		observations: Observation[],
		expectedSnapshotId?: string,
	) {
		const metric = registry.metrics.find(
			(candidate) => candidate.id === metricId,
		);
		if (!metric) throw new NotFoundException(`Unknown QBR metric: ${metricId}`);
		if (metric.notApplicable)
			throw new BadRequestException(
				"Not-applicable QBR metrics cannot have observations.",
			);
		if (!Array.isArray(observations) || observations.length === 0)
			throw new BadRequestException(
				"At least one QBR observation is required.",
			);
		for (const observation of observations)
			validateObservation(metric, observation);

		return this.db.$transaction(async (tx) => {
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(${QUESTION_LOCK_ID})`;
			const questionExternalId = `qbr:${metric.id}`;
			const question = await tx.question.findUnique({
				where: {
					connector_sourceExternalId: {
						connector: DataSourceKind.ATLAS,
						sourceExternalId: questionExternalId,
					},
				},
				select: {
					id: true,
					publicNumber: true,
					sourceId: true,
					versions: {
						orderBy: { version: "desc" },
						take: 1,
						select: { visualization: true },
					},
				},
			});
			if (!question)
				throw new ConflictException(
					`Register QBR question ${metric.id} before saving observations.`,
				);
			if (!question.sourceId)
				throw new ConflictException(
					`Registered QBR question ${metric.id} has no Atlas source.`,
				);
			if (
				registeredDefinitionHash(
					question.versions[0]?.visualization,
					metric.id,
				) !== metricDefinitionHash(metric)
			)
				throw new ConflictException(
					`Registered QBR question ${metric.id} has a mismatched definition hash.`,
				);
			const sourceQueryHash = qbrMetadata(
				question.versions[0]?.visualization,
			)?.queryHash;
			if (
				expectedSnapshotId &&
				observations.some(
					(item) => item.verification?.reviewedQueryHash !== sourceQueryHash,
				)
			)
				throw new ConflictException(
					"The QBR source query changed. Refresh and review the current answer.",
				);
			const previous = await tx.resultSnapshot.findFirst({
				where: {
					sourceId: question.sourceId,
					questionExternalId,
					reportingPeriod: REPORTING_PERIOD,
				},
				orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
				select: { id: true, rows: true, columns: true },
			});
			if (expectedSnapshotId && previous?.id !== expectedSnapshotId)
				throw new ConflictException(
					"The QBR snapshot changed during verification. Review the current answer.",
				);
			const byPeriod = new Map(
				previous
					? rowsFrom(previous.rows, previous.columns).map((row) => [
							row.period,
							row,
						])
					: [],
			);
			for (const observation of observations) {
				const old = byPeriod.get(observation.period);
				if (old) {
					if (old.definitionHash !== metricDefinitionHash(metric))
						throw new ConflictException(
							`Stored QBR observation ${metric.id}/${observation.period} uses another definition.`,
						);
					if (
						(old.status === "reported" || old.reportedBy) &&
						observation.status === "provisional"
					)
						throw new ConflictException(
							`Provisional refresh cannot replace reported QBR observation ${metric.id}/${observation.period}.`,
						);
					if (
						validDate(observation.asOf, "asOf") <
						validDate(old.asOf, "stored asOf")
					)
						throw new ConflictException(
							`Stale QBR observation rejected for ${metric.id}/${observation.period}.`,
						);
					if (
						old.dataThrough &&
						!(
							old.status === "verified" && observation.status === "provisional"
						) &&
						(!observation.dataThrough ||
							validDate(observation.dataThrough, "dataThrough") <
								validDate(old.dataThrough, "stored dataThrough"))
					)
						throw new ConflictException(
							`Stale QBR data-through rejected for ${metric.id}/${observation.period}.`,
						);
				}
				byPeriod.set(observation.period, {
					...observation,
					cohortMonth: observation.cohortMonth ?? null,
					reportedBy: observation.reportedBy?.trim() || null,
					definitionHash: metricDefinitionHash(metric),
					sourceQueryHash:
						typeof sourceQueryHash === "string" ? sourceQueryHash : undefined,
					source: {
						label: `Atlas question ${question.publicNumber}`,
						url: `${QUESTION_BASE_URL}/${question.publicNumber}`,
					},
					snapshotId: "",
				});
			}
			const sorted = [...byPeriod.values()].sort((a, b) =>
				a.period.localeCompare(b.period),
			);
			const capturedAt = new Date();
			const questionUrl = `${QUESTION_BASE_URL}/${question.publicNumber}`;
			const contentHash = hash(
				sorted.map(({ snapshotId: _snapshotId, ...row }) => ({
					...row,
					source: {
						label: `Atlas question ${question.publicNumber}`,
						url: questionUrl,
					},
				})),
			);
			const snapshotId = `qbr:${metric.id}:${contentHash.slice(0, 24)}`;
			const stored = sorted.map((row) => ({
				...row,
				source: {
					label: `Atlas question ${question.publicNumber}`,
					url: questionUrl,
				},
				snapshotId,
			}));
			const snapshotRows = stored.map((row) =>
				OBSERVATION_COLUMNS.map((column) =>
					column === "source_label"
						? row.source.label
						: column === "source_url"
							? row.source.url
							: (row[column as keyof StoredObservation] ?? null),
				),
			);
			const idempotencyKey = `qbr:${metric.id}:${contentHash}`;
			const existingSnapshot = await tx.resultSnapshot.findUnique({
				where: { idempotencyKey },
				select: { id: true },
			});
			if (existingSnapshot)
				return {
					metricId,
					snapshotId: existingSnapshot.id,
					observationCount: observations.length,
				};
			const snapshot = await tx.resultSnapshot.create({
				data: {
					id: snapshotId,
					idempotencyKey,
					sourceId: question.sourceId,
					questionExternalId,
					reportingPeriod: REPORTING_PERIOD,
					capturedAt,
					contentHash,
					columns: json(OBSERVATION_COLUMNS.map((name) => ({ name }))),
					rows: json(snapshotRows),
					rowCount: stored.length,
				},
				select: { id: true },
			});
			return {
				metricId,
				snapshotId: snapshot.id,
				observationCount: observations.length,
			};
		});
	}

	async exportReport(quarter: string): Promise<AtlasQbrReport> {
		this.assertQuarter(quarter);
		const result: AtlasQbrReport["metrics"] = {};
		const questionExternalIds = registry.metrics.map(
			(metric) => `qbr:${metric.id}`,
		);
		const questions = await this.db.question.findMany({
			where: {
				connector: DataSourceKind.ATLAS,
				sourceExternalId: { in: questionExternalIds },
				source: { is: { key: SOURCE_KEY } },
			},
			select: {
				publicNumber: true,
				sourceId: true,
				sourceExternalId: true,
				versions: {
					orderBy: { version: "desc" },
					take: 1,
					select: { visualization: true },
				},
				qbrPreparations: {
					where: { quarter },
					orderBy: { version: "desc" },
					take: 1,
					select: { version: true, preparation: true },
				},
			},
		});
		const questionById = new Map(
			questions.map((question) => [question.sourceExternalId, question]),
		);
		const sourceIds = [
			...new Set(
				questions
					.map((question) => question.sourceId)
					.filter((id): id is string => id !== null),
			),
		];
		const snapshots = sourceIds.length
			? await this.db.resultSnapshot.findMany({
					where: {
						sourceId: { in: sourceIds },
						questionExternalId: { in: questionExternalIds },
						reportingPeriod: REPORTING_PERIOD,
					},
					orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
					distinct: ["sourceId", "questionExternalId"],
					select: {
						id: true,
						sourceId: true,
						questionExternalId: true,
						rows: true,
						columns: true,
					},
				})
			: [];
		const snapshotByQuestion = new Map(
			snapshots.map((snapshot) => [
				`${snapshot.sourceId}\0${snapshot.questionExternalId}`,
				snapshot,
			]),
		);
		for (const metric of registry.metrics) {
			const question = questionById.get(`qbr:${metric.id}`);
			if (
				question &&
				registeredDefinitionHash(
					question.versions[0]?.visualization,
					metric.id,
				) !== metricDefinitionHash(metric)
			)
				throw new ConflictException(
					`Registered QBR question ${metric.id} has a mismatched definition hash.`,
				);
			const observations: Record<string, QbrReportObservation> = {};
			const snapshot = question?.sourceId
				? snapshotByQuestion.get(`${question.sourceId}\0qbr:${metric.id}`)
				: null;
			if (snapshot) {
				for (const row of rowsFrom(snapshot.rows, snapshot.columns)) {
					if (row.definitionHash !== metricDefinitionHash(metric))
						throw new ConflictException(
							`QBR observation ${metric.id}/${row.period} has a mismatched definition hash.`,
						);
					if (row.snapshotId !== snapshot.id)
						throw new ConflictException(
							`QBR observation ${metric.id}/${row.period} has a mismatched snapshot ID.`,
						);
					if (row.status === "verified") {
						validateObservation(metric, row);
						if (
							!row.sourceQueryHash ||
							row.verification?.reviewedQueryHash !== row.sourceQueryHash
						)
							throw new ConflictException(
								"QBR verification is bound to another source query.",
							);
					}
					observations[row.period] = {
						value: row.value,
						numerator: row.numerator,
						denominator: row.denominator,
						status: row.status,
						source: row.source,
						asOf: row.asOf,
						dataThrough: row.dataThrough,
						...(row.cohortMonth ? { cohortMonth: row.cohortMonth } : {}),
						...(row.reportedBy ? { reportedBy: row.reportedBy } : {}),
						evidenceSource: row.evidenceSource,
						snapshotId: snapshot.id,
						definitionHash: row.definitionHash,
						...(row.verification ? { verification: row.verification } : {}),
						...(row.sourceQueryHash
							? { sourceQueryHash: row.sourceQueryHash }
							: {}),
					};
				}
			}
			result[metric.id] = {
				question: question
					? {
							number: question.publicNumber,
							url: `${QUESTION_BASE_URL}/${question.publicNumber}`,
						}
					: null,
				label: metric.label,
				definition: metric.definition,
				unit: metric.unit,
				notApplicable: metric.notApplicable,
				automated: metric.automated,
				preparation:
					storedPreparation(question?.qbrPreparations[0]?.preparation) ??
					metric.preparation,
				observations,
			};
		}
		return {
			schemaVersion: "atlas.qbr.v1",
			quarter,
			definitionVersion: registry.definitionVersion,
			generatedAt: new Date().toISOString(),
			metrics: result,
		};
	}

	private assertQuarter(quarter: string): void {
		if (quarter !== REGISTRY_QUARTER)
			throw new NotFoundException(`QBR registry not found for ${quarter}.`);
	}
}
