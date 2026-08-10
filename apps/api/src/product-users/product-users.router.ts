import { Inject } from "@nestjs/common";
import { Input, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	productUserDomainInput,
	productUserIdInput,
	productUserListInput,
} from "./product-users.contracts";
import { ProductUsersService } from "./product-users.service";

@Router({ alias: "productUsers" })
@UseMiddlewares(AuthMiddleware)
export class ProductUsersRouter {
	constructor(
		@Inject(ProductUsersService)
		private readonly productUsers: ProductUsersService,
	) {}

	@Query({ input: productUserListInput })
	async list(@Input() input: z.infer<typeof productUserListInput>) {
		return this.productUsers.list(input);
	}

	@Query({ input: productUserIdInput })
	async byId(@Input("id") id: string) {
		return this.productUsers.byId(id);
	}

	@Query({ input: productUserDomainInput })
	async domain(@Input() input: z.infer<typeof productUserDomainInput>) {
		return this.productUsers.domain(input);
	}
}
