import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { MetabaseRouter } from "./metabase.router";
import { MetabaseService } from "./metabase.service";
import { MetabaseSyncController } from "./metabase-sync.controller";
import { ProductMetricPublisher } from "./product-metric.publisher";

@Module({
	imports: [TrpcModule],
	controllers: [MetabaseSyncController],
	providers: [MetabaseService, MetabaseRouter, ProductMetricPublisher],
	exports: [MetabaseService],
})
export class MetabaseModule {}
