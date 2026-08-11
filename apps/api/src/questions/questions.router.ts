import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	questionListInput,
	questionNumberInput,
	questionPreviewInput,
	questionProposalInput,
	questionSaveVersionInput,
} from "./questions.contracts";
import { QuestionsService } from "./questions.service";

@Router({ alias: "questions" })
@UseMiddlewares(AuthMiddleware)
export class QuestionsRouter {
	constructor(
		@Inject(QuestionsService) private readonly questions: QuestionsService,
	) {}

	@Query({ input: questionListInput })
	async list(@Input() input: z.infer<typeof questionListInput>) {
		return this.questions.list(input);
	}

	@Query({ input: questionNumberInput })
	async byNumber(@Input("number") number: number) {
		return this.questions.byNumber(number);
	}

	@Query({ input: questionProposalInput })
	async proposal(@Input("id") id: string) {
		return this.questions.proposal(id);
	}

	@Mutation({ input: questionPreviewInput })
	async preview(@Input() input: z.infer<typeof questionPreviewInput>) {
		return this.questions.preview(input);
	}

	@Mutation({ input: questionSaveVersionInput })
	async saveVersion(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof questionSaveVersionInput>,
	) {
		return this.questions.saveVersion(input, ctx.user.id);
	}
}
