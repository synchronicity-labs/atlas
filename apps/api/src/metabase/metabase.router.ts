import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	metabaseDashboardSyncInput,
	metabaseUserSyncInput,
} from "./metabase.contracts";
import { MetabaseService } from "./metabase.service";

@Router({ alias: "metabase" })
@UseMiddlewares(AuthMiddleware)
export class MetabaseRouter {
	constructor(
		@Inject(MetabaseService) private readonly metabase: MetabaseService,
	) {}

	@Query()
	async status() {
		return this.metabase.status();
	}

	@Mutation({ input: metabaseUserSyncInput })
	async syncUsers(@Input() input: z.infer<typeof metabaseUserSyncInput>) {
		return this.metabase.syncUsers(input);
	}

	@Mutation({ input: metabaseDashboardSyncInput })
	async syncDashboard(
		@Input() input: z.infer<typeof metabaseDashboardSyncInput>,
	) {
		return this.metabase.syncDashboard(input);
	}
}
