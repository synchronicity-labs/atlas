import { Module } from "@nestjs/common";
import { MetabaseModule } from "../metabase/metabase.module";
import { MarketingService } from "./marketing.service";
import { MarketingSyncController } from "./marketing-sync.controller";

@Module({
	imports: [MetabaseModule],
	controllers: [MarketingSyncController],
	providers: [MarketingService],
	exports: [MarketingService],
})
export class MarketingModule {}
