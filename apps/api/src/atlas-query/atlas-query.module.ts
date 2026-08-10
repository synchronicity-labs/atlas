import { Module } from "@nestjs/common";
import { AtlasQueryController } from "./atlas-query.controller";
import { AtlasQueryService } from "./atlas-query.service";

@Module({
	controllers: [AtlasQueryController],
	providers: [AtlasQueryService],
})
export class AtlasQueryModule {}
