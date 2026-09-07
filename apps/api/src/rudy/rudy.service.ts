import { randomUUID } from "node:crypto";
import { type Db, type Prisma, QueryLanguage, QuestionStatus } from "@crm/db";
import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import { questionNumberWhere } from "../questions/question-number";
import { sanitizeQuestionResult } from "../questions/question-result-safety";
import { assertReadOnlyQuery } from "../questions/read-only-query";
import { RudyClient, textContent } from "./rudy.client";
import type { RudyContext, RudySendInput } from "./rudy.contracts";

type AtlasUser = { id: string; email: string; name: string };

const questionProposal = z.object({
	type: z.literal("question.change"),
	number: z.number().int().positive().optional(),
	summary: z.string().min(1).max(500),
	name: z.string().min(1).max(240).optional(),
	description: z.string().max(4000).nullable().optional(),
	queryLanguage: z.nativeEnum(QueryLanguage).optional(),
	queryText: z.string().min(1).max(250_000).optional(),
	display: z.string().min(1).max(80).optional(),
	visualization: z.record(z.string(), z.unknown()).optional(),
});

const PROPOSAL_PATTERN = /<atlas_proposal>\s*([\s\S]*?)\s*<\/atlas_proposal>/g;
const MAX_CONTEXT_CHARS = 140_000;

@Injectable()
export class RudyService {
	private readonly logger = new Logger(RudyService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly rudy: RudyClient,
	) {}

	status() {
		return {
			configured: this.rudy.configured(),
			transport: "hermes-session-api",
		};
	}

	async list(context: RudyContext, userId: string) {
		const rows = await this.db.rudySession.findMany({
			where: {
				userId,
				contextKind: context.kind,
				contextId: context.id,
			},
			orderBy: { lastMessageAt: "desc" },
			take: 20,
		});
		return rows.map(serializeThread);
	}

	async messages(id: string, userId: string) {
		const thread = await this.ownedThread(id, userId);
		const [messages, proposals] = await Promise.all([
			this.rudy.messages(thread.hermesSessionId),
			this.db.questionChangeProposal.findMany({
				where: { sessionId: thread.hermesSessionId },
				orderBy: { createdAt: "asc" },
				select: {
					id: true,
					summary: true,
					status: true,
					question: { select: { publicNumber: true, name: true } },
				},
			}),
		]);
		return {
			thread: serializeThread(thread),
			messages: messages
				.filter(
					(message) => message.role === "user" || message.role === "assistant",
				)
				.map((message, index) => ({
					id: message.id ?? `${thread.id}:${index}`,
					role: message.role as "user" | "assistant",
					content: cleanProposalMarkup(textContent(message.content)),
					timestamp: message.timestamp ?? null,
				})),
			proposals: proposals.map((proposal) => ({
				id: proposal.id,
				summary: proposal.summary,
				status: proposal.status,
				questionNumber: proposal.question.publicNumber,
				questionName: proposal.question.name,
				reviewUrl: `/questions/${proposal.question.publicNumber}?proposal=${proposal.id}`,
			})),
		};
	}

	async send(input: RudySendInput, user: AtlasUser) {
		const thread = input.threadId
			? await this.ownedThread(input.threadId, user.id, input.context)
			: await this.createThread(input, user);
		const context = await this.readContext(input.context);
		const instructions = this.instructions(user, input.context, context);
		const response = await this.rudy.chat({
			sessionId: thread.hermesSessionId,
			message: input.message,
			instructions,
		});
		const proposals = await this.persistProposals({
			response,
			context: input.context,
			sessionId: thread.hermesSessionId,
		});
		const updated = await this.db.rudySession.update({
			where: { id: thread.id },
			data: {
				messageCount: { increment: 2 },
				lastMessageAt: new Date(),
			},
		});
		return {
			thread: serializeThread(updated),
			message: cleanProposalMarkup(response),
			proposals,
		};
	}

	async remove(id: string, userId: string) {
		const thread = await this.ownedThread(id, userId);
		await this.rudy.remove(thread.hermesSessionId);
		await this.db.rudySession.delete({ where: { id: thread.id } });
		return { id };
	}

	private async createThread(input: RudySendInput, user: AtlasUser) {
		const sessionNonce = randomUUID();
		const hermesSessionId = `atlas_${user.id}_${sessionNonce}`;
		const context = await this.readContext(input.context);
		const title = input.message.trim().slice(0, 100);
		await this.rudy.create({
			id: hermesSessionId,
			title: `${title} · ${sessionNonce.slice(0, 8)}`,
			systemPrompt: this.instructions(user, input.context, context),
		});
		try {
			return await this.db.rudySession.create({
				data: {
					userId: user.id,
					contextKind: input.context.kind,
					contextId: input.context.id,
					hermesSessionId,
					title,
				},
			});
		} catch (error) {
			await this.rudy.remove(hermesSessionId).catch(() => undefined);
			throw error;
		}
	}

