import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { MetricCatalogRouter } from "./metric-catalog.router";
import { MetricCatalogService } from "./metric-catalog.service";
import { MetricCatalogSyncController } from "./metric-catalog-sync.controller";

@Module({
	imports: [TrpcModule],
	controllers: [MetricCatalogSyncController],
	providers: [MetricCatalogService, MetricCatalogRouter],
	exports: [MetricCatalogService],
})
export class MetricCatalogModule {}
