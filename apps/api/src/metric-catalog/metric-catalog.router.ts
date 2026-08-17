import { Inject } from "@nestjs/common";
import { Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { MetricCatalogService } from "./metric-catalog.service";

@Router({ alias: "metricCatalog" })
@UseMiddlewares(AuthMiddleware)
export class MetricCatalogRouter {
	constructor(
		@Inject(MetricCatalogService)
		private readonly catalog: MetricCatalogService,
	) {}

	@Query()
	async list() {
		return this.catalog.list();
	}

	@Query()
	async summary() {
		return this.catalog.summary();
	}

	@Mutation()
	async sync() {
		return this.catalog.sync();
	}

	@Mutation()
	async auditKpis() {
		return this.catalog.auditKpis();
	}

	@Mutation()
	async auditProjectOutcomes() {
		return this.catalog.auditProjectOutcomes();
	}
}
