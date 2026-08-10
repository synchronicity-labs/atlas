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
	rudyListInput,
	rudyMessagesInput,
	rudyRemoveInput,
	rudySendInput,
} from "./rudy.contracts";
import { RudyService } from "./rudy.service";

@Router({ alias: "rudy" })
@UseMiddlewares(AuthMiddleware)
export class RudyRouter {
	constructor(@Inject(RudyService) private readonly rudy: RudyService) {}

	@Query()
	status() {
		return this.rudy.status();
	}

	@Query({ input: rudyListInput })
	list(
		@Ctx() context: AuthedTrpcContext,
		@Input() input: z.infer<typeof rudyListInput>,
	) {
		return this.rudy.list(input, context.user.id);
	}

	@Query({ input: rudyMessagesInput })
	messages(@Ctx() context: AuthedTrpcContext, @Input("id") id: string) {
		return this.rudy.messages(id, context.user.id);
	}

	@Mutation({ input: rudySendInput })
	send(
		@Ctx() context: AuthedTrpcContext,
		@Input() input: z.infer<typeof rudySendInput>,
	) {
		return this.rudy.send(input, {
			id: context.user.id,
			email: context.user.email,
			name: context.user.name,
		});
	}

	@Mutation({ input: rudyRemoveInput })
	remove(@Ctx() context: AuthedTrpcContext, @Input("id") id: string) {
		return this.rudy.remove(id, context.user.id);
	}
}
