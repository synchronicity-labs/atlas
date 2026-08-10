import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	dashboardLayoutInput,
	dashboardNumberInput,
	dashboardRefreshInput,
} from "./atlas-dashboards.contracts";
import { AtlasDashboardsService } from "./atlas-dashboards.service";

@Router({ alias: "atlasDashboards" })
@UseMiddlewares(AuthMiddleware)
export class AtlasDashboardsRouter {
	constructor(
		@Inject(AtlasDashboardsService)
		private readonly dashboards: AtlasDashboardsService,
	) {}

	@Query()
	async list() {
		return this.dashboards.list();
	}

	@Query({ input: dashboardNumberInput })
	async byNumber(@Input("number") number: number) {
		return this.dashboards.byNumber(number);
	}

	@Mutation({ input: dashboardRefreshInput })
	async refresh(@Input("number") number: number) {
		return this.dashboards.refresh(number);
	}

	@Mutation({ input: dashboardLayoutInput })
	async updateLayout(@Input() input: z.infer<typeof dashboardLayoutInput>) {
		const result = await this.dashboards.updateLayout(input);
		return {
			...result,
			updatedAt: result.updatedAt.toISOString(),
		};
	}
}
