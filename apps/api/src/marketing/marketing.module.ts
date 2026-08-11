import { Module } from "@nestjs/common";
import { MarketingService } from "./marketing.service";
import { MarketingSyncController } from "./marketing-sync.controller";

@Module({
	controllers: [MarketingSyncController],
	providers: [MarketingService],
	exports: [MarketingService],
})
export class MarketingModule {}
