import { Module } from "@nestjs/common";
import { MarketingModule } from "../marketing/marketing.module";
import { AtlasAuthoringController } from "./atlas-authoring.controller";
import { AtlasAuthoringService } from "./atlas-authoring.service";
import { AtlasQueryController } from "./atlas-query.controller";
import { AtlasQueryService } from "./atlas-query.service";
import { AtlasQbrService } from "./qbr/qbr.service";

@Module({
	imports: [MarketingModule],
	controllers: [AtlasQueryController, AtlasAuthoringController],
	providers: [AtlasQueryService, AtlasAuthoringService, AtlasQbrService],
})
export class AtlasQueryModule {}
