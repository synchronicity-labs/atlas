import { Module } from "@nestjs/common";
import { MarketingModule } from "../marketing/marketing.module";
import { TrpcModule } from "../trpc/trpc.module";
import { AtlasAuthoringController } from "./atlas-authoring.controller";
import { AtlasAuthoringService } from "./atlas-authoring.service";
import { AtlasQueryController } from "./atlas-query.controller";
import { AtlasQueryService } from "./atlas-query.service";
import { QbrRouter } from "./qbr/qbr.router";
import { AtlasQbrService } from "./qbr/qbr.service";

@Module({
	imports: [MarketingModule, TrpcModule],
	controllers: [AtlasQueryController, AtlasAuthoringController],
	providers: [
		AtlasQueryService,
		AtlasAuthoringService,
		AtlasQbrService,
		QbrRouter,
	],
})
export class AtlasQueryModule {}
