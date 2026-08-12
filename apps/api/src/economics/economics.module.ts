import { Module } from "@nestjs/common";
import { MetabaseModule } from "../metabase/metabase.module";
import { EconomicsService } from "./economics.service";
import { EconomicsSyncController } from "./economics-sync.controller";

@Module({
	imports: [MetabaseModule],
	controllers: [EconomicsSyncController],
	providers: [EconomicsService],
	exports: [EconomicsService],
})
export class EconomicsModule {}
