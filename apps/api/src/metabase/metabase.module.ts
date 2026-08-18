import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { MetabaseRouter } from "./metabase.router";
import { MetabaseService } from "./metabase.service";
import { MetabaseSyncController } from "./metabase-sync.controller";
import { ProductEligibilityService } from "./product-eligibility.service";
import { ProductMetricPublisher } from "./product-metric.publisher";
import { RevenueDoorPolicyService } from "./revenue-door-policy.service";
import { TinybirdEligibilityService } from "./tinybird-eligibility.service";

@Module({
	imports: [TrpcModule],
	controllers: [MetabaseSyncController],
	providers: [
		MetabaseService,
		MetabaseRouter,
		ProductMetricPublisher,
		ProductEligibilityService,
		RevenueDoorPolicyService,
		TinybirdEligibilityService,
	],
	exports: [
		MetabaseService,
		ProductEligibilityService,
		RevenueDoorPolicyService,
		TinybirdEligibilityService,
	],
})
export class MetabaseModule {}
