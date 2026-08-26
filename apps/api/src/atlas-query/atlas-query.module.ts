import { Module } from "@nestjs/common";
import { AtlasAuthoringController } from "./atlas-authoring.controller";
import { AtlasAuthoringService } from "./atlas-authoring.service";
import { AtlasQueryController } from "./atlas-query.controller";
import { AtlasQueryService } from "./atlas-query.service";

@Module({
	controllers: [AtlasQueryController, AtlasAuthoringController],
	providers: [AtlasQueryService, AtlasAuthoringService],
})
export class AtlasQueryModule {}