	private async ownedThread(id: string, userId: string, context?: RudyContext) {
		const thread = await this.db.rudySession.findUnique({ where: { id } });
		if (!thread || thread.userId !== userId) {
			throw new NotFoundException("That Rudy session does not exist.");
		}
		if (
			context &&
			(thread.contextKind !== context.kind || thread.contextId !== context.id)
		) {
			throw new BadRequestException(
				"That Rudy session belongs to a different Atlas context.",
			);
		}
		return thread;
	}

	private async readContext(context: RudyContext): Promise<unknown> {
		if (context.kind === "workspace") {
			const [dashboards, questions] = await Promise.all([
				this.db.dashboard.findMany({
					orderBy: { number: "asc" },
					select: {
						number: true,
						name: true,
						description: true,
						updatedAt: true,
						_count: { select: { tabs: true, cards: true } },
					},
				}),
				this.db.question.findMany({
					where: { status: QuestionStatus.ACTIVE },
					orderBy: { publicNumber: "asc" },
					select: {
						publicNumber: true,
						name: true,
						connector: true,
						updatedAt: true,
					},
				}),
			]);
			return {
				schema: "atlas.workspace.v1",
				dashboards,
				questions: questions.map((question) => ({
					...question,
					number: question.publicNumber,
					publicNumber: undefined,
				})),
			};
		}

		const number = Number(context.id);
		if (context.kind === "question") {
			const question = await this.db.question.findFirst({
				where: questionNumberWhere(number),
				select: {
					number: true,
					publicNumber: true,
					name: true,
					description: true,
					connector: true,
					sourceExternalId: true,
					updatedAt: true,
					source: {
						select: {
							key: true,
							label: true,
							state: true,
							lastSyncAt: true,
							freshnessDeadlineAt: true,
							lastError: true,
						},
					},
					versions: {
						orderBy: { version: "desc" },
						take: 5,
						select: {
							version: true,
							queryLanguage: true,
							queryText: true,
							display: true,
							visualization: true,
							createdBy: true,
							createdAt: true,
						},
					},
				},
			});
			if (!question)
				throw new NotFoundException(`No Atlas question ${number}.`);
			const snapshots = question.sourceExternalId
				? await this.db.resultSnapshot.findMany({
						where: { questionExternalId: question.sourceExternalId },
						orderBy: { capturedAt: "desc" },
						take: 6,
						select: {
							reportingPeriod: true,
							capturedAt: true,
							columns: true,
							rows: true,
							rowCount: true,
						},
					})
				: [];
			return {
				schema: "atlas.question.context.v1",
				question: {
					...question,
					number: question.publicNumber,
					publicNumber: undefined,
				},
				snapshots: snapshots.map((snapshot) =>
					compactSnapshot(question.publicNumber, snapshot),
				),
			};
		}

		const dashboard = await this.db.dashboard.findUnique({
			where: { number },
			select: {
				number: true,
				name: true,
				description: true,
				layoutVersion: true,
				updatedAt: true,
				tabs: {
					orderBy: { position: "asc" },
					select: { number: true, name: true, position: true },
				},
				cards: {
					orderBy: [{ tab: { position: "asc" } }, { position: "asc" }],
					select: {
						id: true,
						position: true,
						x: true,
						y: true,
						width: true,
						height: true,
						visualization: true,
						displaySettings: true,
						tab: { select: { number: true, name: true } },
						question: {
							select: {
								number: true,
								publicNumber: true,
								name: true,
								description: true,
								connector: true,
								sourceExternalId: true,
								versions: {
									orderBy: { version: "desc" },
									take: 1,
									select: {
										version: true,
										queryLanguage: true,
										queryText: true,
										display: true,
										visualization: true,
									},
								},
							},
						},
					},
				},
			},
		});
		if (!dashboard)
			throw new NotFoundException(`No Atlas dashboard ${number}.`);
		const externalIds = dashboard.cards.flatMap((card) =>
			card.question.sourceExternalId ? [card.question.sourceExternalId] : [],
		);
		const snapshots = await this.db.resultSnapshot.findMany({
			where: { questionExternalId: { in: externalIds } },
			orderBy: { capturedAt: "desc" },
			select: {
				questionExternalId: true,
				reportingPeriod: true,
				capturedAt: true,
				columns: true,
				rows: true,
				rowCount: true,
			},
		});
		const latest = new Map<string, (typeof snapshots)[number]>();
		for (const snapshot of snapshots) {
			if (!latest.has(snapshot.questionExternalId)) {
				latest.set(snapshot.questionExternalId, snapshot);
			}
		}
		return {
			schema: "atlas.dashboard.context.v1",
			dashboard: {
				...dashboard,
				cards: dashboard.cards.map((card) => ({
					...card,
					question: {
						...card.question,
						number: card.question.publicNumber,
						publicNumber: undefined,
					},
					latestResult: card.question.sourceExternalId
						? compactSnapshot(
								card.question.publicNumber,
								latest.get(card.question.sourceExternalId),
							)
						: null,
				})),
			},
		};
	}

