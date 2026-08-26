import { Module } from "@nestjs/common";
import { MetabaseModule } from "../metabase/metabase.module";
import { Q3InboundController } from "./q3-inbound.controller";
import { Q3InboundService } from "./q3-inbound.service";
import { SalesService } from "./sales.service";

@Module({
	imports: [MetabaseModule],
	controllers: [Q3InboundController],
	providers: [SalesService, Q3InboundService],
	exports: [SalesService, Q3InboundService],
})
export class SalesModule {}
