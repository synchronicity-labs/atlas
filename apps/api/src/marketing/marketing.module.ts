import { Module } from "@nestjs/common";
import { MetabaseModule } from "../metabase/metabase.module";
import { GbrainEvidenceController } from "./gbrain-evidence.controller";
import { GbrainEvidenceService } from "./gbrain-evidence.service";
import { MarketingService } from "./marketing.service";
import { MarketingSyncController } from "./marketing-sync.controller";

@Module({
	imports: [MetabaseModule],
	controllers: [MarketingSyncController, GbrainEvidenceController],
	providers: [MarketingService, GbrainEvidenceService],
	exports: [MarketingService],
})
export class MarketingModule {}