	private instructions(
		user: AtlasUser,
		context: RudyContext,
		contextPayload: unknown,
	): string {
		const payload = JSON.stringify(contextPayload);
		const bounded =
			payload.length > MAX_CONTEXT_CHARS
				? `${payload.slice(0, MAX_CONTEXT_CHARS)}\n[Atlas context truncated]`
				: payload;
		return [
			"You are Rudy inside Atlas, a first-party client parallel to Slack. Continue this Hermes session across follow-ups.",
			`Authenticated Atlas user: ${user.name} <${user.email}> (user id ${user.id}).`,
			`Attached Atlas context reference: ${context.kind}:${context.id}. Treat the attached governed Atlas definitions and immutable snapshots as the deterministic source of truth before querying raw sources.`,
			"All Atlas day, week, and month boundaries are UTC and use half-open intervals. Be explicit about metric timeframe and freshness.",
			"When citing a source that provides an http(s) URL, render it as a descriptive Markdown link. Never present a source identifier as if it were clickable. If retrieval does not provide a URL, label it as a source reference and state that its permalink is unavailable.",
			"You may analyze, explain, and suggest changes. Never claim a question or dashboard was changed live from chat.",
			'For a requested question edit, include exactly one machine-readable proposal after your human explanation using <atlas_proposal>{"type":"question.change","number":1,"summary":"...","queryText":"..."}</atlas_proposal>. Include only fields that change. Atlas will validate it, show a preview, and require a person to save a new immutable version.',
			"Dashboard layout proposals are not applied directly; describe them clearly and wait for Atlas to offer a visual preview.",
			"Current Atlas context JSON:",
			bounded,
		].join("\n\n");
	}

	private async persistProposals(input: {
		response: string;
		context: RudyContext;
		sessionId: string;
	}) {
		const proposals: Array<{
			id: string;
			summary: string;
			questionNumber: number;
			reviewUrl: string;
		}> = [];
		for (const match of input.response.matchAll(PROPOSAL_PATTERN)) {
			try {
				const parsed = questionProposal.parse(JSON.parse(match[1] ?? ""));
				const number =
					parsed.number ??
					(input.context.kind === "question" ? Number(input.context.id) : NaN);
				if (!Number.isInteger(number) || number <= 0) continue;
				const question = await this.db.question.findFirst({
					where: questionNumberWhere(number),
					select: {
						id: true,
						publicNumber: true,
						name: true,
						description: true,
						versions: {
							orderBy: { version: "desc" },
							take: 1,
							select: {
								queryLanguage: true,
								queryText: true,
								display: true,
								visualization: true,
							},
						},
					},
				});
				const latest = question?.versions[0];
				if (!question || !latest) continue;
				const language = parsed.queryLanguage ?? latest.queryLanguage;
				const queryText = parsed.queryText ?? latest.queryText;
				assertReadOnlyQuery(language, queryText);
				const proposal = await this.db.questionChangeProposal.create({
					data: {
						questionId: question.id,
						sessionId: input.sessionId,
						summary: parsed.summary,
						name: parsed.name ?? question.name,
						description:
							parsed.description === undefined
								? question.description
								: parsed.description,
						queryLanguage: language,
						queryText,
						display: parsed.display ?? latest.display,
						visualization: json(
							parsed.visualization ?? latest.visualization ?? {},
						),
					},
				});
				proposals.push({
					id: proposal.id,
					summary: proposal.summary,
					questionNumber: question.publicNumber,
					reviewUrl: `/questions/${question.publicNumber}?proposal=${proposal.id}`,
				});
			} catch (error) {
				this.logger.warn({
					message: "Ignored invalid Rudy Atlas proposal",
					error: error instanceof Error ? error.message : "invalid proposal",
				});
			}
		}
		return proposals;
	}
}

function compactSnapshot(
	number: number,
	snapshot:
		| {
				reportingPeriod: string;
				capturedAt: Date;
				columns: Prisma.JsonValue;
				rows: Prisma.JsonValue;
				rowCount: number;
		  }
		| undefined,
) {
	if (!snapshot) return null;
	const result = sanitizeQuestionResult(
		number,
		snapshot.columns,
		snapshot.rows,
	);
	return {
		...snapshot,
		columns: result.columns,
		rows: Array.isArray(result.rows) ? result.rows.slice(0, 50) : result.rows,
		truncated: snapshot.rowCount > 50,
	};
}

function cleanProposalMarkup(value: string): string {
	return value.replace(PROPOSAL_PATTERN, "").trim();
}

function json(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function serializeThread(thread: {
	id: string;
	title: string | null;
	messageCount: number;
	createdAt: Date;
	lastMessageAt: Date;
}) {
	return {
		...thread,
		createdAt: thread.createdAt.toISOString(),
		lastMessageAt: thread.lastMessageAt.toISOString(),
	};
}
